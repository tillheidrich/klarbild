import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

/* Formats (01 §5) — cm in portrait convention; screen = fixed pixels */
const FORMATS: { id: string; label: string; cm?: [number, number]; screen?: [number, number] }[] = [
  { id: 'keep', label: 'Keep original' },
  { id: '9x13', label: '9 × 13 cm', cm: [9, 13] },
  { id: '10x15', label: '10 × 15 cm', cm: [10, 15] },
  { id: '13x18', label: '13 × 18 cm', cm: [13, 18] },
  { id: '15x20', label: '15 × 20 cm', cm: [15, 20] },
  { id: '20x30', label: '20 × 30 cm', cm: [20, 30] },
  { id: '30x40', label: '30 × 40 cm', cm: [30, 40] },
  { id: '30x45', label: '30 × 45 cm', cm: [30, 45] },
  { id: '40x50', label: '40 × 50 cm', cm: [40, 50] },
  { id: '40x60', label: '40 × 60 cm', cm: [40, 60] },
  { id: '50x70', label: '50 × 70 cm', cm: [50, 70] },
  { id: '60x90', label: '60 × 90 cm', cm: [60, 90] },
  { id: 'A4', label: 'DIN A4', cm: [21, 29.7] },
  { id: 'A3', label: 'DIN A3', cm: [29.7, 42] },
  { id: 'A2', label: 'DIN A2', cm: [42, 59.4] },
  { id: '20x20', label: '20 × 20 cm', cm: [20, 20] },
  { id: '30x30', label: '30 × 30 cm', cm: [30, 30] },
  { id: 'theframe', label: 'The Frame (16:9)', screen: [3840, 2160] },
  { id: 'portrait916', label: 'Portrait (9:16)', screen: [2160, 3840] },
  { id: 'sticker', label: 'Sticker (custom size)', cm: [5, 5] },
  { id: 'custom', label: 'Custom size (cm)' },
];

/** Free-text size → format key + cm. "25x35" → 25×35 cm; "5" → 5×5 cm sticker. */
function parseCustomFmt(s: string): { key: string; cm: [number, number] | null } {
  const v = (s || '').trim().replace(',', '.');
  const wh = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i.exec(v);
  if (wh) return { key: `${wh[1]}x${wh[2]}`, cm: [parseFloat(wh[1]), parseFloat(wh[2])] };
  const n = /^(\d+(?:\.\d+)?)$/.exec(v);
  if (n) return { key: `sticker${n[1]}`, cm: [parseFloat(n[1]), parseFloat(n[1])] };
  return { key: '', cm: null };
}

const TASKS = [
  { id: 'clean', name: 'Clean up', hint: 'Remove frame, wall and shop interface.' },
  { id: 'cutout', name: 'Cut out', hint: 'Subject only, background transparent.' },
  { id: 'format', name: 'Format', hint: 'Bring it to a given size.' },
  { id: 'contour', name: 'Contour', hint: 'Add a white sticker border (only together with Cut out).' },
];

type Mode = 'each' | 'compose' | 'generate';
const MODES: { id: Mode; name: string; hint: string }[] = [
  { id: 'each', name: 'Clean up', hint: 'Clean up screenshots, cut them out, bring them to size.' },
  { id: 'compose', name: 'Convert', hint: 'Convert one image (e.g. photo → oil painting) or combine several — with text.' },
  { id: 'generate', name: 'Generate', hint: 'A completely new image from text alone.' },
];

const px = (cm: number, dpi = 300) => Math.round((cm / 2.54) * dpi);

interface Pic { id: string; src: string; name: string; source_path?: string; error?: string; uploading?: boolean }

export default function StudioApp({ recipes, locale, dict }: { recipes: any[]; locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [presets, setPresets] = useState<any[]>(recipes || []);
  const [mode, setMode] = useState<Mode>('each');
  const [pics, setPics] = useState<Pic[]>([]);
  const [tasks, setTasks] = useState<string[]>(['clean', 'format']);
  const [format, setFormat] = useState('30x40');
  const [portrait, setPortrait] = useState(true);
  const [crop, setCrop] = useState<'crop' | 'extend'>('crop');
  const [contourMm, setContourMm] = useState(3);
  const [customFmt, setCustomFmt] = useState('');       // free-text size for "Custom size"/"Sticker"
  const [outputExt, setOutputExt] = useState<'' | 'png' | 'jpg'>(''); // '' = the global default setting
  const [custom, setCustom] = useState('');
  const [desc, setDesc] = useState('');
  const [delivery, setDelivery] = useState<'library' | 'remote' | 'both'>('library');
  const [gallery, setGallery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targets, setTargets] = useState<any[]>([]);
  const [presetSel, setPresetSel] = useState('');
  const [me, setMe] = useState<any>({});
  const [priv, setPriv] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [modelKey, setModelKey] = useState<string>('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fmt = FORMATS.find((f) => f.id === format);
  const hasCutout = tasks.includes('cutout');
  const hasFormat = tasks.includes('format');
  const theframeConflict = hasCutout && (format === 'theframe' || format === 'portrait916');
  // In compose/generate the size is always available (without the "Format" task).
  const showFormat = mode === 'each' ? hasFormat : true;
  const wantsFormat = mode === 'each' ? hasFormat : format !== 'keep';

  const isFreeFmt = format === 'custom' || format === 'sticker';
  const parsedFmt = isFreeFmt ? parseCustomFmt(customFmt) : { key: '', cm: null };
  // "Sticker" without an entry still means 5×5 cm; "Custom size" needs an entry.
  const effCm: [number, number] | null = fmt?.screen ? null
    : parsedFmt.cm || (format === 'sticker' ? [5, 5] : (fmt?.cm || null));
  // What is actually stored as output_format (e.g. "25x35", "sticker5").
  const effFormat = isFreeFmt ? (parsedFmt.key || (format === 'sticker' ? 'sticker' : '')) : format;

  const targetPx: [number, number] | null = fmt?.screen
    ? (fmt.screen as [number, number])
    : effCm
      ? (portrait ? [px(effCm[0]), px(effCm[1])] : [px(effCm[1]), px(effCm[0])])
      : null;

  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const upload = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, 100);
    for (const f of arr) {
      const id = crypto.randomUUID();
      const reader = new FileReader();
      reader.onload = () => setPics((p) => p.map((x) => x.id === id ? { ...x, src: reader.result as string } : x));
      reader.readAsDataURL(f);
      setPics((p) => [...p, { id, src: '', name: f.name, uploading: true }]);
      const fd = new FormData(); fd.append('files', f);
      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: fd });
        const j = await res.json();
        const info = j.files?.[0];
        setPics((p) => p.map((x) => x.id === id
          ? { ...x, uploading: false, source_path: info?.source_path, error: info?.error } : x));
      } catch {
        setPics((p) => p.map((x) => x.id === id ? { ...x, uploading: false, error: t('Upload failed') } : x));
      }
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (mode === 'generate') return;
      const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/'));
      if (imgs.length) upload(imgs.map((i) => i.getAsFile()!).filter(Boolean));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload, mode]);

  useEffect(() => {
    fetch('/api/models').then((r) => r.json()).then((j) => {
      const ms = j.models || []; setModels(ms);
      const def = ms.find((m: any) => m.is_default) || ms[0];
      if (def) setModelKey(def.model_id);
    }).catch(() => {});
    fetch('/api/delivery-targets').then((r) => r.json()).then((j) => setTargets(j.targets || [])).catch(() => {});
    fetch('/api/me').then((r) => r.json()).then((j) => { setMe(j); if (j.private_forced) setPriv(true); }).catch(() => {});
    loadPresets();
  }, []);
  const loadPresets = () => fetch('/api/recipes').then((r) => r.json()).then((j) => setPresets(j.recipes || [])).catch(() => {});
  const saveAsPreset = async () => {
    const name = prompt(t('Name of the preset?')); if (!name?.trim()) return;
    const order = ['clean', 'cutout', 'format', 'contour', 'deliver'];
    const tasksOut = mode === 'each' ? [...tasks].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : (wantsFormat ? ['format'] : []);
    const body = {
      name: name.trim(), mode, tasks: tasksOut, output_format: wantsFormat ? effFormat : 'keep',
      orientation: portrait ? 'portrait' : 'landscape', crop_mode: crop, dpi: 300,
      contour_mm: tasks.includes('contour') ? contourMm : null,
      output_ext: outputExt || null,
      custom_instruction: mode === 'each' ? (custom || null) : null, model_key: modelKey || null,
      delivery, delivery_folder: gallery.trim() || null, delivery_target_id: targetId || null,
    };
    await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    notify(t('Preset saved.')); loadPresets();
  };
  const deletePreset = async (id: string) => {
    if (!id || !confirm(t('Delete preset?'))) return;
    await fetch(`/api/recipes/${id}`, { method: 'DELETE' }); notify(t('Preset deleted.')); loadPresets();
  };

  // Take a result over from the library: ?reuse=<itemId> loads it as a source.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reuseId = params.get('reuse');
    if (!reuseId) return;
    (async () => {
      const id = crypto.randomUUID();
      setPics((p) => [...p, { id, src: `/api/items/${reuseId}/file?thumb=1`, name: 'continue-editing.png', uploading: true }]);
      try {
        const j = await fetch(`/api/items/${reuseId}/reuse`, { method: 'POST' }).then((r) => r.json());
        setPics((p) => p.map((x) => x.id === id
          ? { ...x, uploading: false, source_path: j.source_path, name: j.filename || x.name, error: j.error } : x));
      } catch {
        setPics((p) => p.map((x) => x.id === id ? { ...x, uploading: false, error: t('Could not load image') } : x));
      }
      history.replaceState(null, '', '/');
    })();
  }, []);

  function toggleTask(id: string) {
    setTasks((prev) => {
      let next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (id === 'cutout' && !next.includes('cutout')) next = next.filter((x) => x !== 'contour');
      return next;
    });
  }

  function applyRecipe(r: any) {
    if (!r) return;
    if (['each', 'compose', 'generate'].includes(r.mode)) setMode(r.mode);
    setTasks(r.tasks || ['clean', 'format']);
    const of = r.output_format || 'keep';
    // Get the custom size back out of the recipe (no known key = custom size).
    if (of !== 'keep' && !FORMATS.some((f) => f.id === of)) {
      setFormat('custom');
      setCustomFmt(/^sticker[-_ ]?/i.test(of) ? of.replace(/^sticker[-_ ]?/i, '') : of);
    } else setFormat(of);
    setOutputExt(r.output_ext === 'jpg' || r.output_ext === 'png' ? r.output_ext : '');
    setPortrait((r.orientation || 'portrait') !== 'landscape');
    setCrop(r.crop_mode === 'extend' ? 'extend' : 'crop');
    setContourMm(Number(r.contour_mm) || 3);
    setCustom(r.custom_instruction || '');
    setDelivery(r.delivery || 'library');
    setGallery(r.delivery_folder || '');
    setTargetId(r.delivery_target_id || '');
    if (r.model_key) setModelKey(r.model_key);
  }

  const ready = pics.filter((p) => p.source_path && !p.error);
  // "Custom size" needs a valid entry, otherwise the run cannot start.
  const freeFmtInvalid = wantsFormat && format === 'custom' && !parsedFmt.cm;
  const canRun = !busy && !freeFmtInvalid && (
    mode === 'each' ? (ready.length > 0 && tasks.length > 0 && !theframeConflict && !(tasks.includes('contour') && !hasCutout))
    : mode === 'compose' ? (ready.length >= 1 && desc.trim().length > 0)
    : desc.trim().length > 0
  );

  async function run() {
    if (!canRun) return;
    setBusy(true);
    const order = ['clean', 'cutout', 'format', 'contour', 'deliver'];
    const tasksOut = mode === 'each'
      ? [...tasks].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      : (wantsFormat ? ['format'] : []);
    const recipe = {
      tasks: tasksOut,
      output_format: wantsFormat ? effFormat : 'keep',
      orientation: portrait ? 'portrait' : 'landscape',
      crop_mode: crop, dpi: 300,
      contour_mm: tasks.includes('contour') ? contourMm : null,
      output_ext: outputExt || null,
      custom_instruction: mode === 'each' ? (custom || null) : null,
      delivery, model_key: modelKey || null,
      delivery_folder: (delivery !== 'library' && gallery.trim()) ? gallery.trim() : null,
      delivery_target_id: (delivery !== 'library' && targetId) ? targetId : null,
    };
    const body: any = { recipe, mode, delivery, private: priv };
    if (mode !== 'each') body.prompt_text = desc.trim();
    body.sources = mode === 'generate' ? [] : ready.map((p) => ({ source_path: p.source_path, filename: p.name }));
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.jobId) location.href = `/queue?job=${j.jobId}`;
      else { notify(j.error || t('Could not create the job.')); setBusy(false); }
    } catch { notify(t('Network error.')); setBusy(false); }
  }

  const uploadHint = mode === 'compose'
    ? t('Convert one image or combine several (e.g. subject + a photo of the dog).')
    : t('Several at once, up to 100. PNG, JPG, WEBP, HEIC.');

  // The key combination keeps its own styling, so the sentence carries a {keys}
  // placeholder and is split on it instead of being glued together from fragments.
  const dropText = t('Drag images here, paste with {keys} or tap to choose.').split('{keys}');

  return (
    <div className="studio">
      {/* Mode switch */}
      <div className="mode-bar">
        {MODES.map((m) => (
          <button key={m.id} className={`mode-tab ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
            <b>{t(m.name)}</b><span>{t(m.hint)}</span>
          </button>
        ))}
      </div>

      <div className="grid">
        {mode !== 'generate' && (
          <section className="card">
            <div className="cardHead">
              <span className="mono-label">{mode === 'compose' ? t('Building blocks') : t('Sources')}{pics.length ? ` · ${pics.length}` : ''}</span>
              {pics.length > 0 && <button className="link" onClick={() => setPics([])}>{t('remove all')}</button>}
            </div>
            <div className="stage">
              {pics.length === 0 ? (
                <div className={`drop ${dragging ? 'drag' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}>
                  <span className="regmark" />
                  <p>{dropText[0]}<span className="kbd">⌘/Ctrl + V</span>{dropText[1]}</p>
                  <p className="hint">{uploadHint}</p>
                </div>
              ) : (
                <div className="mini-grid">
                  {pics.map((b) => (
                    <div key={b.id} className={`mini-image ${b.error ? 'err' : ''}`}>
                      {b.src && <img src={b.src} alt="" />}
                      {b.uploading && <span className="loading" />}
                      {b.error && <span className="badge">!</span>}
                      <button onClick={() => setPics((x) => x.filter((y) => y.id !== b.id))}>×</button>
                    </div>
                  ))}
                  <button className="mini-add" onClick={() => fileRef.current?.click()}>+</button>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden
                onChange={(e) => e.target.files && upload(e.target.files)} />
            </div>
          </section>
        )}

        <section className="card">
          <div className="controls">
            <div className="field">
              <label>{t('Presets')}</label>
              <div className="preset-row">
                <select className="select" value={presetSel}
                  onChange={(e) => { setPresetSel(e.target.value); applyRecipe(presets.find((r) => r.id === e.target.value)); }}>
                  <option value="">{t('Choose a preset …')}</option>
                  {presets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {presetSel && <button className="pbtn" title={t('Delete preset')} onClick={() => { deletePreset(presetSel); setPresetSel(''); }}>✕</button>}
                <button className="pbtn" title={t('Save the current settings as a preset')} onClick={saveAsPreset}>＋ {t('save')}</button>
              </div>
            </div>

            {(mode === 'compose' || mode === 'generate') && (
              <div className="field">
                <label>{mode === 'compose' ? t('What should come out of it?') : t('Description of the new image')}</label>
                <textarea className="area large" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)}
                  placeholder={mode === 'compose'
                    ? t('e.g. “Make the photo look like an oil painting.” or “…with our dog at the edge of the pool.”')
                    : t('e.g. “A minimalist poster with an olive branch on a sand-coloured ground.”')} />
                <div className="hint">{mode === 'compose'
                  ? t('One image = convert (e.g. change the style). Several images = the first is the lead scene, the others supply people and subjects.')
                  : t('The more precise the description, the better the result.')}</div>
              </div>
            )}

            {mode === 'each' && (
              <div className="field">
                <label>{t('What should happen?')}</label>
                <div className="modes">
                  {TASKS.map((m) => {
                    const on = tasks.includes(m.id);
                    const disabled = m.id === 'contour' && !hasCutout;
                    return (
                      <button key={m.id} disabled={disabled}
                        className={`mode ${on ? 'on' : ''} ${disabled ? 'off' : ''}`}
                        onClick={() => toggleTask(m.id)}>
                        <b>{t(m.name)}{on ? ' ✓' : ''}</b><span>{t(m.hint)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {showFormat && (
              <div className="field">
                <label>{mode === 'each' ? t('Output format') : t('Format (optional)')}</label>
                <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
                </select>
                {isFreeFmt && (
                  <>
                    <input className="input" value={customFmt} onChange={(e) => setCustomFmt(e.target.value)}
                      placeholder={format === 'sticker' ? t('e.g. 5 (=5×5 cm) or 5x7') : t('e.g. 25x35, or 5 for 5×5 cm')} />
                    {freeFmtInvalid && <div className="hint warn">{t('Enter a size, for example “25x35” or “5”.')}</div>}
                  </>
                )}
                {theframeConflict && <div className="hint warn">{t('Cut out + The Frame makes no sense — pick one.')}</div>}
                {effCm && (
                  <div className="switch">
                    <button className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>{t('Portrait')}</button>
                    <button className={!portrait ? 'on' : ''} onClick={() => setPortrait(false)}>{t('Landscape')}</button>
                  </div>
                )}
                {targetPx && <div className="hint">{t('Gives exactly {w} × {h} pixels at 300 dpi — ready to print.', { w: targetPx[0], h: targetPx[1] })}</div>}
                {targetPx && mode !== 'generate' && (
                  <div className="switch subtle">
                    <button className={crop === 'crop' ? 'on' : ''} onClick={() => setCrop('crop')}>{t('Crop')}</button>
                    <button className={crop === 'extend' ? 'on' : ''} onClick={() => setCrop('extend')}>{t('Extend')}</button>
                  </div>
                )}
                {targetPx && mode !== 'generate' && crop === 'extend' && (
                  <div className="hint">{t('“Extend” produces more scene around the subject (outpainting) instead of cropping — made for The Frame.')}</div>
                )}
              </div>
            )}

            <div className="field">
              <label>{t('File format')}</label>
              <div className="switch">
                <button className={outputExt === '' ? 'on' : ''} onClick={() => setOutputExt('')}>{t('Default')}</button>
                <button className={outputExt === 'png' ? 'on' : ''} onClick={() => setOutputExt('png')}>PNG</button>
                <button className={outputExt === 'jpg' ? 'on' : ''} onClick={() => setOutputExt('jpg')}>JPG</button>
              </div>
              <div className="hint">
                {outputExt === 'jpg' ? t('JPG — small and easy on the delivery target. Cut-out subjects stay PNG all the same (transparency).')
                  : outputExt === 'png' ? t('PNG — lossless, supports transparency. Large files.')
                  : t('The default from the admin settings (set globally).')}
              </div>
            </div>

            {mode === 'each' && tasks.includes('contour') && (
              <div className="field">
                <label>{t('Sticker border (mm)')}</label>
                <input className="input" type="number" min={0} max={20} step={0.5}
                  value={contourMm} onChange={(e) => setContourMm(Number(e.target.value))} />
              </div>
            )}

            {models.length > 0 && (
              <div className="field">
                <label>{t('Quality')}</label>
                <div className="switch wrap">
                  {models.map((m) => (
                    <button key={m.model_id} className={modelKey === m.model_id ? 'on' : ''}
                      onClick={() => setModelKey(m.model_id)} title={m.description || ''}>{m.label}</button>
                  ))}
                </div>
                <div className="hint">{models.find((m) => m.model_id === modelKey)?.description || ''}</div>
              </div>
            )}

            {mode === 'each' && (
              <div className="field">
                <label>{t('Own instruction (optional)')}</label>
                <textarea className="area" rows={2} value={custom} onChange={(e) => setCustom(e.target.value)}
                  placeholder={t('e.g. “Make the background lighter, leave the rest alone.”')} />
              </div>
            )}

            <div className="field">
              <label>{t('Where to?')}</label>
              <div className="switch">
                <button className={delivery === 'library' ? 'on' : ''} onClick={() => setDelivery('library')}>{t('Library')}</button>
                <button className={delivery === 'remote' ? 'on' : ''} onClick={() => setDelivery('remote')}>{t('Delivery target')}</button>
                <button className={delivery === 'both' ? 'on' : ''} onClick={() => setDelivery('both')}>{t('Both')}</button>
              </div>
              {delivery !== 'library' && (
                <div className="target">
                  <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">{t('Default delivery target')}</option>
                    <option value="mirror">{t('Backup mirror')}</option>
                    {targets.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                  </select>
                  <input className="input" value={gallery} onChange={(e) => setGallery(e.target.value)}
                    placeholder={t('Folder on the target (empty = default)')} />
                </div>
              )}
            </div>

            {(me.private_allowed || me.private_forced) && (
              <label className="private">
                <input type="checkbox" checked={priv} disabled={me.private_forced} onChange={(e) => setPriv(e.target.checked)} />
                <span><b>{t('Private session')} {me.private_forced ? t('(enforced)') : ''}</b>
                  <em>{t('Generate only, remember nothing: no entry in the library, no delivery or backup, no stored prompt. The result can be fetched for a short while, then it is deleted.')}</em></span>
              </label>
            )}

            <button className="button" disabled={!canRun} onClick={run}>
              {busy ? <><span className="spin" />{t('Being created …')}</>
                : mode === 'each' ? (ready.length === 0 ? t('Start')
                  : ready.length === 1 ? t('Start · {n} image', { n: ready.length })
                  : t('Start · {n} images', { n: ready.length }))
                : t('Generate image')}
            </button>
            <div className="hint center">{t('It keeps running on the server — you can close the window.')}</div>
          </div>
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
      <StudioStyles />
    </div>
  );
}

function StudioStyles() {
  return <style>{`
    .studio{display:flex;flex-direction:column;gap:16px;}
    .mode-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
    @media(max-width:560px){.mode-bar{grid-template-columns:1fr;}}
    .mode-tab{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);padding:11px 13px;cursor:pointer;font-family:inherit;}
    .mode-tab b{display:block;font-size:14px;font-weight:600;}
    .mode-tab span{display:block;font-size:11px;color:var(--soft);margin-top:2px;line-height:1.4;}
    .mode-tab.on{border-color:var(--accent);background:var(--accent-bg);}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:start;}
    @media(max-width:820px){.grid{grid-template-columns:1fr;}}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
    .cardHead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);}
    .link{background:none;border:none;cursor:pointer;color:var(--accent);font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;}
    .stage{padding:22px;min-height:290px;display:flex;align-items:center;justify-content:center;}
    .drop{width:100%;min-height:250px;border:1.5px dashed var(--line);border-radius:var(--radius-sm);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:26px;cursor:pointer;}
    .drop.drag{border-color:var(--accent);background:var(--accent-bg);}
    .drop p{margin:0;color:var(--soft);font-size:14px;line-height:1.55;}
    .kbd{font-family:var(--font-mono);font-size:12px;background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:1px 6px;}
    .mini-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;width:100%;}
    .mini-image{position:relative;aspect-ratio:1;border:1px solid var(--line);border-radius:3px;overflow:hidden;
      background:repeating-conic-gradient(oklch(90% 0.006 95) 0% 25%, oklch(96% 0.004 95) 0% 50%) 50%/14px 14px;}
    .mini-image.err{border-color:var(--err);}
    .mini-image img{width:100%;height:100%;object-fit:contain;display:block;}
    .mini-image>button{position:absolute;top:3px;right:3px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(22,21,15,.75);color:#fff;cursor:pointer;font-size:14px;line-height:1;}
    .mini-image .badge{position:absolute;bottom:3px;left:3px;background:var(--err);color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}
    .loading{position:absolute;inset:0;background:var(--paper);opacity:.6;}
    .mini-add{aspect-ratio:1;border:1.5px dashed var(--line);background:none;border-radius:3px;cursor:pointer;font-size:22px;color:var(--soft);}
    .controls{padding:16px;display:flex;flex-direction:column;gap:15px;}
    .field label{display:block;font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--soft);margin-bottom:7px;}
    .input,.select,.area{width:100%;background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 11px;font-family:inherit;font-size:14px;color:var(--ink);outline:none;}
    .input:focus,.select:focus,.area:focus{border-color:var(--accent);}
    .area{font-size:13.5px;line-height:1.5;resize:vertical;}
    .area.large{font-size:15px;line-height:1.55;}
    .hint{font-size:11.5px;color:var(--soft);margin-top:6px;line-height:1.5;}
    .hint.center{text-align:center;}
    .hint.warn{color:var(--err);}
    .modes{display:flex;flex-direction:column;gap:6px;}
    .mode{text-align:left;background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 11px;cursor:pointer;font-family:inherit;}
    .mode b{display:block;font-size:14px;font-weight:600;}
    .mode span{display:block;font-size:11.5px;color:var(--soft);margin-top:2px;}
    .mode.on{border-color:var(--accent);background:var(--accent-bg);}
    .mode.off{opacity:.5;cursor:not-allowed;}
    .switch{display:flex;gap:6px;margin-top:8px;}
    .switch button{flex:1;background:#fff;border:1px solid var(--line);border-radius:3px;padding:8px;cursor:pointer;font-family:inherit;font-size:13px;color:var(--soft);}
    .switch button.on{border-color:var(--accent);background:var(--accent-bg);color:var(--ink);font-weight:600;}
    .switch.subtle button{font-size:12.5px;}
    .target{display:flex;flex-direction:column;gap:7px;margin-top:8px;}
    .preset-row{display:flex;gap:6px;align-items:center;}
    .preset-row .select{flex:1;}
    .pbtn{background:#fff;border:1px solid var(--line);border-radius:3px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:12px;color:var(--ink);white-space:nowrap;}
    .private{display:flex;gap:10px;align-items:flex-start;cursor:pointer;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:11px;}
    .private input{margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex:0 0 auto;}
    .private b{display:block;font-size:13.5px;}
    .private em{display:block;font-style:normal;font-size:11.5px;color:var(--soft);margin-top:2px;line-height:1.45;}
    .switch.wrap{flex-wrap:wrap;}
    .switch.wrap button{flex:1 1 auto;min-width:110px;}
    .button{width:100%;border:none;border-radius:3px;padding:13px;cursor:pointer;background:var(--accent);color:#fff;font-family:inherit;font-weight:600;font-size:15px;}
    .button:disabled{background:#C9C8BF;cursor:not-allowed;}
    .spin{width:13px;height:13px;display:inline-block;border:2px solid #fff;border-top-color:transparent;border-radius:50%;vertical-align:-2px;margin-right:9px;animation:sp 1s linear infinite;}
    @keyframes sp{to{transform:rotate(360deg);}}
    .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);color:#FBFBF7;padding:10px 18px;border-radius:3px;font-size:13.5px;z-index:60;}
  `}</style>;
}
