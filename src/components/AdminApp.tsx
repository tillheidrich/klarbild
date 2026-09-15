import React, { useState, useEffect, useCallback } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

export default function AdminApp({ locale, dict }: { locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [s, setS] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [avail, setAvail] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [tgLinks, setTgLinks] = useState<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [orKey, setOrKey] = useState(''); const [dtPw, setDtPw] = useState(''); const [mirrorPw, setMirrorPw] = useState('');
  const [storage, setStorage] = useState<any>(null);
  const [rename, setRename] = useState<any>(null);   // dry run / result of the rename
  const [mailTo, setMailTo] = useState('');          // address for the test message
  const [smtpPw, setSmtpPw] = useState('');          // new mailbox password (never prefilled)
  const [targets, setTargets] = useState<any[]>([]);
  const [nt, setNt] = useState<any>({ protocol: 'sftp' });
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    const [a, b, c, d, e, f, g] = await Promise.all([
      fetch('/api/admin/settings').then((r) => r.json()),
      fetch('/api/admin/stats').then((r) => r.json()),
      fetch('/api/admin/models?available=1').then((r) => r.json()),
      fetch('/api/admin/users').then((r) => r.json()),
      fetch('/api/admin/telegram/links').then((r) => r.json()).catch(() => ({ links: [] })),
      fetch('/api/admin/storage').then((r) => r.json()).catch(() => ({ stats: null })),
      fetch('/api/admin/delivery-targets').then((r) => r.json()).catch(() => ({ targets: [] })),
    ]);
    setS(a.settings || {}); setStats(b); setModels(c.models || []); setAvail(c.available || []);
    setUsers(d.users || []); setTgLinks(e.links || []); setStorage(f.stats || null); setTargets(g.targets || []);
  }, []);
  const addTarget = async () => {
    if (!nt.name?.trim()) { notify(t('Name is missing.')); return; }
    await fetch('/api/admin/delivery-targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nt) });
    setNt({ protocol: 'sftp' }); notify(t('Target created.')); load();
  };
  const delTarget = async (id: string) => { if (!confirm(t('Delete target?'))) return; await fetch(`/api/admin/delivery-targets?id=${id}`, { method: 'DELETE' }); load(); };
  const toggleBackup = async (target: any) => {
    await fetch('/api/admin/delivery-targets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, is_backup: !target.is_backup }) });
    load();
  };
  const toggleTargetSidecar = async (target: any) => {
    await fetch('/api/admin/delivery-targets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id, metadata_sidecar: !target.metadata_sidecar }) });
    load();
  };
  const backupAllTargets = async () => {
    if (!confirm(t('Back up all finished images to every backup target (mirror + marked targets)?'))) return;
    notify(t('Backing up … (may take a while)'));
    const r = await fetch('/api/admin/delivery-targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backup_all' }) }).then((x) => x.json());
    notify(r.items != null
      ? (r.failed
        ? t('{n} copies to backup targets, {failed} errors.', { n: r.mirrored, failed: r.failed })
        : t('{n} copies to backup targets.', { n: r.mirrored }))
      : (r.error || 'OK'));
    load();
  };
  const genToken = async () => {
    await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generate_api_token: true }) });
    notify(t('API token generated.')); load();
  };
  const testTarget = async (id: string) => {
    notify(t('Testing target …'));
    const r = await fetch('/api/admin/delivery-targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) }).then((x) => x.json());
    notify(r.message || (r.ok ? 'OK' : t('Error')));
  };
  const fmtBytes = (n: number | null) => n == null ? '—'
    : n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;

  const pairCode = async (userId: string) => {
    const r = await fetch('/api/admin/telegram/pairing-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }).then((x) => x.json());
    if (r.code) alert(t('Pairing code: {code}\n\nValid for 15 minutes. Enter it in the Klarbild Telegram chat.', { code: r.code }));
  };
  const unlink = async (chat_id: number) => {
    await fetch('/api/admin/telegram/links', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id }) });
    load();
  };
  useEffect(() => { load(); }, [load]);

  const field = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));
  const saveSettings = async () => {
    const body: any = {
      delivery_host: s.delivery_host, delivery_protocol: s.delivery_protocol, delivery_port: s.delivery_port,
      delivery_user: s.delivery_user, delivery_base_path: s.delivery_base_path, delivery_default_folder: s.delivery_default_folder,
      default_dpi: s.default_dpi, default_crop_mode: s.default_crop_mode, concurrency: s.concurrency,
      output_ext: s.output_ext || 'png',
      cricut_sheet_cm: s.cricut_sheet_cm, monthly_budget: s.monthly_budget, n8n_webhook_url: s.n8n_webhook_url,
      keep_sources: !!s.keep_sources, make_thumbnails: s.make_thumbnails !== false, retention_days: s.retention_days,
      delivery_metadata_sidecar: !!s.delivery_metadata_sidecar, mirror_metadata_sidecar: !!s.mirror_metadata_sidecar,
      library_visibility: s.library_visibility || 'own', anonymous_generations: !!s.anonymous_generations,
      private_allowed: !!s.private_allowed, allow_nsfw: !!s.allow_nsfw,
      mirror_enabled: !!s.mirror_enabled, mirror_host: s.mirror_host, mirror_protocol: s.mirror_protocol, mirror_port: s.mirror_port,
      mirror_user: s.mirror_user, mirror_base_path: s.mirror_base_path,
      // Mail and sharing — without these lines the whole card was discarded
      // silently and the interface still reported "Saved."
      smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_secure: s.smtp_secure !== false,
      smtp_user: s.smtp_user, smtp_from: s.smtp_from,
      share_default_days: s.share_default_days,
    };
    if (orKey.trim()) body.openrouter_key = orKey.trim();
    if (dtPw.trim()) body.delivery_password = dtPw.trim();
    if (mirrorPw.trim()) body.mirror_password = mirrorPw.trim();
    if (smtpPw.trim()) body.smtp_password = smtpPw.trim();
    const r = await fetch('/api/admin/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((x) => x.json()).catch(() => ({ error: t('Network error.') }));
    if (r?.error) { notify(r.error); return; }
    setOrKey(''); setDtPw(''); setMirrorPw(''); setSmtpPw(''); notify(t('Saved.')); load();
  };
  const testDeliveryTarget = async () => {
    notify(t('Testing …'));
    const r = await fetch('/api/admin/test-delivery', { method: 'POST' }).then((x) => x.json());
    notify(r.message || (r.ok ? 'OK' : t('Error')));
  };
  const [dtList, setDtList] = useState<any>(null);
  const lsDeliveryTarget = async (path?: string) => {
    notify(t('Reading folder on the delivery target …'));
    const r = await fetch('/api/admin/delivery-ls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then((x) => x.json());
    setDtList(r); notify(r.error ? r.error : t('{n} entries in {path}', { n: (r.entries || []).length, path: r.path }));
  };
  const cleanupDeliveryTarget = async () => {
    const gallery = s.delivery_default_folder || 'Gallery A';
    notify(t('Cleaning up leftovers …'));
    const r = await fetch('/api/admin/delivery-ls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cleanup_tmp', gallery }) }).then((x) => x.json());
    notify(r.error ? r.error : t('{n} leftovers removed from “{folder}”.', { n: r.cleaned ?? 0, folder: gallery }));
  };
  const testMirror = async () => {
    notify(t('Testing backup mirror …'));
    const r = await fetch('/api/admin/test-mirror', { method: 'POST' }).then((x) => x.json());
    notify(r.message || (r.ok ? 'OK' : t('Error')));
  };
  const netcheck = async () => {
    if (!s.mirror_host) { notify(t('Enter a host and save first.')); return; }
    notify(t('Checking reachability …'));
    const r = await fetch('/api/admin/netcheck', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: s.mirror_host, port: s.mirror_port || 22 }) }).then((x) => x.json());
    const dnsMsg = r.resolve ? (r.resolve.ok ? t('DNS ✓ ({address})', { address: r.resolve.address }) : t('DNS ✕ ({error})', { error: r.resolve.error })) : '';
    const tcpMsg = r.tcp ? (r.tcp.ok ? t('Port reachable in {ms}ms ✓', { ms: r.tcp.ms }) : t('not reachable: {error}', { error: r.tcp.error })) : (r.error || t('Error'));
    notify(`${dnsMsg}${dnsMsg ? ' · ' : ''}${tcpMsg}`);
  };
  const storageAction = async (action: string, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    notify(t('Cleaning up …'));
    const r = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).then((x) => x.json());
    notify(r.deleted != null ? t('{n} old items removed.', { n: r.deleted })
      : r.purged != null ? t('{n} source files deleted.', { n: r.purged })
      : r.made != null ? t('{n} preview images generated.', { n: r.made })
      : (r.error || 'OK'));
    load();
  };
  const testMail = async (withSend: boolean) => {
    if (withSend && !mailTo.trim()) { notify(t('Enter an address for the test message.')); return; }
    notify(withSend ? t('Sending test message …') : t('Checking connection …'));
    const r = await fetch('/api/admin/test-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSend ? { to: mailTo.trim() } : {}) }).then((x) => x.json());
    notify(r.message || (r.ok ? 'OK' : t('Error')));
  };

  // Unique file names — first show what would happen, then apply it.
  const renamePreview = async () => {
    notify(t('Checking file names …'));
    const r = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename_preview' }) }).then((x) => x.json());
    if (r.error) { notify(r.error); return; }
    setRename(r);
    notify(r.renamed
      ? (r.wereDuplicates
        ? t('{n} of {checked} images would get a new name — {dupes} names are currently used twice.', { n: r.renamed, checked: r.checked, dupes: r.wereDuplicates })
        : t('{n} of {checked} images would get a new name.', { n: r.renamed, checked: r.checked }))
      : t('All {checked} names are already unique.', { checked: r.checked }));
  };
  const renameApply = async () => {
    if (!rename) { notify(t('Run “Check library” first — then you can see what would change.')); return; }
    if (!confirm(t('Give every image in the library a unique name?\n\nThe files themselves stay untouched — they are stored under their ID. '
      + 'Copies already placed on the delivery target keep their old name; that is what “Deliver again” is for afterwards.'))) return;
    notify(t('Renaming …'));
    const r = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename_apply' }) }).then((x) => x.json());
    setRename(r);
    notify(r.error || t('{n} images renamed, {ok} were already fine.', { n: r.renamed, ok: r.unchanged }));
    load();
  };
  const redeliverAll = async () => {
    if (!confirm(t('Upload all already delivered images again — under the new name?\n\n'
      + 'The old files stay on the target and have to be removed there by hand. This can take a while.'))) return;
    notify(t('Delivering again … (may take a while)'));
    const r = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeliver_all' }) }).then((x) => x.json());
    notify(r.attempted != null
      ? (r.failed
        ? t('{ok}/{tried} delivered again, {failed} failed.', { ok: r.ok, tried: r.attempted, failed: r.failed })
        : t('{ok}/{tried} delivered again.', { ok: r.ok, tried: r.attempted }))
      : (r.error || t('Error')));
    load();
  };
  const mirrorAll = async () => {
    if (!s.mirror_enabled) { notify(t('Enable the backup mirror and save first.')); return; }
    if (!confirm(t('Back up all finished images to the mirror?'))) return;
    notify(t('Backing up to the mirror … (may take a while)'));
    const r = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mirror_all' }) }).then((x) => x.json());
    notify(r.total != null
      ? (r.failed
        ? t('{n}/{total} backed up to the mirror, {failed} failed.', { n: r.mirrored, total: r.total, failed: r.failed })
        : t('{n}/{total} backed up to the mirror.', { n: r.mirrored, total: r.total }))
      : (r.error || t('Error')));
    load();
  };
  const resetAll = async () => {
    const answer = prompt(t('WARNING: Deletes ALL images, jobs and folders irreversibly (users, settings, models & preset recipes stay).\n\nType RESET to confirm:'));
    if (answer !== 'RESET') { if (answer != null) notify(t('Cancelled — not confirmed.')); return; }
    notify(t('Resetting …'));
    const r = await fetch('/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET' }) }).then((x) => x.json());
    notify(r.ok ? t('Reset done: {n} images removed.', { n: r.deleted_items }) : (r.error || t('Error')));
    load();
  };
  const addModel = async (m: any) => {
    await fetch('/api/admin/models', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: m.model_id, label: m.name, supports_alpha: m.supports_alpha, active: true }) });
    load();
  };
  const modelAction = async (id: string, action: string) => {
    await fetch('/api/admin/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
    load();
  };
  const setPw = async (id: string) => {
    const pw = prompt(t('New password?')); if (!pw) return;
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password: pw }) });
    notify(t('Password set.'));
  };
  const setUserPrivate = async (id: string, v: boolean) => {
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, private_forced: v }) });
    load();
  };
  const addUser = async () => {
    const username = prompt(t('Username?')); if (!username) return;
    const password = prompt(t('Password?')); if (!password) return;
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    load();
  };

  if (!s) return <p className="hint">{t('Loading …')}</p>;
  const stored = new Set(models.map((m) => m.model_id));

  return (
    <div className="admin">
      {stats && (
        <section className="card">
          <div className="cardHead"><span className="mono-label">{t('Usage & cost')}</span></div>
          <div className="numbers">
            <div><b>{stats.total}</b><span>{t('Images total')}</span></div>
            <div><b>{stats.error_rate}%</b><span>{t('Error rate')}</span></div>
            <div><b>${stats.cost_30?.toFixed(2)}</b><span>{t('Cost 30 days')}</span></div>
            <div><b>${stats.cost_all?.toFixed(2)}</b><span>{t('Cost total')}</span></div>
          </div>
          <div className="hint">{t('Today ${today} · 7 days ${week}', { today: stats.cost_today?.toFixed(2), week: stats.cost_7?.toFixed(2) })}
            {stats.last_activity ? ` · ${t('last {when}', { when: new Date(stats.last_activity).toLocaleString() })}` : ''}</div>
        </section>
      )}

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Access & limits')}</span></div>
        <div className="controls">
          <div className="field"><label>{t('OpenRouter key')} {s.openrouter_key_set && <em>({s.openrouter_key_masked})</em>}</label>
            <input className="input" placeholder={s.openrouter_key_set ? t('Enter a new key to replace it') : 'sk-or-…'} value={orKey} onChange={(e) => setOrKey(e.target.value)} />
            <div className="hint">{t('Stored encrypted, takes precedence over the environment variable.')}</div>
          </div>
          <div className="field"><label>{t('Monthly budget ($)')}</label>
            <input className="input" type="number" step="0.5" value={s.monthly_budget ?? ''} onChange={(e) => field('monthly_budget', e.target.value)} />
            <div className="hint">{t('When it is reached the queue stops.')}</div>
          </div>
          <div className="two">
            <div className="field"><label>{t('Default dpi')}</label><input className="input" type="number" value={s.default_dpi ?? 300} onChange={(e) => field('default_dpi', e.target.value)} /></div>
            <div className="field"><label>{t('Concurrency')}</label><input className="input" type="number" value={s.concurrency ?? 2} onChange={(e) => field('concurrency', e.target.value)} /></div>
          </div>
          <div className="field"><label>{t('Cricut sheet size (cm)')}</label><input className="input" value={s.cricut_sheet_cm ?? ''} onChange={(e) => field('cricut_sheet_cm', e.target.value)} /></div>
          <div className="field"><label>{t('Default file format')}</label>
            <select className="input" value={s.output_ext ?? 'png'} onChange={(e) => field('output_ext', e.target.value)}>
              <option value="png">{t('PNG (lossless, large)')}</option>
              <option value="jpg">{t('JPG (small, easy on the delivery target)')}</option>
            </select>
            <div className="hint">{t('Applies to new conversions without their own format choice. Cut-out subjects always stay PNG.')}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Delivery target')}</span>
          <div className="row"><button className="mini" onClick={() => lsDeliveryTarget()}>{t('Show folder')}</button>
          <button className="mini" onClick={cleanupDeliveryTarget}>{t('Clean up leftovers')}</button>
          <button className="mini" onClick={testDeliveryTarget}>{t('Test connection')}</button></div></div>
        <div className="controls">
          <div className="two">
            <div className="field"><label>{t('Host')}</label><input className="input" value={s.delivery_host ?? ''} onChange={(e) => field('delivery_host', e.target.value)} /></div>
            <div className="field"><label>{t('Port')}</label><input className="input" type="number" value={s.delivery_port ?? 22} onChange={(e) => field('delivery_port', e.target.value)} /></div>
          </div>
          <div className="two">
            <div className="field"><label>{t('Protocol')}</label>
              <select className="input" value={s.delivery_protocol ?? 'sftp'} onChange={(e) => field('delivery_protocol', e.target.value)}>
                <option value="sftp">SFTP (22)</option><option value="ftps">FTPS (21)</option></select></div>
            <div className="field"><label>{t('User')}</label><input className="input" value={s.delivery_user ?? ''} onChange={(e) => field('delivery_user', e.target.value)} /></div>
          </div>
          <div className="field"><label>{t('Password')} {s.delivery_password_set && <em>({t('set')})</em>}</label>
            <input className="input" type="password" placeholder={s.delivery_password_set ? '••••••' : ''} value={dtPw} onChange={(e) => setDtPw(e.target.value)} /></div>
          <div className="two">
            <div className="field"><label>{t('Base folder (SFTP root)')}</label><input className="input" value={s.delivery_base_path ?? '/'} onChange={(e) => field('delivery_base_path', e.target.value)} /></div>
            <div className="field"><label>{t('Default folder on the target')}</label><input className="input" placeholder="Gallery A" value={s.delivery_default_folder ?? ''} onChange={(e) => field('delivery_default_folder', e.target.value)} /></div>
          </div>
          <label className="toggle"><input type="checkbox" checked={!!s.delivery_metadata_sidecar} onChange={(e) => field('delivery_metadata_sidecar', e.target.checked)} />
            <span><b>{t('Send the sidecar file (.md) to the delivery target')}</b><em>{t('Only switch this on if the target is supposed to process the text files — otherwise leave it off.')}</em></span></label>
          <div className="hint">{t('Images land in base folder / folder on the target — for example:')} <code>/ + Gallery A</code>{' '}
            {t('“Show folder” lists what actually sits where over SFTP.')}</div>
          {dtList && (
            <div className="dtlist">
              <div className="hint"><b>{dtList.path}</b>{dtList.error ? ` — ${dtList.error}` : ''}</div>
              {(dtList.entries || []).map((e: any, i: number) => (
                <div key={i} className="dtrow">
                  <button className="link2" onClick={() => lsDeliveryTarget((dtList.path.replace(/\/$/, '')) + '/' + e.name)}>{e.type === 'd' || e.type === 2 ? '📁' : '📄'} {e.name}</button>
                  <span className="hint">{e.size ? `${Math.round(e.size / 1024)} KB` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Storage & cleanup')}</span>
          {storage && <span className="hint">{t('{bytes} · {results} results · {sources} sources · {thumbs} previews',
            { bytes: fmtBytes(storage.bytes), results: storage.results, sources: storage.sources, thumbs: storage.thumbs })}</span>}</div>
        <div className="controls">
          <label className="toggle"><input type="checkbox" checked={s.make_thumbnails !== false} onChange={(e) => field('make_thumbnails', e.target.checked)} />
            <span><b>{t('Generate preview images')}</b><em>{t('Small, economical images for the library preview.')}</em></span></label>
          <label className="toggle"><input type="checkbox" checked={!s.keep_sources} onChange={(e) => field('keep_sources', !e.target.checked)} />
            <span><b>{t('Delete source images after processing')}</b><em>{t('Saves space — originals are removed once the result exists.')}</em></span></label>
          <div className="hint">{t('The metadata sidecar file (.md with prompt/model/format) can now be switched on and off per target — on the delivery target, on the backup mirror and on every FTP target separately (see the card for each).')}</div>
          <div className="field"><label>{t('Retention (days)')}</label>
            <input className="input" type="number" min={0} placeholder={t('empty = unlimited')} value={s.retention_days ?? ''} onChange={(e) => field('retention_days', e.target.value)} />
            <div className="hint">{t('Older images are removed automatically (daily). Empty = delete nothing.')}</div></div>
          <div className="row">
            <button className="mini" onClick={() => storageAction('purge_sources', t('Delete the source images of all finished items? Results are kept.'))}>{t('Delete sources now')}</button>
            <button className="mini" onClick={() => storageAction('rebuild_thumbs')}>{t('Generate missing preview images')}</button>
            {s.retention_days ? <button className="mini" onClick={() => storageAction('retention', t('Delete items older than {days} days now?', { days: s.retention_days }))}>{t('Apply retention now')}</button> : null}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Email')}</span>
          <div className="row">
            <button className="mini" onClick={() => testMail(false)}>{t('Test connection')}</button>
            <button className="mini" onClick={() => testMail(true)}>{t('Test message')}</button>
          </div></div>
        <div className="controls">
          <div className="hint">{t('Klarbild sends through your own mailbox — that way SPF and DKIM are right by themselves and no further provider is involved.')}{' '}
            {t('It is needed for password reset, notices about finished jobs and share links by mail.')}{' '}
            {t('The password is stored encrypted and never shown again.')}</div>
          {s.smtp_source === 'environment' && s.smtp_effective && (
            <div className="notice">
              {t('Sending already works — through the server setting ({user} on {host}:{port}).',
                { user: s.smtp_effective.user, host: s.smtp_effective.host, port: s.smtp_effective.port })}{' '}
              {t('The fields below are empty because nothing is entered here; that is fine.')}{' '}
              {t('Anyone who enters something here and saves it overwrites the server setting.')}
            </div>
          )}
          {s.smtp_source === 'database' && (
            <div className="notice">{t('Sending runs on what is entered here.')}</div>
          )}
          {!s.smtp_source && (
            <div className="notice warn">{t('No sending set up yet — forgotten password, job notices and mailing share links do not work until then.')}</div>
          )}
          <div className="two">
            <div className="field"><label>{t('Outgoing mail server')}</label>
              <input className="input" placeholder={t('e.g. smtp.example.com')} value={s.smtp_host ?? ''} onChange={(e) => field('smtp_host', e.target.value)} /></div>
            <div className="field"><label>{t('Port')}</label>
              <input className="input" type="number" placeholder="465" value={s.smtp_port ?? 465} onChange={(e) => field('smtp_port', e.target.value)} />
              <div className="hint">{t('465 = SSL · 587 = STARTTLS')}</div></div>
          </div>
          <label className="toggle"><input type="checkbox" checked={s.smtp_secure !== false} onChange={(e) => field('smtp_secure', e.target.checked)} />
            <span><b>{t('Connect encrypted (SSL)')}</b><em>{t('On for port 465, off for 587.')}</em></span></label>
          <div className="two">
            <div className="field"><label>{t('Username')}</label>
              <input className="input" placeholder="mail@your-domain.com" value={s.smtp_user ?? ''} onChange={(e) => field('smtp_user', e.target.value)} /></div>
            <div className="field"><label>{t('Password')} {s.smtp_password_set ? <span className="hint">· {t('set')}</span> : null}</label>
              <input className="input" type="password" value={smtpPw} autoComplete="new-password"
                placeholder={s.smtp_password_set ? t('leave unchanged') : t('Mailbox password')}
                onChange={(e) => setSmtpPw(e.target.value)} /></div>
          </div>
          <div className="field"><label>{t('Sender')}</label>
            <input className="input" placeholder="Klarbild &lt;mail@your-domain.com&gt;" value={s.smtp_from ?? ''} onChange={(e) => field('smtp_from', e.target.value)} />
            <div className="hint">{t('Empty = username. It has to belong to the mailbox, otherwise recipients reject the mail.')}</div></div>
          <div className="field"><label>{t('Test message to')}</label>
            <input className="input" type="email" placeholder="you@example.com" value={mailTo} onChange={(e) => setMailTo(e.target.value)} />
            <div className="hint">{t('“Test connection” only checks the login. Only the test message proves that the mail really arrives — look in the spam folder too.')}</div></div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Share links')}</span></div>
        <div className="controls">
          <div className="field"><label>{t('Default expiry (days)')}</label>
            <input className="input" type="number" min={0} max={3650} value={s.share_default_days ?? 30}
              onChange={(e) => field('share_default_days', e.target.value)} />
            <div className="hint">{t('Default for new links; changeable at any time when one is created.')} <b>{t('0 = unlimited.')}</b>{' '}
              {t('There are children in the images — a link that expires by itself is the safe default.')}</div></div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('File names')}</span>
          <span className="hint">{t('YYYY-MM-DD_HHMMSS_subject_format_shortid')}</span></div>
        <div className="controls">
          <div className="hint">{t('Every result gets a name that starts with date and time — that way every file list sorts chronologically by itself — and ends with a short id taken from the image ID.')}{' '}
            {t('That way two similar images from the same day can no longer overwrite each other.')}{' '}
            {t('Example:')} <code>2026-08-20_143207_portrait_the-frame_a3f9.jpg</code></div>
          <div className="row">
            <button className="mini" onClick={renamePreview}>{t('Check library')}</button>
            <button className="mini" onClick={renameApply}>{t('Rename now')}</button>
            <button className="mini" onClick={redeliverAll}>{t('Deliver again')}</button>
          </div>
          {rename && (
            <div className="hint">
              <b>{t('{n} images checked', { n: rename.checked })}</b> ·{' '}
              {rename.dryRun
                ? t('{n} would get a new name', { n: rename.renamed })
                : t('{n} renamed', { n: rename.renamed })} ·
              {' '}{t('{n} unchanged', { n: rename.unchanged })}
              {rename.wereDuplicates ? ` · ${t('{n} names were used twice', { n: rename.wereDuplicates })}` : ''}
              {rename.examples?.length ? (
                <ul className="namelist">
                  {rename.examples.map((b: any) => (
                    <li key={b.id}><s>{b.before}</s> → <code>{b.after}</code></li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <div className="hint">{t('“Deliver again” uploads every already delivered image to the target again under the new name. The old files stay there — deleting something at the client automatically would be the wrong reflex; you do that on the delivery target yourself.')}</div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Backup mirror (second copy)')}</span>
          <div className="row"><button className="mini" onClick={netcheck}>{t('Reachability')}</button>
          <button className="mini" onClick={testMirror}>{t('Test connection')}</button></div></div>
        <div className="controls">
          <label className="toggle"><input type="checkbox" checked={!!s.mirror_enabled} onChange={(e) => field('mirror_enabled', e.target.checked)} />
            <span><b>{t('Mirror results to the backup mirror as well')}</b><em>{t('Every finished image is backed up to {path}.', { path: 'klarbild/YYYY-MM/' })}</em></span></label>
          <div className="two">
            <div className="field"><label>{t('Host')}</label><input className="input" placeholder={t('e.g. mirror.local or DDNS')} value={s.mirror_host ?? ''} onChange={(e) => field('mirror_host', e.target.value)} /></div>
            <div className="field"><label>{t('Port')}</label><input className="input" type="number" value={s.mirror_port ?? 22} onChange={(e) => field('mirror_port', e.target.value)} /></div>
          </div>
          <div className="two">
            <div className="field"><label>{t('Protocol')}</label>
              <select className="input" value={s.mirror_protocol ?? 'sftp'} onChange={(e) => field('mirror_protocol', e.target.value)}>
                <option value="sftp">SFTP (22)</option><option value="ftps">FTPS (21)</option></select></div>
            <div className="field"><label>{t('User')}</label><input className="input" value={s.mirror_user ?? ''} onChange={(e) => field('mirror_user', e.target.value)} /></div>
          </div>
          <div className="field"><label>{t('Password')} {s.mirror_password_set && <em>({t('set')})</em>}</label>
            <input className="input" type="password" placeholder={s.mirror_password_set ? '••••••' : ''} value={mirrorPw} onChange={(e) => setMirrorPw(e.target.value)} /></div>
          <div className="field"><label>{t('Base folder on the mirror')}</label><input className="input" placeholder="/Klarbild" value={s.mirror_base_path ?? ''} onChange={(e) => field('mirror_base_path', e.target.value)} /></div>
          <label className="toggle"><input type="checkbox" checked={!!s.mirror_metadata_sidecar} onChange={(e) => field('mirror_metadata_sidecar', e.target.checked)} />
            <span><b>{t('Send the sidecar file (.md) to the mirror')}</b><em>{t('Companion text file (prompt, model, format …) next to every backed-up image.')}</em></span></label>
          <button className="mini" onClick={mirrorAll}>{t('Back up all existing images to the mirror')}</button>
          <div className="hint">{t('Results land under base folder / YYYY-MM /. Credentials are stored encrypted.')}</div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('More output targets (FTP/SFTP)')}</span>
          <button className="mini" onClick={backupAllTargets}>{t('Back up all images')}</button></div>
        <div className="controls">
          <div className="hint">{t('Additional FTP/SFTP targets — for example a second folder on the delivery target or another server.')}{' '}
            {t('A preset/folder can point at one target permanently; selectable in the studio under “Where to?” (the backup mirror too).')}{' '}
            {t('“Backup” targets automatically receive all results (like the backup mirror).')}</div>
          <div className="list">
            {targets.map((tg) => (
              <div key={tg.id} className="item">
                <div><b>{tg.name}</b>{tg.is_backup && <span className="pill">{t('Backup')}</span>}{tg.metadata_sidecar && <span className="pill alpha">.md</span>} <span className="hint">{tg.protocol}://{tg.username}@{tg.host}:{tg.port} · {tg.base_path || '/'}{tg.password_set ? '' : ` · ⚠︎ ${t('no password')}`}</span></div>
                <div className="row">
                  <button className="mini" onClick={() => toggleBackup(tg)}>{tg.is_backup ? t('Backup off') : t('As backup')}</button>
                  <button className="mini" onClick={() => toggleTargetSidecar(tg)}>{tg.metadata_sidecar ? t('.md off') : t('.md on')}</button>
                  <button className="mini" onClick={() => testTarget(tg.id)}>{t('Test')}</button>
                  <button className="mini" onClick={() => delTarget(tg.id)}>✕</button>
                </div>
              </div>
            ))}
            {targets.length === 0 && <div className="hint">{t('No additional targets yet.')}</div>}
          </div>
          <div className="two">
            <div className="field"><label>{t('Name')}</label><input className="input" placeholder={t('e.g. The Frame FTP')} value={nt.name ?? ''} onChange={(e) => setNt({ ...nt, name: e.target.value })} /></div>
            <div className="field"><label>{t('Protocol')}</label>
              <select className="input" value={nt.protocol} onChange={(e) => setNt({ ...nt, protocol: e.target.value })}>
                <option value="sftp">SFTP</option><option value="ftps">FTPS</option></select></div>
          </div>
          <div className="two">
            <div className="field"><label>{t('Host')}</label><input className="input" value={nt.host ?? ''} onChange={(e) => setNt({ ...nt, host: e.target.value })} /></div>
            <div className="field"><label>{t('Port')}</label><input className="input" type="number" value={nt.port ?? ''} onChange={(e) => setNt({ ...nt, port: e.target.value })} /></div>
          </div>
          <div className="two">
            <div className="field"><label>{t('User')}</label><input className="input" value={nt.username ?? ''} onChange={(e) => setNt({ ...nt, username: e.target.value })} /></div>
            <div className="field"><label>{t('Password')}</label><input className="input" type="password" value={nt.password ?? ''} onChange={(e) => setNt({ ...nt, password: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t('Base folder')}</label><input className="input" placeholder="/" value={nt.base_path ?? ''} onChange={(e) => setNt({ ...nt, base_path: e.target.value })} /></div>
          <label className="toggle"><input type="checkbox" checked={!!nt.is_backup} onChange={(e) => setNt({ ...nt, is_backup: e.target.checked })} />
            <span><b>{t('As a backup target')}</b><em>{t('Receives all results automatically.')}</em></span></label>
          <label className="toggle"><input type="checkbox" checked={!!nt.metadata_sidecar} onChange={(e) => setNt({ ...nt, metadata_sidecar: e.target.checked })} />
            <span><b>{t('Send the sidecar file (.md) along')}</b><em>{t('Companion text file per image.')}</em></span></label>
          <button className="mini" onClick={addTarget}>{t('Add target')}</button>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Automation / MCP access')}</span></div>
        <div className="controls">
          <div className="hint">{t('API token for external/programmatic access (for example Klarbild MCP: “take these images and process them”).')}{' '}
            {t('As {header} to {uploads} and {jobs}.', { header: 'Authorization: Bearer <Token>', uploads: '/api/uploads', jobs: '/api/jobs' })}</div>
          {s.api_token
            ? <div className="field"><label>{t('API token')}</label><input className="input" readOnly value={s.api_token} onFocus={(e) => e.target.select()} /></div>
            : <div className="hint">{t('No token generated yet.')}</div>}
          <button className="mini" onClick={genToken}>{s.api_token ? t('Generate a new token') : t('Generate token')}</button>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Permissions & privacy')}</span></div>
        <div className="controls">
          <div className="field"><label>{t('Who sees which generations?')}</label>
            <div className="choice">
              <button className={s.library_visibility !== 'shared' ? 'on' : ''} onClick={() => field('library_visibility', 'own')}>{t('Own only')}</button>
              <button className={s.library_visibility === 'shared' ? 'on' : ''} onClick={() => field('library_visibility', 'shared')}>{t('Everyone sees everything')}</button>
            </div>
            <div className="hint">{t('Admins always see everything. “Own only”: everyone sees only the images they generated themselves.')}</div>
          </div>
          <label className="toggle"><input type="checkbox" checked={!!s.anonymous_generations} onChange={(e) => field('anonymous_generations', e.target.checked)} />
            <span><b>{t('Anonymous generations')}</b><em>{t('Who generated an image is hidden from non-admins.')}</em></span></label>
          <label className="toggle"><input type="checkbox" checked={!!s.private_allowed} onChange={(e) => field('private_allowed', e.target.checked)} />
            <span><b>{t('Allow private sessions')}</b><em>{t('Users get the “Private session” switch in the studio (generate only, forget afterwards).')}</em></span></label>
          <label className="toggle"><input type="checkbox" checked={!!s.allow_nsfw} onChange={(e) => field('allow_nsfw', e.target.checked)} />
            <span><b>{t('Allow NSFW models')}</b><em>{t('Models marked as NSFW become selectable and visible. The responsibility lies with the operator; content involving minors is prohibited without exception.')}</em></span></label>
        </div>
      </section>

      <button className="btn" onClick={saveSettings}>{t('Save settings')}</button>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Models')}</span></div>
        <div className="list">
          {models.map((m) => (
            <div key={m.id} className="item">
              <div><b>{m.label}</b>{m.is_default && <span className="pill">{t('Default')}</span>}{m.supports_alpha && <span className="pill alpha">{t('transparent')}</span>}{m.nsfw && <span className="pill nsfw">NSFW</span>}<div className="hint">{m.model_id}</div></div>
              <div className="row">
                {!m.is_default && <button className="mini" onClick={() => modelAction(m.id, 'default')}>{t('Default')}</button>}
                <button className="mini" onClick={() => modelAction(m.id, 'nsfw')}>{m.nsfw ? t('NSFW off') : 'NSFW'}</button>
                <button className="mini" onClick={() => modelAction(m.id, 'delete')}>✕</button>
              </div>
            </div>
          ))}
          {models.length === 0 && <div className="hint">{t('No models yet. Add one from the available ones:')}</div>}
          <div className="avail">
            {avail.filter((m) => !stored.has(m.model_id)).slice(0, 12).map((m) => (
              <button key={m.model_id} className="mini" onClick={() => addModel(m)}>+ {m.name}{m.supports_alpha ? ' ◇' : ''}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Users')}</span><button className="mini" onClick={addUser}>{t('New user')}</button></div>
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="item">
              <div><b>{u.display_name || u.username}</b>{u.private_forced && <span className="pill">{t('private')}</span>} <span className="hint">{u.username} · {u.role}</span></div>
              <div className="row">
                <button className="mini" onClick={() => setUserPrivate(u.id, !u.private_forced)}>{u.private_forced ? t('Private off') : t('Force private')}</button>
                <button className="mini" onClick={() => pairCode(u.id)}>{t('Pair Telegram')}</button>
                <button className="mini" onClick={() => setPw(u.id)}>{t('Set password')}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="cardHead"><span className="mono-label">{t('Telegram bot')}</span></div>
        <div className="list">
          <div className="hint">{t('Generate a code with “Pair Telegram” on a user and enter it in the chat with the bot. After that, forward images there → pick a preset recipe → results come back.')}</div>
          {tgLinks.map((l) => (
            <div key={l.chat_id} className="item">
              <div><b>{t('Chat {id}', { id: l.chat_id })}</b> <span className="hint">{l.user_name || ''} · {t('since {date}', { date: new Date(l.linked_at).toLocaleDateString() })}</span></div>
              <button className="mini" onClick={() => unlink(l.chat_id)}>{t('Unlink')}</button>
            </div>
          ))}
          {tgLinks.length === 0 && <div className="hint">{t('No paired chats yet.')}</div>}
        </div>
      </section>

      <section className="card danger">
        <div className="cardHead"><span className="mono-label">{t('Reset')}</span></div>
        <div className="controls">
          <div className="hint">{t('Deletes all images, jobs and folders irreversibly, so you can start over cleanly. Users, settings, models and preset recipes are kept. Tip: run “Back up all existing images to the mirror” first.')}</div>
          <button className="btn warn" onClick={resetAll}>{t('Reset library & jobs')}</button>
        </div>
      </section>

      {toast && <div className="toast">{toast}</div>}
      <AdminStyles />
    </div>
  );
}

function AdminStyles() {
  return <style>{`
    .admin{display:flex;flex-direction:column;gap:16px;max-width:640px;}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
    .cardHead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);}
    .controls{padding:16px;display:flex;flex-direction:column;gap:14px;}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .field label{display:block;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);margin-bottom:6px;}
    .field em{text-transform:none;letter-spacing:0;color:var(--accent);font-style:normal;}
    /* 16 px, not 14: below that iOS zooms into the field on focus — the
   emergency brake in tokens.css only reaches 767 px, but the admin is also
   used on the iPad. */
    .input{width:100%;background:var(--card);border:1px solid var(--line);border-radius:3px;padding:10px 11px;font-family:inherit;font-size:16px;color:var(--ink);}
    .hint{font-size:11.5px;color:var(--soft);line-height:1.5;}
    .btn{border:none;border-radius:3px;padding:12px;cursor:pointer;background:var(--accent);color:#fff;font-family:inherit;font-weight:600;font-size:15px;}
    .btn.warn{background:var(--err);}
    .card.danger{border-color:color-mix(in oklab,var(--err) 40%,var(--line));}
    .card.danger .mono-label{color:var(--err);}
    .controls code{font-family:var(--font-mono);font-size:11px;background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:1px 5px;}
    .numbers{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:16px;}
    .numbers div{background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:11px;}
    .numbers b{display:block;font-size:22px;line-height:1;}.numbers span{font-size:11.5px;color:var(--soft);}
    .card>.hint{padding:0 16px 14px;}
    .notice{padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius-sm);
      background:var(--paper);font-size:12.5px;line-height:1.55;}
    .notice.warn{border-color:var(--warn);background:oklch(72% .15 75 / .08);}
    .notice code{font-family:var(--font-mono);font-size:11.5px;}
    /* On a phone everything was two columns — a field like "Outgoing mail
       server" ended up around 156 px wide. And tap targets under 44 px are
       not hit reliably. */
    @media(max-width:560px){
      .two{grid-template-columns:1fr;}
      .mini{padding:11px 13px;font-size:13px;}
      .row{flex-wrap:wrap;}
    }
    /* Before/after of the rename — long names must not blow the card apart. */
    .namelist{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:4px;max-height:220px;overflow:auto;}
    .namelist li{font-family:var(--font-mono);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere;}
    .namelist s{color:var(--soft);}
    .namelist code{color:var(--ink);}
    .list{padding:8px 16px 16px;display:flex;flex-direction:column;}
    .item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);}
    .item b{font-size:14px;}
    .pill{font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;background:var(--accent-bg);color:var(--accent);padding:2px 7px;border-radius:20px;margin-left:6px;}
    .pill.alpha{background:var(--paper);color:var(--soft);}
    .pill.nsfw{background:var(--err);color:#fff;}
    .toggle{display:flex;gap:10px;align-items:flex-start;cursor:pointer;}
    .toggle input{margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex:0 0 auto;}
    .toggle b{display:block;font-size:14px;}
    .toggle em{display:block;font-style:normal;font-size:11.5px;color:var(--soft);margin-top:1px;line-height:1.4;}
    .toggle code{font-family:var(--font-mono);font-size:11px;}
    .avail{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
    .row{display:flex;gap:6px;}
    .mini{background:var(--card);border:1px solid var(--line);border-radius:3px;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:12px;color:var(--ink);}
    .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);color:#FBFBF7;padding:10px 18px;border-radius:3px;font-size:13.5px;z-index:60;}
    .dtlist{background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:10px;margin-top:8px;max-height:260px;overflow:auto;}
    .dtrow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;}
    .link2{background:none;border:none;cursor:pointer;color:var(--accent);font-family:var(--font-mono);font-size:12px;text-align:left;padding:0;}
  `}</style>;
}
