import React, { useState, useEffect, useCallback } from 'react';
import { filenameFromHeader } from '../lib/naming';
import ShareDialog, { type ShareTarget } from './ShareDialog';
import { useT, type Dict, type Locale } from '../lib/useT';

interface Item { id: string; filename: string; output_px: string; has_alpha: boolean;
  folder_id: string | null; by_name: string; tasks: string[]; delivery_status: string; mirror_status: string;
  model_used: string; variant_of: string | null; mode: string; thumb_path: string | null; prompt_used: string | null;
  color_tag: string | null; created_at: string; }

const TAGS = [
  { id: 'red', label: 'Red', color: '#E5484D' },
  { id: 'orange', label: 'Orange', color: '#E8830C' },
  { id: 'green', label: 'Green', color: '#46A758' },
  { id: 'final', label: 'Final', color: '#3A3733' },
];
const tagColor = (id: string | null) => TAGS.find((x) => x.id === id)?.color || null;

export default function LibraryApp({ locale, dict }: { locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [variantSel, setVariantSel] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState<Item | null>(null);
  const [promptOf, setPromptOf] = useState<Item | null>(null);
  const [saveView, setSaveView] = useState<Item | null>(null);
  const [tagMenu, setTagMenu] = useState<string | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  // Model name: the admin label, otherwise the readable tail of the model ID.
  const modelName = (id: string | null) => {
    if (!id) return null;
    const m = models.find((x) => x.model_id === id);
    if (m) return m.label;
    return id.split('/').pop()!.replace(/-/g, ' ');
  };

  const load = useCallback(async () => {
    const [i, f, m] = await Promise.all([
      fetch('/api/items').then((r) => r.json()).catch(() => ({ items: [] })),
      fetch('/api/folders').then((r) => r.json()).catch(() => ({ folders: [] })),
      fetch('/api/models').then((r) => r.json()).catch(() => ({ models: [] })),
    ]);
    setItems(i.items || []); setFolders(f.folders || []); setModels(m.models || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const rename = async (id: string, filename: string) =>
    fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
  const setTag = async (id: string, color_tag: string | null) => {
    setItems((x) => x.map((y) => y.id === id ? { ...y, color_tag } : y));
    setTagMenu(null);
    await fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color_tag }) });
  };
  const setFolder = async (id: string, folder_id: string | null) => {
    await fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id }) });
    load();
  };
  const del = async (id: string) => { await fetch(`/api/items/${id}`, { method: 'DELETE' }); setItems((x) => x.filter((y) => y.id !== id)); };
  const delSelected = async () => { for (const id of pick) await fetch(`/api/items/${id}`, { method: 'DELETE' }); setPick(new Set()); load(); notify(t('Deleted.')); };
  const deliverSelected = async () => {
    notify(t('Sending to the delivery target …'));
    const r = await fetch('/api/deliver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: [...pick] }) }).then((x) => x.json());
    setPick(new Set()); load(); notify(t('{done}/{total} delivered to the target.', { done: r.delivered, total: r.total }));
  };
  const toggle = (id: string) => setPick((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const moveSelected = async (folder_id: string | null) => {
    for (const id of pick) await fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id }) });
    setPick(new Set()); load(); notify(folder_id ? t('Moved into the folder.') : t('Removed from the folder.'));
  };
  const zipSelected = async () => {
    notify(t('Packing ZIP …'));
    const res = await fetch('/api/items/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: [...pick] }) });
    if (!res.ok) { notify(t('ZIP failed.')); return; }
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    // The name comes from the server — building our own here would mean two
    // selections made on the same day end up with the same name again.
    a.download = filenameFromHeader(res.headers.get('Content-Disposition'), 'klarbild-selection.zip'); a.click();
    URL.revokeObjectURL(a.href); notify(t('ZIP downloaded.'));
  };
  const alternative = async (id: string) => {
    notify(t('Generating an alternative …'));
    const r = await fetch(`/api/items/${id}/alternative`, { method: 'POST' }).then((x) => x.json());
    if (r.ok) notify(t('The alternative is being generated — it will show up here shortly.')); else notify(r.error || t('Error.'));
    setTimeout(load, 2500);
  };
  // Carry the result into the studio as a new source and keep working on it.
  const reuse = (id: string) => { window.location.href = `/?reuse=${id}`; };

  const newFolder = async () => {
    const name = prompt(t('Folder name?')); if (!name) return;
    const targetFolder = prompt(t('Folder on the delivery target for this folder? (empty = default)')) || '';
    await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, delivery_folder: targetFolder.trim() || null }) });
    load();
  };
  const delFolder = async (id: string) => {
    if (!confirm(t('Delete folder? The images are kept.'))) return;
    await fetch(`/api/folders?id=${id}`, { method: 'DELETE' });
    if (folderFilter === id) setFolderFilter(null);
    load();
  };
  const renameFolder = async (o: any) => {
    const name = prompt(t('Rename folder:'), o.name); if (name == null) return;
    const targetFolder = prompt(t('Folder on the delivery target (empty = default):'), o.delivery_folder || '');
    await fetch('/api/folders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.id, name: name.trim() || o.name, delivery_folder: (targetFolder || '').trim() || null }) });
    load();
  };

  // Filter by folder and flag, then group alternatives under their origin.
  const filtered = items
    .filter((v) => !folderFilter || v.folder_id === folderFilter)
    .filter((v) => !tagFilter || v.color_tag === tagFilter);
  const groupMap = new Map<string, Item[]>();
  for (const it of filtered) {
    const root = it.variant_of || it.id;
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(it);
  }
  const groups = [...groupMap.values()].map((g) => g.slice().sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)));
  groups.sort((a, b) => +new Date(b[b.length - 1].created_at) - +new Date(a[a.length - 1].created_at));
  const shown = (g: Item[]) => g.find((x) => x.id === variantSel[g[0].id]) || g[g.length - 1];

  return (
    <div>
      <div className="head-row">
        <span className="mono-label">{t('Library')}{filtered.length ? ` · ${filtered.length}` : ''}</span>
        <div className="row">
          {pick.size > 0 && <>
            <span className="hint">{t('{n} selected', { n: pick.size })}</span>
            <button className="mini strong" onClick={deliverSelected}>{t('Deliver')}</button>
            <button className="mini" onClick={() => setShare({ itemIds: [...pick] })}>{t('Share')}</button>
            <button className="mini" onClick={zipSelected}>{t('Download ZIP')}</button>
            <select className="mini-select" value="" onChange={(e) => { if (e.target.value) moveSelected(e.target.value === '__none' ? null : e.target.value); }}>
              <option value="" disabled>{t('Into folder …')}</option>
              {folders.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="__none">{t('No folder')}</option>
            </select>
            <button className="mini" onClick={delSelected}>{t('Delete')}</button>
          </>}
          <button className="mini" onClick={newFolder}>{t('New folder')}</button>
        </div>
      </div>

      {/* Folder filter */}
      <div className="folderbar">
        <button className={`chip ${!folderFilter ? 'active' : ''}`} onClick={() => setFolderFilter(null)}>{t('All')} · {items.length}</button>
        {folders.map((o) => (
          <span key={o.id} className={`chip-wrap ${folderFilter === o.id ? 'active' : ''}`}>
            <button className="chip" onClick={() => setFolderFilter(folderFilter === o.id ? null : o.id)}>
              {o.name} · {o.count}{o.delivery_folder ? ' →' : ''}
            </button>
            {folderFilter === o.id && <>
              <button className="chip-x" title={t('Rename folder')} onClick={() => renameFolder(o)}>✎</button>
              <button className="chip-x del" title={t('Delete folder')} onClick={() => delFolder(o.id)}>✕</button>
            </>}
          </span>
        ))}
      </div>
      <div className="hint notice">{t('Folders group the library, and each folder can get its own folder on the delivery target (arrow = its own target folder is set).')}</div>

      {/* Filter by color flag */}
      <div className="folderbar tagbar">
        <button className={`chip ${!tagFilter ? 'active' : ''}`} onClick={() => setTagFilter(null)}>{t('All flags')}</button>
        {TAGS.map((tag) => (
          <button key={tag.id} className={`chip flagchip ${tagFilter === tag.id ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}>
            <span className="flag" style={{ color: tag.color }}>⚑</span> {t(tag.label)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty"><span className="regmark" /><h3>{folderFilter ? t('Folder is empty') : t('Nothing created yet')}</h3>
          <p>{folderFilter ? t('Assign images to this folder from the folder menu.') : t('Start in the studio — the results collect here.')}</p></div>
      ) : (
        <div className="gallery">
          {groups.map((g) => {
            const v = shown(g);
            const multi = g.length > 1;
            return (
              <article key={g[0].id} className={`tile ${pick.has(v.id) ? 'selected' : ''}`}>
                <div className="tile-image" onClick={() => toggle(v.id)}>
                  <img src={`/api/items/${v.id}/file?thumb=1`} alt="" loading="lazy" />
                  <span className="check">{pick.has(v.id) ? '✓' : ''}</span>
                  {(v.mode === 'compose' || v.mode === 'generate') &&
                    <span className="modetag">{v.mode === 'compose' ? t('combined') : t('generated')}</span>}
                  {v.color_tag && <span className="flagbadge" style={{ color: tagColor(v.color_tag)! }}>⚑</span>}
                  {multi && <span className="version">{t('Version {n}/{total}', { n: g.indexOf(v) + 1, total: g.length })}</span>}
                </div>

                {multi && (
                  <div className="variants">
                    {g.map((x, idx) => (
                      <button key={x.id} className={`vthumb ${x.id === v.id ? 'active' : ''}`}
                        onClick={() => setVariantSel((s) => ({ ...s, [g[0].id]: x.id }))} title={t('Version {n}', { n: idx + 1 })}>
                        <img src={`/api/items/${x.id}/file?thumb=1`} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

                <input className="name" defaultValue={v.filename || ''} key={v.id} onBlur={(e) => rename(v.id, e.target.value)} />
                <div className="meta">{(v.tasks || []).join(' · ')}{v.output_px ? ` · ${v.output_px}px` : ''}{v.has_alpha ? ' · transparent' : ''}{modelName(v.model_used) ? ` · ${modelName(v.model_used)}` : ''}
                  {v.delivery_status === 'delivered' && <span className="dbadge ok">{t('Delivered')} ✓</span>}
                  {v.delivery_status === 'pending' && <span className="dbadge">{t('Delivering')} …</span>}
                  {v.delivery_status === 'failed' && <span className="dbadge err">{t('Delivery')} ✕</span>}
                  {v.mirror_status === 'mirrored' && <span className="dbadge ok">{t('Mirror')} ✓</span>}
                  {v.mirror_status === 'failed' && <span className="dbadge err">{t('Mirror')} ✕</span>}
                </div>
                <div className="row tight">
                  <div className="tagwrap">
                    <button className="mini flagbtn" style={v.color_tag ? { color: tagColor(v.color_tag)!, borderColor: tagColor(v.color_tag)! } : {}}
                      onClick={() => setTagMenu(tagMenu === v.id ? null : v.id)} title={t('Flag')}>⚑</button>
                    {tagMenu === v.id && (
                      <div className="tagmenu" onMouseLeave={() => setTagMenu(null)}>
                        <button onClick={() => setTag(v.id, null)}><span className="flag none">⚑</span> {t('None')}</button>
                        {TAGS.map((tag) => (
                          <button key={tag.id} onClick={() => setTag(v.id, tag.id)}><span className="flag" style={{ color: tag.color }}>⚑</span> {t(tag.label)}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  {v.prompt_used && <button className="mini" onClick={() => setPromptOf(v)}>{t('Prompt')}</button>}
                  {v.mode !== 'generate' && <button className="mini" onClick={() => setCompare(v)}>{t('Before/After')}</button>}
                  <button className="mini strong2" onClick={() => setSaveView(v)} title={t('Open large, then save (iPhone: Save to Photos)')}>{t('Download')}</button>
                  <button className="mini" onClick={() => reuse(v.id)} title={t('Keep working on the result in the studio')}>{t('Continue')}</button>
                  <button className="mini" onClick={() => alternative(v.id)} title={t('Generate another version')}>{t('+ Alt.')}</button>
                  <button className="mini" onClick={() => setShare({ itemIds: [v.id] })}
                    title={t('Create a link — opens without a Klarbild account')}>{t('Share')}</button>
                  <select className="mini-select" value={v.folder_id || ''} onChange={(e) => setFolder(v.id, e.target.value || null)}>
                    <option value="">{t('No folder')}</option>
                    {folders.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <button className="mini" onClick={() => del(v.id)}>✕</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {share && (
        <ShareDialog target={share} onClose={() => setShare(null)} locale={locale} dict={dict} />
      )}

      {compare && (
        <div className="lightbox" onClick={() => setCompare(null)}>
          <div className="compare" onClick={(e) => e.stopPropagation()}>
            <img className="under" src={`/api/items/${compare.id}/file?src=1`} alt={t('before')} />
            <img className="over" src={`/api/items/${compare.id}/file`} alt={t('after')} id="ov" />
            <input type="range" min={0} max={100} defaultValue={50}
              onChange={(e) => { const o = document.getElementById('ov'); if (o) o.style.clipPath = `inset(0 0 0 ${e.target.value}%)`; }} />
          </div>
          <div className="lightbox-foot">{compare.filename} · {compare.output_px}px — {compare.mode === 'compose'
            ? t('Slider: source on the left, result on the right')
            : t('Slider: original on the left, result on the right')}</div>
        </div>
      )}
      {saveView && (
        <div className="lightbox" onClick={() => setSaveView(null)}>
          <div className="savewrap" onClick={(e) => e.stopPropagation()}>
            <img className="saveimg blur" src={`/api/items/${saveView.id}/file?thumb=1`} alt="" />
            <img className="saveimg full" src={`/api/items/${saveView.id}/file?preview=1`} alt={saveView.filename || ''} />
          </div>
          <div className="save-foot" onClick={(e) => e.stopPropagation()}>
            <span>{t('📱 iPhone/iPad: press and hold the image → “Save to Photos”.')}</span>
            <a className="mini strong" href={`/api/items/${saveView.id}/file?download=1`}>{t('Original as a file (.png)')}</a>
            <button className="mini" onClick={() => setSaveView(null)}>{t('Close')}</button>
          </div>
        </div>
      )}
      {promptOf && (
        <div className="lightbox" onClick={() => setPromptOf(null)}>
          <div className="promptbox" onClick={(e) => e.stopPropagation()}>
            <div className="pb-head"><b>{promptOf.filename}</b>
              <button className="mini" onClick={() => { navigator.clipboard?.writeText(promptOf.prompt_used || ''); notify(t('Prompt copied.')); }}>{t('Copy')}</button></div>
            <pre className="pb-text">{promptOf.prompt_used}</pre>
            <div className="hint">{promptOf.model_used ? `${t('Model: {name}', { name: modelName(promptOf.model_used) || '' })} · ` : ''}{promptOf.output_px}px</div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      <LibStyles />
    </div>
  );
}

function LibStyles() {
  return <style>{`
    .head-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}.row.tight{margin-top:8px;}
    .hint{font-size:11.5px;color:var(--soft);}
    .notice{margin:0 0 14px;line-height:1.5;}
    .mini{background:var(--card);border:1px solid var(--line);border-radius:3px;padding:6px 11px;cursor:pointer;font-family:inherit;font-size:12.5px;color:var(--ink);text-decoration:none;}
    .folderbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:8px;}
    .chip-wrap{display:inline-flex;align-items:center;border-radius:20px;}
    .chip{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:6px 13px;cursor:pointer;font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;color:var(--soft);white-space:nowrap;}
    .chip.active,.chip-wrap.active .chip{border-color:var(--accent);background:var(--accent-bg);color:var(--accent);}
    .chip-x{border:none;background:none;color:var(--accent);cursor:pointer;font-size:12px;padding:0 4px;}
    .chip-x.del{color:var(--err);padding:0 8px 0 2px;}
    .empty{padding:60px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;}
    .empty h3{margin:0;font-size:17px;}.empty p{margin:0;color:var(--soft);max-width:38ch;}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;align-items:start;}
    @media(min-width:768px){.gallery{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}}
    .tile{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:8px;}
    .tile.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);}
    .tile-image{position:relative;border-radius:3px;overflow:hidden;cursor:pointer;
      background:repeating-conic-gradient(oklch(90% 0.006 95) 0% 25%, oklch(96% 0.004 95) 0% 50%) 50%/16px 16px;}
    .tile-image img{width:100%;height:auto;display:block;transition:transform .12s;}
    .tile-image:active img{transform:scale(.98);}
    .check{position:absolute;top:6px;left:6px;width:21px;height:21px;border-radius:50%;border:1.5px solid #fff;background:rgba(22,21,15,.35);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;}
    .tile.selected .check{background:var(--accent);}
    .modetag{position:absolute;top:6px;right:6px;background:rgba(59,91,219,.92);color:#fff;font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:20px;}
    /* Bottom left — the selection circle (.check) sits top left, the mode tag top
       right, the version number bottom right. The flag used to sit exactly on the
       selection circle and covered it. */
    .flagbadge{position:absolute;bottom:5px;left:6px;font-size:19px;line-height:1;
      text-shadow:0 1px 3px rgba(0,0,0,.55);pointer-events:none;}
    .tagbar{margin:0 0 12px;}
    .flagchip .flag{font-size:13px;vertical-align:-1px;}
    .flag.none{color:var(--soft);}
    .tagwrap{position:relative;display:inline-block;}
    .flagbtn{font-size:14px;line-height:1;padding:5px 9px;}
    .tagmenu{position:absolute;bottom:calc(100% + 4px);left:0;z-index:20;background:var(--card);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:5px;display:flex;flex-direction:column;min-width:130px;}
    .tagmenu button{display:flex;align-items:center;gap:8px;background:none;border:none;text-align:left;padding:7px 9px;cursor:pointer;font-family:inherit;font-size:13px;border-radius:4px;color:var(--ink);}
    .tagmenu button:hover{background:var(--paper);}
    .tagmenu .flag{font-size:15px;}
    .savewrap{position:relative;max-width:94vw;max-height:78vh;display:flex;}
    .saveimg{max-width:94vw;max-height:78vh;border-radius:4px;display:block;}
    .saveimg.blur{filter:blur(8px);position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
    .saveimg.full{position:relative;z-index:1;}
    .save-foot{display:flex;flex-direction:column;align-items:center;gap:10px;color:#EAEAE3;font-size:13.5px;text-align:center;max-width:90vw;}
    .version{position:absolute;bottom:6px;right:6px;background:rgba(22,21,15,.7);color:#fff;font-family:var(--font-mono);font-size:9px;padding:2px 7px;border-radius:20px;}
    .variants{display:flex;gap:5px;margin-top:6px;overflow-x:auto;}
    .vthumb{flex:0 0 auto;width:40px;height:40px;border:1px solid var(--line);border-radius:3px;overflow:hidden;padding:0;background:none;cursor:pointer;}
    .vthumb.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);}
    .vthumb img{width:100%;height:100%;object-fit:cover;display:block;}
    .name{margin-top:8px;width:100%;font-size:12.5px;padding:6px 8px;font-family:var(--font-mono);border:1px solid var(--line);border-radius:3px;background:#fff;}
    .meta{font-size:11px;color:var(--soft);margin-top:5px;}
    .mini.strong{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600;}
    .mini.strong2{border-color:var(--accent);color:var(--accent);font-weight:600;}
    .dbadge{display:inline-block;margin-left:6px;font-family:var(--font-mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;background:var(--paper);color:var(--soft);padding:1px 6px;border-radius:20px;}
    .dbadge.ok{background:var(--accent-bg);color:var(--accent);}
    .dbadge.err{color:var(--err);}
    .mini-select{border:1px solid var(--line);border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;background:#fff;}
    .lightbox{position:fixed;inset:0;background:rgba(22,21,15,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;z-index:50;}
    .compare{position:relative;max-width:90vw;max-height:76vh;}
    .compare img{max-width:90vw;max-height:70vh;display:block;border-radius:3px;}
    .compare .over{position:absolute;inset:0;clip-path:inset(0 0 0 50%);}
    .compare input[type=range]{position:absolute;left:0;right:0;bottom:-34px;width:100%;}
    .lightbox-foot{color:#EAEAE3;font-family:var(--font-mono);font-size:12px;margin-top:30px;text-align:center;}
    .promptbox{background:var(--card);border-radius:var(--radius);max-width:min(92vw,620px);width:100%;padding:16px;display:flex;flex-direction:column;gap:10px;}
    .pb-head{display:flex;justify-content:space-between;align-items:center;gap:10px;}
    .pb-text{white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:12.5px;line-height:1.5;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:12px;max-height:50vh;overflow:auto;margin:0;}
    .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);color:#FBFBF7;padding:10px 18px;border-radius:3px;font-size:13.5px;z-index:60;}
  `}</style>;
}
