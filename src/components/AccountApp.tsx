import { useEffect, useState } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

/**
 * Your own account: store an email address and switch notifications on or off.
 *
 * The address is at the same time the way to reset a forgotten password — that
 * is spelled out here as well, so nobody mistakes it for pure advertising mail.
 */
interface Me {
  username: string | null; display_name: string | null;
  email: string | null; notify_jobs: boolean; mail_ready: boolean; role: string;
}

export default function AccountApp({ locale, dict }: { locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    fetch('/api/me')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((m) => { setMe(m); setEmail(m.email || ''); })
      // Without this branch it said "One moment …" here for ever.
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const say = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };

  const patch = async (body: unknown, success: string) => {
    // Take on the new value right away, otherwise the checkbox jumps back to
    // the old state on rerender and you click a second time by accident.
    setMe((m) => (m ? { ...m, ...(body as object) } as Me : m));
    setBusy(true);
    const r = await fetch('/api/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((x) => x.json()).catch(() => ({ error: t('Network error.') }));
    setBusy(false);
    if (r.error) { say(r.error, false); return false; }
    say(success, true);
    const m = await fetch('/api/me').then((x) => x.json()).catch(() => null);
    if (m) setMe(m);
    return true;
  };

  if (loadError) return (
    <div className="ac">
      <section className="ac-card"><div className="ac-body">
        <p className="ac-hint">{t('Your account could not be loaded just now — maybe the connection was gone for a moment.')}</p>
        <button className="ac-btn strong" onClick={load}>{t('Try again')}</button>
      </div></section>
    </div>
  );
  if (!me) return <p className="ac-hint">{t('One moment …')}</p>;

  return (
    <div className="ac">
      <section className="ac-card">
        <div className="ac-head"><span className="mono-label">{t('Sign in')}</span></div>
        <div className="ac-body">
          <div className="ac-row">
            <span className="ac-label">{t('Username')}</span>
            <span className="ac-value">{me.username}</span>
          </div>
          {me.display_name && (
            <div className="ac-row">
              <span className="ac-label">{t('Shown as')}</span>
              <span className="ac-value">{me.display_name}</span>
            </div>
          )}
          <div className="ac-row">
            <span className="ac-label">{t('Password')}</span>
            <span className="ac-value"><a href="/password">{t('Set a new password')}</a></span>
          </div>
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-head"><span className="mono-label">{t('Email address')}</span></div>
        <div className="ac-body">
          <p className="ac-hint">
            {t('This lets you have a new password sent to you if you have forgotten yours. Without an address on file that is not possible — then an admin has to step in.')}
          </p>
          <div className="ac-input">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" aria-label={t('Email address')} autoComplete="email" />
            <button className="ac-btn strong" disabled={busy || email === (me.email || '')}
              onClick={() => patch({ email }, email ? t('Address saved.') : t('Address removed.'))}>
              {t('Save')}
            </button>
          </div>
          {!me.mail_ready && (
            <p className="ac-warn">
              {t('No mail sending is set up on this server yet — the address is stored, but nothing arrives yet. An admin sets that up under Admin → Email.')}
            </p>
          )}
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-head"><span className="mono-label">{t('Notifications')}</span></div>
        <div className="ac-body">
          <label className="ac-toggle">
            <input type="checkbox" checked={me.notify_jobs} disabled={!me.email || busy}
              onChange={(e) => patch({ notify_jobs: e.target.checked },
                e.target.checked ? t('Notices switched on.') : t('Notices switched off.'))} />
            <span>
              <b>{t('Tell me when a job is finished')}</b>
              <em>{t('One short mail per job — no newsletter, no advertising.')}
                {!me.email && ' ' + t('For that you first need an email address (above).')}</em>
            </span>
          </label>
          <p className="ac-hint">
            {t('Jobs from a private session deliberately never trigger a mail — the whole point is that they leave no trace.')}
          </p>
        </div>
      </section>

      {msg && <p className={`ac-msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</p>}

      <style>{`
        .ac{display:grid;gap:14px;max-width:620px;}
        .ac-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
        .ac-head{padding:13px 16px;border-bottom:1px solid var(--line);}
        .ac-body{padding:16px;display:grid;gap:12px;}
        .ac-row{display:flex;gap:12px;justify-content:space-between;align-items:baseline;
          padding-bottom:9px;border-bottom:1px solid var(--line);font-size:.92rem;}
        .ac-row:last-child{border-bottom:none;padding-bottom:0;}
        .ac-label{color:var(--soft);font-size:.85rem;}
        .ac-value{font-weight:500;overflow-wrap:anywhere;text-align:right;}
        .ac-value a{color:var(--accent);}
        .ac-hint{margin:0;font-size:.85rem;color:var(--ink-soft);line-height:1.6;}
        .ac-input{display:flex;gap:8px;}
        .ac-input input{flex:1;min-width:0;padding:11px 12px;border:1px solid var(--line);
          border-radius:var(--radius-sm);background:var(--paper);color:var(--ink);font-size:16px;font-family:inherit;}
        .ac-btn{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);
          color:var(--ink);padding:11px 16px;font-size:.9rem;cursor:pointer;font-family:inherit;white-space:nowrap;}
        .ac-btn.strong{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600;}
        .ac-btn:disabled{background:var(--paper);color:var(--soft);border-color:var(--line);cursor:not-allowed;}
        .ac-toggle{display:flex;gap:11px;align-items:flex-start;cursor:pointer;font-size:.92rem;}
        .ac-toggle input{width:19px;height:19px;margin-top:2px;flex:none;accent-color:var(--accent);}
        .ac-toggle input:disabled{cursor:not-allowed;}
        .ac-toggle b{display:block;}
        .ac-toggle em{display:block;font-style:normal;color:var(--soft);font-size:.82rem;margin-top:3px;line-height:1.5;}
        .ac-warn{margin:0;padding:10px 12px;border:1px solid var(--warn);border-radius:var(--radius-sm);
          background:oklch(72% .15 75 / .08);font-size:.82rem;line-height:1.55;}
        .ac-msg{margin:0;font-size:.9rem;}
        .ac-msg.ok{color:var(--ok);}
        .ac-msg.err{color:var(--err);}
        @media(max-width:560px){
          .ac-input{flex-direction:column;}
          .ac-btn{width:100%;padding:13px;}
          .ac-row{flex-direction:column;gap:3px;}
          .ac-value{text-align:left;}
        }
      `}</style>
    </div>
  );
}
