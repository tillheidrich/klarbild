import PgBoss from 'pg-boss';

export const QUEUE = 'generate';
export interface GenerateJob { itemId: string; jobId: string; }

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
    boss.on('error', (e) => console.error('[pg-boss]', e));
    await boss.start();
    await boss.createQueue(QUEUE);
  }
  return boss;
}

export async function enqueue(job: GenerateJob): Promise<void> {
  const b = await getBoss();
  await b.send(QUEUE, job, { retryLimit: 2, retryBackoff: true });
}

export async function startWorker(
  concurrency: number,
  handler: (job: GenerateJob) => Promise<void>,
): Promise<void> {
  const b = await getBoss();
  await b.work<GenerateJob>(
    QUEUE,
    { batchSize: Math.max(1, concurrency), pollingIntervalSeconds: 2 },
    async (jobs) => { await Promise.all(jobs.map((j) => handler(j.data))); },
  );
  console.log(`[queue] Worker active (concurrency ${concurrency}).`);
}
