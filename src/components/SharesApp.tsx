import { useCallback, useEffect, useState } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

/**
 * Managing the share links: see how often a link was called up, change it,
 * switch it off or delete it.
 *
 * The counter is deliberately plain: views, downloads and the number of
 * distinct visitors. Names or addresses are nowhere to be found: what is
 * stored is a hash of the IP, salted with the server secret **and** with the
 * identifier of the link. That makes it possible to recognise the same visitor
 * within one link, but not to follow them across several links.
 * Named honestly, that is pseudonymisation, not anonymisation — whoever has the
 * server key could compute their way through the IPv4 space. Which is also why
 * it is only kept for 90 days.
 */
interface Share {
  id: string; slug: string; kind: string; title: string | null; note: string | null;
  expires_at: string | null; revoked_at: string | null; allow_download: boolean;
  password_hash: string | null; views: number; downloads: number;
  last_seen_at: string | null; created_at: string; count: number; visitor: number;
}

const DAYS = [
  { v: 7, label: '7 days from now' }, { v: 30, label: '30 days from now' },
  { v: 90, label: '3 months from now' }, { v: 365, label: '1 year from now' }, { v: 0, label: 'no expiry' },
];

const date = (s: string | null) => s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const time = (s: string | null) => s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

type State = 'active' | 'expired' | 'off';
const state = (s: Share): State =>
  s.revoked_at ? 'off'
  : s.expires_at && new Date(s.expires_at).getTime() < Date.now() ? 'expired'
  : 'active';

export default function SharesApp({ locale, dict }: { locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [visits, setVisits] = useState<Record<string, any[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    // A network error must not look like "nothing shared" — otherwise one thinks
    // one's own links are gone.
    try {
      const r = await fetch('/api/shares');
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setShares(d.shares || []); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 4000); };

  const patch = async (id: string, body: unknown) => {
    const r = await fetch(`/api/shares/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((x) => x.json()).catch(() => ({ error: t('Network error.') }));
    // `{ok:false}` means: the link belongs to someone else or was already in that
    // state. Without feedback the button seems broken.
    if (r.error) say(r.error);
    else if (r.ok === false) { say(t('Nothing to change — perhaps already done?')); await load(); }
    else await load();
  };

  const remove = async (s: Share) => {
    if (!confirm(t('Delete the link "{name}" for good?\n\nIt cannot be opened afterwards and the access figures are gone. Just switching it off is usually enough.',
      { name: s.title || s.slug }))) return;
    const r = await fetch(`/api/shares/${s.id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({}));
    if (r.ok) { say(t('Link deleted.')); await load(); } else say(r.error || t('That did not work.'));
  };

  const copy = async (s: Share) => {
    const url = `${location.origin}/s/${s.slug}`;
    try { await navigator.clipboard.writeText(url); } catch { prompt(t('Copy link:'), url); }
    setCopied(s.id); setTimeout(() => setCopied(null), 2000);
  };

  const details = async (s: Share) => {
    if (open === s.id) { setOpen(null); return; }
    setOpen(s.id);
    // Load again on every unfolding — otherwise the list shows an old state the
    // second time round without anyone noticing.
    const r = await fetch(`/api/shares/${s.id}`).then((x) => x.json()).catch(() => ({ visits: [] }));
    setVisits((z) => ({ ...z, [s.id]: r.visits || [] }));
  };

  if (loading) return <p className="tw-empty">{t('One moment …')}</p>;

  // One sentence, one key, with the link and the emphasis kept: the slots are
  // split out of the translated sentence so both land where the language puts
  // them instead of the sentence being glued from three fragments.
  const emptyParts = t('Tap {share} in the {library} — then an entry appears here that you can switch off again at any time.')
    .split(/(\{share\}|\{library\})/);
  const privacyParts = t('What is recorded is {when} it was opened and with what kind of device — not {who}. Of the IP address only an encrypted fingerprint is stored, which is moreover tied to this one link; across several links nobody can be followed with it. After 90 days everything is deleted.')
    .split(/(\{when\}|\{who\})/);

  return (
    <div className="tw">
      {msg && <div className="tw-toast" role="status">{msg}</div>}

      {loadError ? (
        <div className="tw-empty-box">
          <span className="regmark" />
          <h2>{t('The list could not be loaded')}</h2>
          <p>{t('Maybe the connection was briefly gone. Your links are not affected by it.')}</p>
          <p><button className="tw-btn strong" onClick={() => { setLoading(true); load(); }}>{t('Try again')}</button></p>
        </div>
      ) : !shares.length ? (
        <div className="tw-empty-box">
          <span className="regmark" />
          <h2>{t('Nothing shared yet')}</h2>
          <p>{emptyParts.map((p, i) =>
            p === '{share}' ? <b key={i}>{t('Share')}</b>
            : p === '{library}' ? <a key={i} href="/library">{t('library')}</a>
            : p)}</p>
        </div>
      ) : (
        <div className="tw-list">
          {shares.map((s) => {
            const z = state(s);
            return (
              <article key={s.id} className={`tw-card ${z}`}>
                <div className="tw-head">
                  <div className="tw-title">
                    <h3>{s.title || (s.count > 1 ? t('{n} images', { n: s.count }) : t('One image'))}</h3>
                    <span className={`tw-status ${z}`}>
                      {z === 'active' ? t('active') : z === 'off' ? t('switched off') : t('expired')}
                    </span>
                    {s.password_hash && <span className="tw-protected" title={t('Protected with a passphrase')}>{t('protected')}</span>}
                  </div>
                  <div className="tw-counts">
                    <span><b>{s.views}</b> {t('views')}</span>
                    <span><b>{s.downloads}</b> {t('downloads')}</span>
                    <span><b>{s.visitor}</b> {s.visitor === 1 ? t('visitor') : t('visitors')}</span>
                  </div>
                </div>

                <div className="tw-meta">
                  {s.count === 1 ? t('{n} image', { n: s.count }) : t('{n} images', { n: s.count })} ·
                  {' '}{s.expires_at ? t('valid until {date}', { date: date(s.expires_at) }) : t('without expiry')} ·
                  {' '}{t('created {date}', { date: date(s.created_at) })}
                  {s.last_seen_at && <> · {t('last seen {time}', { time: time(s.last_seen_at) })}</>}
                  {!s.allow_download && <> · {t('view only')}</>}
                </div>

                <div className="tw-row">
                  <input className="tw-link" readOnly value={`${location.origin}/s/${s.slug}`}
                    onFocus={(e) => e.currentTarget.select()} aria-label={t('Share link')} />
                  <button className="tw-btn" onClick={() => copy(s)}>{copied === s.id ? t('Copied ✓') : t('Copy')}</button>
                  <a className="tw-btn" href={`/s/${s.slug}`} target="_blank" rel="noopener">{t('Open')}</a>
                </div>

                <div className="tw-actions">
                  {z === 'off'
                    ? <button className="tw-btn strong" onClick={() => patch(s.id, { action: 'unrevoke' })}>{t('Switch back on')}</button>
                    : <button className="tw-btn" onClick={() => patch(s.id, { action: 'revoke' })}>{t('Switch off')}</button>}
                  <select className="tw-btn" value="" onChange={(e) => e.target.value !== '' && patch(s.id, { days: Number(e.target.value) })}
                    aria-label={t('Change validity')}>
                    <option value="" disabled>{t('Change validity …')}</option>
                    {DAYS.map((d) => <option key={d.v} value={d.v}>{t(d.label)}</option>)}
                  </select>
                  <button className="tw-btn" onClick={() => patch(s.id, { allowDownload: !s.allow_download })}>
                    {s.allow_download ? t('Block download') : t('Allow download')}
                  </button>
                  <button className="tw-btn" onClick={() => {
                    const w = prompt(s.password_hash
                      ? t('New passphrase (leave empty = remove protection):')
                      : t('Set passphrase:'));
                    if (w !== null) patch(s.id, { password: w });
                  }}>{s.password_hash ? t('Change passphrase') : t('Set passphrase')}</button>
                  <button className="tw-btn" onClick={() => details(s)}>{open === s.id ? t('Hide visits') : t('Visits')}</button>
                  <button className="tw-btn danger" onClick={() => remove(s)}>{t('Delete')}</button>
                </div>

                {open === s.id && (
                  <div className="tw-visits">
                    {!visits[s.id]?.length ? <p className="tw-hint">{t('No visits yet.')}</p> : (
                      <ul>
                        {visits[s.id].slice(0, 30).map((v, i) => (
                          <li key={i}>
                            <span className="tw-kind">{v.kind === 'download' ? t('Download') : t('View')}</span>
                            <span className="tw-when">{time(v.at)}</span>
                            <span className="tw-ua">{(v.user_agent || '').slice(0, 60)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="tw-hint">{privacyParts.map((p, i) =>
                      p === '{when}' ? <b key={i}>{t('when')}</b>
                      : p === '{who}' ? <b key={i}>{t('who')}</b>
                      : p)}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <style>{`
        .tw{display:grid;gap:14px;}
        .tw-empty{color:var(--soft);}
        .tw-empty-box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
          padding:44px 24px;text-align:center;}
        .tw-empty-box h2{margin:14px 0 8px;font-size:1.15rem;}
        .tw-empty-box p{margin:0;color:var(--ink-soft);line-height:1.6;}
        .tw-toast{position:sticky;top:70px;z-index:5;background:var(--ink);color:var(--card);
          padding:10px 14px;border-radius:var(--radius-sm);font-size:.9rem;}
        .tw-list{display:grid;gap:12px;}
        .tw-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
          padding:16px;display:grid;gap:11px;}
        .tw-card.off,.tw-card.expired{background:var(--paper);}
        .tw-head{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;justify-content:space-between;}
        .tw-title{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0;}
        .tw-title h3{margin:0;font-size:1rem;letter-spacing:-.01em;overflow-wrap:anywhere;}
        .tw-status{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;
          padding:3px 8px;border-radius:20px;}
        .tw-status.active{background:oklch(60% .15 150 / .14);color:oklch(42% .13 150);}
        .tw-status.off{background:oklch(55% .19 25 / .12);color:var(--err);}
        .tw-status.expired{background:var(--paper);color:var(--soft);border:1px solid var(--line);}
        .tw-protected{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;
          padding:3px 8px;border-radius:20px;background:oklch(72% .15 75 / .16);color:oklch(48% .13 75);}
        .tw-counts{display:flex;gap:14px;font-size:.78rem;color:var(--soft);white-space:nowrap;}
        .tw-counts b{color:var(--ink);font-size:.95rem;}
        .tw-meta{font-size:.8rem;color:var(--soft);line-height:1.5;}
        .tw-row{display:flex;gap:7px;}
        .tw-link{flex:1;min-width:0;padding:9px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);
          background:var(--paper);font-family:var(--font-mono);font-size:12px;color:var(--ink);}
        .tw-actions{display:flex;flex-wrap:wrap;gap:6px;}
        .tw-btn{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);
          padding:8px 11px;font-size:.82rem;cursor:pointer;font-family:inherit;color:var(--ink);
          text-decoration:none;display:inline-block;white-space:nowrap;}
        .tw-btn:hover{border-color:var(--accent);}
        .tw-btn.strong{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600;}
        .tw-btn.danger{color:var(--err);}
        .tw-visits{border-top:1px solid var(--line);padding-top:11px;}
        .tw-visits ul{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:5px;max-height:260px;overflow:auto;}
        .tw-visits li{display:grid;grid-template-columns:82px 118px minmax(0,1fr);gap:8px;
          font-size:.76rem;align-items:baseline;}
        .tw-kind{font-weight:600;}
        .tw-when{font-family:var(--font-mono);font-size:10.5px;color:var(--soft);}
        .tw-ua{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .tw-hint{font-size:.76rem;color:var(--soft);line-height:1.5;margin:0;}
        @media(max-width:640px){
          .tw-head{flex-direction:column;gap:8px;}
          .tw-counts{gap:12px;}
          .tw-row{flex-wrap:wrap;}
          .tw-link{flex-basis:100%;}
          .tw-btn{flex:1;text-align:center;padding:11px 10px;}
          .tw-visits li{grid-template-columns:74px 1fr;}
          .tw-ua{display:none;}
        }
      `}</style>
    </div>
  );
}
