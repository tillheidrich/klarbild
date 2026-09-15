import type { APIRoute } from 'astro';
import { pool } from '../../lib/db';
import { storageOk } from '../../lib/storage';

export const prerender = false;

export const GET: APIRoute = async () => {
  const out: Record<string, string> = { service: 'klarbild' };
  let ok = true;

  try { await pool.query('SELECT 1'); out.db = 'ok'; }
  catch { out.db = 'error'; ok = false; }

  out.storage = (await storageOk()) ? 'ok' : 'error';
  if (out.storage !== 'ok') ok = false;

  out.status = ok ? 'ok' : 'degraded';
  return new Response(JSON.stringify(out), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
};
