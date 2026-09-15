import type { APIRoute } from 'astro';
import { query, one } from '../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async () => {
  const total = await one<{ n: string }>(`SELECT count(*)::text n FROM items WHERE status='done'`);
  const failed = await one<{ n: string }>(`SELECT count(*)::text n FROM items WHERE status='failed'`);
  const cost = async (days: number | null) => (await one<{ c: string }>(
    `SELECT COALESCE(sum(cost),0)::text c FROM items WHERE cost IS NOT NULL` +
    (days ? ` AND created_at > now() - interval '${days} days'` : ''))
  )?.c || '0';
  const byModel = await query(`SELECT COALESCE(model_used,'—') m, count(*)::int n, COALESCE(sum(cost),0)::float c
    FROM items WHERE status='done' GROUP BY 1 ORDER BY n DESC`);
  const last = await one<{ t: string }>(`SELECT max(created_at)::text t FROM items`);

  const totalN = Number(total?.n || 0), failedN = Number(failed?.n || 0);
  return new Response(JSON.stringify({
    total: totalN, failed: failedN,
    error_rate: totalN + failedN ? Math.round((failedN / (totalN + failedN)) * 100) : 0,
    cost_today: Number(await cost(1)), cost_7: Number(await cost(7)),
    cost_30: Number(await cost(30)), cost_all: Number(await cost(null)),
    by_model: byModel, last_activity: last?.t || null,
  }), { headers: { 'Content-Type': 'application/json' } });
};
