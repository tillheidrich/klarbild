import { one, query } from './lib/db';
import { startWorker, type GenerateJob } from './lib/queue';
import { processItem } from './lib/process';
import { deliverPendingForJob } from './lib/delivery';

/** Starts the queue worker (in the same Node process as the app). */
export async function startImageWorker(): Promise<void> {
  const s = await one<{ concurrency: number }>('SELECT concurrency FROM settings WHERE id=1');
  const concurrency = s?.concurrency ?? 2;
  await startWorker(concurrency, handle);
}

/** Monthly budget reached? (The sum of usage.cost in the running calendar month.) */
async function budgetExceeded(): Promise<boolean> {
  const s = await one<{ monthly_budget: number | null }>('SELECT monthly_budget FROM settings WHERE id=1');
  const cap = s?.monthly_budget ? Number(s.monthly_budget) : 0;
  if (!cap || cap <= 0) return false;
  const row = await one<{ spent: number }>(
    `SELECT COALESCE(sum(cost),0)::float AS spent FROM items
       WHERE cost IS NOT NULL AND created_at >= date_trunc('month', now())`);
  return (row?.spent || 0) >= cap;
}

async function handle(job: GenerateJob): Promise<void> {
  // Do not process paused or cancelled jobs.
  const j = await one<{ status: string }>('SELECT status FROM jobs WHERE id=$1', [job.jobId]);
  if (!j || j.status === 'paused' || j.status === 'cancelled') {
    await query(`UPDATE items SET status='queued' WHERE id=$1 AND status='running'`, [job.itemId]);
    return;
  }

  // Cost cap: on reaching it pause the job and put the item back into the queue.
  if (await budgetExceeded()) {
    await query(`UPDATE jobs SET status='paused' WHERE id=$1`, [job.jobId]);
    await query(`UPDATE items SET status='queued', error_message='Monthly budget reached' WHERE id=$1`, [job.itemId]);
    console.error('[worker] monthly budget reached — job paused', job.jobId);
    return;
  }

  await query(`UPDATE jobs SET status='running' WHERE id=$1 AND status='queued'`, [job.jobId]);

  try {
    const res = await processItem(job.itemId);
    if (res.ok) {
      await query(`UPDATE jobs SET done_count=done_count+1 WHERE id=$1`, [job.jobId]);
    } else {
      await query(`UPDATE jobs SET failed_count=failed_count+1 WHERE id=$1`, [job.jobId]);
    }
  } catch (e: any) {
    if (e?.status === 402) {
      // Credit used up → pause the job, put the item back into the queue.
      await query(`UPDATE jobs SET status='paused' WHERE id=$1`, [job.jobId]);
      await query(`UPDATE items SET status='queued', error_message='Credit used up' WHERE id=$1`,
        [job.itemId]);
      console.error('[worker] 402 — job paused', job.jobId);
      return;
    }
    await query(`UPDATE items SET status='failed', error_message=$2 WHERE id=$1`,
      [job.itemId, String(e?.message || e).slice(0, 500)]);
    await query(`UPDATE jobs SET failed_count=failed_count+1 WHERE id=$1`, [job.jobId]);
  }

  await maybeComplete(job.jobId);
}

/** Finish the job once every item is done or failed. */
async function maybeComplete(jobId: string): Promise<void> {
  const row = await one<{ total: number; done: number; failed: number; open: number }>(
    `SELECT total,
       (SELECT count(*) FROM items WHERE job_id=$1 AND status='done')::int AS done,
       (SELECT count(*) FROM items WHERE job_id=$1 AND status='failed')::int AS failed,
       (SELECT count(*) FROM items WHERE job_id=$1 AND status IN ('queued','running'))::int AS open
     FROM jobs WHERE id=$1`, [jobId]);
  if (row && row.open === 0) {
    // Everything failed, nothing done → the job counts as failed (red).
    const finalStatus = row.done === 0 && row.failed > 0 ? 'failed' : 'done';
    // Idempotent: only the first transition triggers delivery and the reply.
    const done = await query(
      `UPDATE jobs SET status=$2, finished_at=now()
        WHERE id=$1 AND status NOT IN ('done','failed','cancelled') RETURNING id`, [jobId, finalStatus]);
    if (done.length === 0) return;
    // Kick off the delivery for every item that is still open.
    try { await deliverPendingForJob(jobId); } catch (e) { console.error('[worker] delivery:', e); }
    // A Telegram reply if the job came out of a chat.
    const jt = await one<{ origin: string; telegram_chat_id: string | null }>(
      'SELECT origin, telegram_chat_id FROM jobs WHERE id=$1', [jobId]);
    if (jt?.origin === 'telegram' && jt.telegram_chat_id) {
      try {
        const { notifyJobDone } = await import('./lib/telegram');
        await notifyJobDone(Number(jt.telegram_chat_id), jobId);
      } catch (e) { console.error('[worker] Telegram notify:', e); }
    }
    // A notice by email — only if whoever started the job switched that on
    // explicitly. Failures stay in the log; a job does not count as failed just
    // because a notification did not go out.
    try { await mailJobDone(jobId, finalStatus, row.done, row.failed); }
    catch (e) { console.error('[worker] mail notify:', e); }
  }
}

/** A short reply to whoever started the job, if they asked for one. */
async function mailJobDone(jobId: string, status: string, done: number, failed: number): Promise<void> {
  const u = await one<{ email: string | null; display_name: string | null; username: string; private: boolean }>(
    `SELECT u.email, u.display_name, u.username, j.private
       FROM jobs j JOIN users u ON u.id = j.created_by
      WHERE j.id = $1 AND u.notify_jobs = true AND u.email IS NOT NULL`, [jobId]);
  // Private sessions deliberately leave no trace — no mail either.
  if (!u?.email || u.private) return;

  const { trySendMail, mailLayout, mailReady } = await import('./lib/mail');
  if (!(await mailReady())) return;

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}/queue`;
  const name = u.display_name || u.username;
  const good = status !== 'failed';
  const title = good ? 'Your images are ready' : 'A job has failed';
  const body = good
    ? `${done} ${done === 1 ? 'image is' : 'images are'} ready${failed ? `, ${failed} ${failed === 1 ? 'is' : 'are'} not` : ''}.`
    : `Unfortunately nothing worked out (${failed} ${failed === 1 ? 'item' : 'items'}). The reason is in the queue.`;

  await trySendMail({
    to: u.email,
    subject: `Klarbild — ${title.toLowerCase()}`,
    text: `Hello ${name},\n\n${body}\n\n${url}\n\n`
      + `You can switch these notices off again in Klarbild under "My account".`,
    html: mailLayout(title, [
      `Hello ${name},`, body,
      `You can switch these notices off again in Klarbild under "My account" at any time.`,
    ], { text: 'View in Klarbild', url }),
  });
}
