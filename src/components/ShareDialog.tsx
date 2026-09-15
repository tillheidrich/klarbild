import { useEffect, useRef, useState } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

/**
 * Share dialog: turn a picture selection into a link and hand it on.
 *
 * Deliberately in two steps — settings first, then handing it on. The link comes
 * into being on the click on "Create link"; until then nothing is public. After
 * that the same dialog shows the routes: copy, WhatsApp, email.
 */
export interface ShareTarget { itemIds: string[]; title?: string }

const DAYS = [
  { v: 7, label: '7 days' },
  { v: 30, label: '30 days' },
  { v: 90, label: '3 months' },
  { v: 365, label: '1 year' },
  { v: 0, label: 'no expiry' },
];

export default function ShareDialog(
  { target, onClose, onDone, locale, dict }:
    { target: ShareTarget; onClose: () => void; onDone?: () => void; locale?: Locale; dict?: Dict | null },
) {
  const t = useT(dict);
  const many = target.itemIds.length > 1;
  const [title, setTitle] = useState(target.title || '');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(30);
  const [download, setDownload] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [link, setLink] = useState<{ slug: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [mailTo, setMailTo] = useState('');
  const [mailText, setMailText] = useState('');
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const url = link ? `${location.origin}/s/${link.slug}` : '';

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((m) => {
      setMailReady(!!m.mail_ready);
      // Take over the default from the admin area — otherwise the setting there
      // promises something that never arrives here.
      if (typeof m.share_default_days === 'number') setDays(m.share_default_days);
    }).catch(() => setMailReady(null));
  }, []);

  // Trap the focus and hold the background still while the dialog is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const f = box.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea');
      if (!f?.length) return;
      const [first, last] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previous; };
  }, [onClose]);

  const create = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/shares', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIds: target.itemIds, title: title || null, note: note || null,
        days, allowDownload: download, password: passphrase || null,
      }),
    }).then((x) => x.json()).catch(() => ({ error: t('Network error.') }));
    setBusy(false);
    if (r.error) { setMsg({ t: r.error, ok: false }); return; }
    setLink({ slug: r.share.slug, id: r.share.id });
    onDone?.();
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch {
      // Without clipboard permission: select the field so it can be copied by hand.
      box.current?.querySelector<HTMLInputElement>('.linkfield')?.select();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const waText = `${title || t('Images')}\n${url}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  const sendMail = async () => {
    if (!mailTo.trim()) { setMsg({ t: t('Enter a recipient address.'), ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await fetch('/api/shares/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId: link!.id, to: mailTo, message: mailText }),
    }).then((x) => x.json()).catch(() => ({ error: t('Network error.') }));
    setBusy(false);
    if (r.error) { setMsg({ t: r.error, ok: false }); return; }
    // Partial success is success: before, a text pattern match coloured
    // "2 sent, 1 did not go through." entirely red.
    setMsg(r.failed?.length
      ? { t: t('{sent} sent, {failed} did not go through.', { sent: r.ok, failed: r.failed.length }), ok: r.ok > 0 }
      : { t: r.ok === 1 ? t('Sent to the address.') : t('Sent to {n} addresses.', { n: r.ok }), ok: true });
    setMailTo('');
  };

  // Two sentences, one key, with the passphrase kept in bold: the {passphrase}
  // slot is split out of the translated sentence so the word lands where the
  // language puts it instead of the sentence being glued from two halves.
  const warn = t('The link is protected with {passphrase}. Send the passphrase separately from the link — otherwise the protection is worth nothing.')
    .split('{passphrase}');
  const mailHint = t('Sending email straight from here is not set up yet — an admin can add that under {where}. Copying and WhatsApp work regardless.')
    .split('{where}');

  return (
    <div className="tl-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tl-box" ref={box} role="dialog" aria-modal="true" aria-label={t('Share')}>
        <div className="tl-head">
          <h2>{many ? t('Share {n} images', { n: target.itemIds.length }) : t('Share image')}</h2>
          <button className="tl-x" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>

        {!link ? (
          <div className="tl-body">
            <p className="tl-lead">
              {t('This creates a link that someone without a Klarbild account can open too. It expires by itself and can be switched off again at any time.')}
            </p>

            <label className="tl-field">{t('Heading')}
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={many ? t('e.g. Nursery photos August') : t('e.g. Ada in the garden')} maxLength={120} />
            </label>

            <label className="tl-field">{t('Valid for')}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {DAYS.map((d) => <option key={d.v} value={d.v}>{t(d.label)}</option>)}
              </select>
            </label>

            {/* The common case is "one picture for grandma" — that one needs none of
                this. Folded away, with a summary that names the current state. */}
            <details className="tl-more">
              <summary>
                <span>{t('More settings')}</span>
                <em>{download ? t('download allowed') : t('view only')}
                  {' · '}{passphrase ? t('with passphrase') : t('without passphrase')}</em>
              </summary>
              <div className="tl-more-body">
                <label className="tl-field">{t('Message on the page')}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder={t('Shown above the pictures')} maxLength={500} />
                </label>

                <label className="tl-check">
                  <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
                  <span><b>{t('Allow downloading')}</b><em>{t('Without the tick the pictures can only be viewed.')}</em></span>
                </label>

                <label className="tl-field">{t('Passphrase')}
                  <input type="text" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={t('Empty = everyone with the link gets in')} maxLength={100} />
                  <span className="tl-hint">{t('Send the passphrase by a different route than the link.')}</span>
                </label>
              </div>
            </details>

            {msg && <p className={`tl-msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.t}</p>}
            <div className="tl-foot">
              <button className="tl-secondary" onClick={onClose}>{t('Cancel')}</button>
              <button className="tl-primary" onClick={create} disabled={busy}>
                {busy ? t('One moment …') : t('Create link')}
              </button>
            </div>
          </div>
        ) : (
          <div className="tl-body">
            <p className="tl-lead">{t('The link is there. This is how it reaches the recipient:')}</p>

            <div className="tl-linkrow">
              <input className="linkfield" value={url} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={t('Share link')} />
              <button className="tl-primary" onClick={copy}>{copied ? t('Copied ✓') : t('Copy')}</button>
            </div>

            <div className="tl-ways">
              <a className="tl-way wa" href={waHref} target="_blank" rel="noopener">
                <span className="tl-way-title">WhatsApp</span>
                <span className="tl-way-hint">{t('Opens WhatsApp with the text ready')}</span>
              </a>
              <a className="tl-way" href={`mailto:?subject=${encodeURIComponent(title || t('Images'))}&body=${encodeURIComponent(waText)}`}>
                <span className="tl-way-title">{t('Your own mail program')}</span>
                <span className="tl-way-hint">{t('Opens your mail app')}</span>
              </a>
            </div>

            {passphrase && (
              <p className="tl-warn">
                {warn[0]}<b>{passphrase}</b>{warn[1]}
              </p>
            )}

            <div className="tl-divider"><span>{t('or send it straight from here')}</span></div>

            {mailReady === null ? null : mailReady ? (
              <>
                <label className="tl-field">{t('To')}
                  <input value={mailTo} onChange={(e) => setMailTo(e.target.value)} type="email"
                    placeholder={t('grandma@example.com, grandpa@example.com')} />
                  <span className="tl-hint">{t('Separate several addresses with a comma.')}</span>
                </label>
                <label className="tl-field"><span className="tl-fieldhead">{t('Add a note')} <em>{t('optional')}</em></span>
                  <textarea value={mailText} onChange={(e) => setMailText(e.target.value)} rows={2}
                    placeholder={t('A few lines for the recipient')} maxLength={1000} />
                </label>
                <button className="tl-secondary wide" onClick={sendMail} disabled={busy}>
                  {busy ? t('Sending …') : t('Send by email')}
                </button>
              </>
            ) : (
              <p className="tl-hint">
                {mailHint[0]}<b>{t('Admin → Email')}</b>{mailHint[1]}
              </p>
            )}

            {msg && <p className={`tl-msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.t}</p>}

            <div className="tl-foot">
              <a className="tl-secondary" href="/shares">{t('Manage all links')}</a>
              <button className="tl-secondary" onClick={onClose}>{t('Done')}</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .tl-backdrop{position:fixed;inset:0;z-index:80;background:rgba(22,21,15,.55);
          display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);}
        .tl-box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
          width:min(520px,100%);max-height:min(88vh,760px);display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(22,21,15,.25);}
        .tl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
          padding:16px 18px;border-bottom:1px solid var(--line);}
        .tl-head h2{margin:0;font-size:1.05rem;letter-spacing:-.01em;}
        .tl-x{border:none;background:none;font-size:17px;cursor:pointer;color:var(--soft);
          width:34px;height:34px;border-radius:50%;line-height:1;}
        .tl-x:hover{background:var(--paper);color:var(--ink);}
        .tl-body{padding:18px;overflow:auto;display:grid;gap:14px;}
        .tl-lead{margin:0;font-size:.9rem;color:var(--ink-soft);line-height:1.6;}
        .tl-field{display:grid;gap:6px;font-size:.86rem;color:var(--ink-soft);}
        .tl-field input,.tl-field select,.tl-field textarea{padding:10px 11px;border:1px solid var(--line);
          border-radius:var(--radius-sm);background:var(--paper);color:var(--ink);font-size:16px;
          font-family:inherit;width:100%;box-sizing:border-box;}
        .tl-field textarea{resize:vertical;line-height:1.5;}
        .tl-fieldhead{display:flex;gap:6px;align-items:baseline;}
        .tl-fieldhead em{font-style:normal;color:var(--soft);font-size:.78rem;}
        .tl-hint{font-size:.78rem;color:var(--soft);line-height:1.5;}
        .tl-check{display:flex;gap:10px;align-items:flex-start;font-size:.88rem;cursor:pointer;}
        .tl-check input{width:18px;height:18px;margin-top:2px;flex:none;accent-color:var(--accent);}
        .tl-check b{display:block;font-weight:600;color:var(--ink);}
        .tl-check em{display:block;font-style:normal;color:var(--soft);font-size:.8rem;margin-top:2px;}
        .tl-linkrow{display:flex;gap:8px;}
        .tl-linkrow input{flex:1;min-width:0;padding:10px 11px;border:1px solid var(--line);
          border-radius:var(--radius-sm);background:var(--paper);font-family:var(--font-mono);
          font-size:12.5px;color:var(--ink);}
        .tl-primary{border:none;border-radius:var(--radius-sm);background:var(--accent);color:#fff;
          padding:11px 16px;font-weight:600;font-size:.92rem;cursor:pointer;font-family:inherit;white-space:nowrap;}
        .tl-primary.wide,.tl-secondary.wide{width:100%;}
        .tl-primary:disabled{background:var(--paper);color:var(--soft);border:1px solid var(--line);cursor:not-allowed;}
        .tl-secondary{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);
          color:var(--ink);padding:11px 16px;font-size:.92rem;cursor:pointer;font-family:inherit;
          text-decoration:none;display:inline-block;text-align:center;}
        .tl-ways{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .tl-way{display:grid;gap:2px;padding:11px 13px;border:1px solid var(--line);
          border-radius:var(--radius-sm);background:var(--paper);text-decoration:none;color:var(--ink);}
        .tl-way:hover{border-color:var(--accent);}
        .tl-way.wa{border-color:#25D366;}
        .tl-way-title{font-weight:600;font-size:.88rem;}
        .tl-way-hint{font-size:.75rem;color:var(--soft);line-height:1.4;}
        .tl-more{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper);}
        .tl-more>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;
          justify-content:space-between;gap:10px;padding:12px;font-size:.88rem;}
        .tl-more>summary>span{white-space:nowrap;}
        .tl-more>summary::-webkit-details-marker{display:none;}
        .tl-more>summary::after{content:'▾';color:var(--soft);font-size:11px;transition:transform .15s;}
        .tl-more[open]>summary::after{transform:rotate(180deg);}
        .tl-more>summary em{font-style:normal;font-size:.76rem;color:var(--soft);
          margin-left:auto;text-align:right;line-height:1.4;}
        .tl-more-body{display:grid;gap:12px;padding:0 12px 12px;}
        .tl-divider{display:flex;align-items:center;gap:10px;color:var(--soft);
          font-family:var(--font-mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;}
        .tl-divider::before,.tl-divider::after{content:'';flex:1;height:1px;background:var(--line);}
        .tl-warn{margin:0;padding:10px 12px;border:1px solid var(--warn);border-radius:var(--radius-sm);
          background:oklch(72% .15 75 / .08);font-size:.82rem;line-height:1.55;}
        .tl-msg{margin:0;font-size:.86rem;line-height:1.5;}
        .tl-msg.err{color:var(--err);}
        .tl-msg.ok{color:var(--ok);}
        .tl-foot{display:flex;gap:8px;justify-content:flex-end;padding-top:4px;}
        @media(max-width:560px){
          .tl-backdrop{padding:0;align-items:flex-end;}
          .tl-box{width:100%;max-height:92vh;border-radius:var(--radius) var(--radius) 0 0;
            padding-bottom:env(safe-area-inset-bottom);}
          .tl-ways{grid-template-columns:1fr;}
          .tl-foot{flex-direction:column-reverse;}
          .tl-foot>*{width:100%;}
          .tl-primary,.tl-secondary{padding:13px 16px;}
        }
      `}</style>
    </div>
  );
}
