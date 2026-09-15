import React, { useState, useEffect, useCallback } from 'react';
import { useT, type Dict, type Locale } from '../lib/useT';

const STATUS_LABELS: Record<string, string> = {
  queued: 'waiting', running: 'running', done: 'done', failed: 'failed',
  skipped: 'skipped', paused: 'paused', cancelled: 'cancelled',
};

/** Point in time, short: today → "HH:MM", otherwise "DD.MM. HH:MM". */
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hm : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${hm}`;
}

export default function QueueApp({ jobId, locale, dict }: { jobId: string | null; locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [job, setJob] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [saveView, setSaveView] = useState<any | null>(null);

  const load = useCallback(async () => {
    if (jobId) {
      const r = await fetch(`/api/jobs/${jobId}`).then((x) => x.json()).catch(() => null);
      if (r?.job) { setJob(r.job); setItems(r.items || []); }
    } else {
      const r = await fetch('/api/jobs').then((x) => x.json()).catch(() => null);
      setJobs(r?.jobs || []);
    }
  }, [jobId]);

  useEffect(() => {
    load();
    const active = !job || ['queued', 'running', 'paused'].includes(job?.status);
    const ti = setInterval(load, active ? 2000 : 6000);
    return () => clearInterval(ti);
  }, [load, job?.status]);

  const act = async (path: string) => { await fetch(path, { method: 'POST' }); load(); };

  if (!jobId) {
    return (
      <div className="q">
        <div className="cardHead"><span className="mono-label">{t('Jobs')}</span></div>
        {jobs.length === 0 ? <p className="hint">{t('No jobs yet. Start in the studio.')}</p> : (
          <div className="joblist">
            {jobs.map((j) => (
              <a key={j.id} className="jobrow" href={`/queue?job=${j.id}`}>
                <span className={`dot ${j.status}`} />
                <b>{j.done_count}/{j.total}</b>
                <span className="hint">{t(STATUS_LABELS[j.status] || j.status)}{j.by_name ? ` · ${j.by_name}` : ''}
                  {j.finished_at && ['done', 'failed', 'cancelled'].includes(j.status) ? ` · ${t('done {time}', { time: fmtTime(j.finished_at) })}` : ''}</span>
              </a>
            ))}
          </div>
        )}
        <QStyles />
      </div>
    );
  }

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const open = items.filter((i) => ['queued', 'running'].includes(i.status)).length;
  const pct = items.length ? Math.round(((done + failed) / items.length) * 100) : 0;
  const etaSec = open * 20;

  return (
    <div className="q">
      <div className="cardHead">
        <span className="mono-label">{t('Job')} · {t(STATUS_LABELS[job?.status] || job?.status)}
          {job?.finished_at && ['done', 'failed', 'cancelled'].includes(job?.status) ? ` · ${t('ended {time}', { time: fmtTime(job.finished_at) })}` : ''}</span>
        <div className="row">
          {job?.status === 'running' && <button className="mini" onClick={() => act(`/api/jobs/${jobId}/pause`)}>{t('Pause')}</button>}
          {job?.status === 'paused' && <button className="mini" onClick={() => act(`/api/jobs/${jobId}/resume`)}>{t('Resume')}</button>}
          {failed > 0 && <button className="mini" onClick={() => act(`/api/jobs/${jobId}/retry-failed`)}>{t('Retry the failed ones')}</button>}
          {['queued', 'running', 'paused'].includes(job?.status) && <button className="mini" onClick={() => act(`/api/jobs/${jobId}/cancel`)}>{t('Cancel')}</button>}
          {['done', 'failed', 'cancelled'].includes(job?.status) && (
            <button className="mini" onClick={async () => {
              if (!confirm(t('Delete this job?'))) return;
              await fetch(`/api/jobs/${jobId}/delete`, { method: 'POST' });
              location.href = '/queue';
            }}>{t('Delete')}</button>
          )}
        </div>
      </div>

      <div className="progress">
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <div className="hint">{failed
          ? t('{done} done, {failed} failed of {total}', { done, failed, total: items.length })
          : t('{done} done of {total}', { done, total: items.length })}
          {open > 0 && ` · ${etaSec >= 60
            ? t('about {n} more min', { n: Math.ceil(etaSec / 60) })
            : t('about {n} more sec', { n: etaSec })}`}</div>
      </div>

      <div className="items">
        {items.map((it) => (
          <div key={it.id} className={`item ${it.status}`}>
            <div className="thumb">
              {it.status === 'done' && it.result_path
                ? <img src={`/api/items/${it.id}/file`} alt="" loading="lazy" />
                : <span className={`dot ${it.status}`} />}
            </div>
            <div className="itxt">
              <b>{it.filename || t('Image {n}', { n: it.position + 1 })}</b>
              <span className="hint">{STATUS_LABELS[it.status] ? t(STATUS_LABELS[it.status]) : ''}{it.output_px ? ` · ${it.output_px}px` : ''}</span>
              {it.error_message && <span className="hint err">{it.error_message}</span>}
            </div>
            <div className="iact">
              {it.status === 'done' && <button className="mini" onClick={() => setSaveView(it)}>{t('Download')}</button>}
              {it.status === 'failed' && <button className="mini" onClick={() => act(`/api/items/${it.id}/retry`)}>{t('Again')}</button>}
            </div>
          </div>
        ))}
      </div>
      {saveView && (
        <div className="zoom" onClick={() => setSaveView(null)}>
          <img className="saveimg" src={`/api/items/${saveView.id}/file?preview=1`} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="save-foot" onClick={(e) => e.stopPropagation()}>
            <span>{t('📱 iPhone/iPad: press and hold the image → “Save to Photos”.')}</span>
            <a className="mini" href={`/api/items/${saveView.id}/file?download=1`}>{t('Original as a file (.png)')}</a>
            <button className="mini" onClick={() => setSaveView(null)}>{t('Close')}</button>
          </div>
        </div>
      )}
      <QStyles />
    </div>
  );
}

function QStyles() {
  return <style>{`
    .q{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
    .cardHead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);gap:10px;flex-wrap:wrap;}
    .row{display:flex;gap:6px;flex-wrap:wrap;}
    .progress{padding:16px;border-bottom:1px solid var(--line);}
    .bar{height:6px;background:var(--paper);border-radius:20px;overflow:hidden;}
    .bar i{display:block;height:100%;background:var(--accent);transition:width .4s;}
    .hint{font-size:11.5px;color:var(--soft);margin-top:6px;line-height:1.5;display:block;}
    .hint.err{color:var(--err);}
    .items{display:flex;flex-direction:column;}
    .item{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line);}
    .thumb{width:46px;height:46px;flex:none;border:1px solid var(--line);border-radius:3px;overflow:hidden;display:flex;align-items:center;justify-content:center;
      background:repeating-conic-gradient(oklch(90% 0.006 95) 0% 25%, oklch(96% 0.004 95) 0% 50%) 50%/12px 12px;}
    .thumb img{width:100%;height:100%;object-fit:contain;}
    .itxt{flex:1;min-width:0;}
    .itxt b{font-size:13.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .iact{flex:none;}
    .mini{background:#fff;border:1px solid var(--line);border-radius:3px;padding:6px 11px;cursor:pointer;font-family:inherit;font-size:12.5px;color:var(--ink);text-decoration:none;}
    .dot{width:11px;height:11px;border-radius:50%;background:var(--mark);display:inline-block;}
    .dot.running{background:var(--accent);}
    .dot.done{background:var(--ok);}
    .dot.failed{background:var(--err);}
    .dot.queued{background:var(--mark);}
    .zoom{position:fixed;inset:0;background:rgba(22,21,15,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px;z-index:50;}
    .saveimg{max-width:94vw;max-height:78vh;border-radius:4px;display:block;}
    .save-foot{display:flex;flex-direction:column;align-items:center;gap:10px;color:#EAEAE3;font-size:13.5px;text-align:center;}
    .save-foot .mini{text-decoration:none;}
    .joblist{display:flex;flex-direction:column;}
    .jobrow{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink);}
    p.hint{padding:16px;}
  `}</style>;
}
