import { runMigrations } from './db';
import { ensureBucket } from './storage';
import { seed } from './seed';
import { has, activeModules } from './modules';

let started: Promise<void> | null = null;

/** One-time server initialisation (idempotent, triggered by the first request). */
export function ensureInit(): Promise<void> {
  if (!started) {
    started = (async () => {
      await runMigrations();
      try { await ensureBucket(); } catch (e) { console.error('[init] object storage not ready:', e); }
      await seed();

      // The worker only exists to run image jobs through a model. A print-only
      // instance has no queue to drain, so it does not start one.
      if (has('ai')) {
        try { const { startImageWorker } = await import('../worker'); await startImageWorker(); }
        catch (e) { console.error('[init] worker failed to start:', e); }
      }
      if (has('telegram')) {
        try { const { setupTelegram } = await import('./telegram'); await setupTelegram(); }
        catch (e) { console.error('[init] Telegram setup failed:', e); }
      }
      try { const { startMaintenance } = await import('./maintenance'); startMaintenance(); }
      catch (e) { console.error('[init] maintenance failed to start:', e); }

      console.log(`[init] Klarbild ready — modules: ${activeModules().join(', ')}`);
    })().catch((e) => { started = null; throw e; });
  }
  return started;
}
