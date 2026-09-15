import { useCallback, useEffect, useState } from 'react';
import { filenameFromHeader } from '../lib/naming';
import { useT, type Dict, type Locale, type TFunction } from '../lib/useT';

/**
 * Recently printed.
 *
 * What is stored is **the instructions only** — sheet, sizes, quantities and the
 * references to the images. No PDF: an A3 sheet is quickly 20–80 MB, and the
 * module computes without AI, so the same job yields exactly the same sheet
 * again. Generating it again is cheaper than keeping it.
 *
 * "Print again" therefore only works if **all** images came from the library and
 * are still there. For uploaded files the source is gone after the clean-up —
 * which is then also stated on the entry.
 */
interface Run {
  id: string; origin: string; summary: string | null; paper: string | null;
  pages: number; pieces: number; bytes: number | null; created_at: string;
  images: { id: string; filename: string | null }[];
  missing: number; uploaded: number; repeatable: boolean; config: any;
}

const when = (s: string, t: TFunction, dateLocale: string) => {
  const d = new Date(s);
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  if (minutes < 24 * 60) return t('{n} h ago', { n: Math.round(minutes / 60) });
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' });
};
// A test sheet is 20 KB, an A3 poster 80 MB. `toFixed(1)` in MB turned the small
// case into "0.0 MB" — so below one megabyte the size is given in KB.
const size = (b: number | null) => {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
};
// Plural: pick the whole sentence, never glue a number to a word — which word
// form a number takes is a property of the language, not of the number.
const plural = (t: TFunction, n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

export default function PrintRuns({ onLoad, locale, dict }: { onLoad?: (config: any) => void; locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  // Dates stay numeric (day/month/year); only the order and separators follow
  // the language of the instance.
  const dateLocale = locale === 'de' ? 'de-DE' : 'en-GB';
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/print/runs');
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setRuns(d.runs || []); setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (text: string, ok = true) => { setMsg({ t: text, ok }); setTimeout(() => setMsg(null), 5000); };

  /** Produce the same sheet once more — same request, same PDF. */
  const again = async (r: Run) => {
    setBusy(r.id);
    try {
      const res = await fetch('/api/print/sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `origin` marks the run as a repeat, so the list does not look as if
        // someone had built the same sheet twice by hand.
        body: JSON.stringify({ ...r.config, origin: 'repeat' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        say(j.error || t('That did not work — an image may be missing.'), false);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // The repeat print is a **new** file with a new timestamp and a new short
      // id — so it does not overwrite the first sheet.
      a.download = filenameFromHeader(res.headers.get('Content-Disposition'), 'klarbild-print.pdf');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say(t('PDF generated again. When printing, choose “Actual size / 100 %”.'));
      load();
    } catch { say(t('Network error.'), false); }
    finally { setBusy(null); }
  };

  const remove = async (r: Run) => {
    if (!confirm(t('Take this entry off the list?\n\nThe images stay in the library — only the history entry disappears.'))) return;
    const res = await fetch(`/api/print/runs?id=${r.id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({}));
    if (res.ok) { setRuns((p) => p.filter((x) => x.id !== r.id)); } else say(res.error || t('That did not work.'), false);
  };

  if (loading) return <p className="pr-empty">{t('Loading …')}</p>;

  if (failed) return (
    <div className="pr">
      <p className="pr-empty">{t('The history could not be loaded.')}{' '}
        <button className="pr-btn" onClick={() => { setLoading(true); load(); }}>{t('Try again')}</button></p>
      <PrintRunsStyles />
    </div>
  );

  if (!runs.length) return (
    <div className="pr">
      <div className="pr-empty-box">
        <span className="regmark" />
        <h2>{t('Nothing printed yet')}</h2>
        <p>{t('As soon as you create a PDF in the print area, it stands here — with a button to get exactly the same sheet again.')}{' '}
          <a href="/print">{t('Open the print area')}</a></p>
      </div>
      <PrintRunsStyles />
    </div>
  );

  return (
    <div className="pr">
      {msg && <p className={`pr-msg ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.t}</p>}

      <div className="pr-list">
        {runs.map((r) => (
          <article key={r.id} className="pr-card">
            <div className="pr-head">
              <div className="pr-title">
                <h3>{r.summary || t('Print sheet')}</h3>
                <span className="pr-when">{when(r.created_at, t, dateLocale)}</span>
              </div>
              {r.origin === 'repeat' && <span className="pr-mark">{t('repeated')}</span>}
              {r.origin === 'telegram' && <span className="pr-mark">Telegram</span>}
            </div>

            <div className="pr-meta">
              {r.paper} · {plural(t, r.pages, '{n} sheet', '{n} sheets')} · {plural(t, r.pieces, '{n} piece', '{n} pieces')}
              {r.bytes ? <> · {t('the PDF was {size}', { size: size(r.bytes) })}</> : null}
            </div>

            {r.images.length > 0 && (
              <div className="pr-images">
                {r.images.slice(0, 8).map((b) => (
                  <img key={b.id} src={`/api/items/${b.id}/file?thumb=1`} alt={b.filename || ''}
                       title={b.filename || ''} loading="lazy"
                       onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                ))}
                {r.images.length > 8 && <span className="pr-more">+{r.images.length - 8}</span>}
              </div>
            )}

            <div className="pr-actions">
              {r.repeatable ? (
                <button className="pr-btn strong" disabled={busy === r.id} onClick={() => again(r)}>
                  {busy === r.id ? t('Being generated …') : t('Print again')}
                </button>
              ) : (
                <span className="pr-why">
                  {r.missing > 0
                    ? plural(t, r.missing,
                        '{n} image has been deleted since — cannot be repeated.',
                        '{n} images have been deleted since — cannot be repeated.')
                    : t('Uploaded back then instead of taken from the library — the source file is gone.')}
                </span>
              )}
              {onLoad && (
                <button className="pr-btn" onClick={() => onLoad(r.config)}>{t('Apply these settings')}</button>
              )}
              <button className="pr-btn danger" onClick={() => remove(r)}>{t('Remove')}</button>
            </div>
          </article>
        ))}
      </div>

      <p className="pr-hint">
        {t('Only the settings are kept here, not the PDFs — an A3 sheet would quickly be 20 to 80 MB. Because the print module computes without AI, the same job yields exactly the same sheet again. The last {n} prints per person are kept.', { n: 100 })}
      </p>

      <PrintRunsStyles />
    </div>
  );
}

function PrintRunsStyles() {
  return <style>{`
    .pr{display:grid;gap:14px;}
    .pr-empty{color:var(--soft);}
    .pr-empty-box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
      padding:44px 24px;text-align:center;}
    .pr-empty-box h2{margin:14px 0 8px;font-size:1.15rem;}
    .pr-empty-box p{margin:0;color:var(--ink-soft);line-height:1.6;}
    .pr-list{display:grid;gap:12px;}
    .pr-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
      padding:15px;display:grid;gap:10px;}
    .pr-head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;}
    .pr-title{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;min-width:0;flex:1;}
    .pr-title h3{margin:0;font-size:.98rem;letter-spacing:-.01em;overflow-wrap:anywhere;}
    .pr-when{font-size:.78rem;color:var(--soft);white-space:nowrap;}
    .pr-mark{font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;
      padding:3px 8px;border-radius:20px;background:var(--paper);color:var(--soft);border:1px solid var(--line);}
    .pr-meta{font-size:.8rem;color:var(--soft);line-height:1.5;}
    .pr-images{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .pr-images img{width:46px;height:46px;object-fit:cover;border:1px solid var(--line);border-radius:3px;
      background:var(--paper);}
    .pr-more{font-family:var(--font-mono);font-size:11px;color:var(--soft);}
    .pr-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .pr-btn{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);
      padding:9px 12px;font-size:.84rem;cursor:pointer;font-family:inherit;color:var(--ink);white-space:nowrap;}
    .pr-btn:hover{border-color:var(--accent);}
    .pr-btn.strong{background:var(--accent);color:var(--card);border-color:var(--accent);font-weight:600;}
    .pr-btn.danger{color:var(--err);}
    .pr-btn:disabled{background:var(--paper);color:var(--soft);border-color:var(--line);cursor:not-allowed;}
    .pr-why{font-size:.8rem;color:var(--soft);line-height:1.5;}
    .pr-hint{margin:0;font-size:.78rem;color:var(--soft);line-height:1.6;max-width:70ch;}
    .pr-msg{margin:0;font-size:.9rem;}
    .pr-msg.ok{color:var(--ok);}
    .pr-msg.err{color:var(--err);}
    @media(max-width:640px){
      .pr-btn{flex:1;text-align:center;padding:11px 10px;}
      .pr-why{flex-basis:100%;}
    }
  `}</style>;
}
