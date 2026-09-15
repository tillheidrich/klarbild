import type { APIRoute } from 'astro';
import net from 'node:net';
import dns from 'node:dns/promises';
import { one } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** TCP connection test from inside the container (with a timeout). */
function tcpProbe(host: string, port: number, timeoutMs = 6000): Promise<{ ok: boolean; ms: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return; done = true;
      try { sock.destroy(); } catch { /* no matter */ }
      resolve({ ok, ms: Date.now() - start, error });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, 'Timeout — no answer (firewall or routing?)'));
    sock.once('error', (e: any) => finish(false, e?.code || e?.message || 'Connection error'));
    sock.connect(port, host);
  });
}

/** Checks whether a host:port can be reached from the container. Body {host,port}, or
 *  the configured backup mirror host if nothing is given. Also resolves DNS. */
export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({} as any));
  let host = (b.host || '').trim();
  let port = Number(b.port) || 0;
  if (!host) {
    const s = await one<{ mirror_host: string | null; mirror_port: number | null; mirror_protocol: string | null }>(
      'SELECT mirror_host, mirror_port, mirror_protocol FROM settings WHERE id=1');
    host = (s?.mirror_host || '').trim();
    port = s?.mirror_port || (s?.mirror_protocol === 'ftps' ? 21 : 22);
  }
  if (!host) return json({ error: 'No host given.' }, 400);
  if (!port) port = 22;

  const out: any = { host, port };
  // DNS: only if this is not a plain IP.
  const isIp = net.isIP(host) !== 0;
  if (!isIp) {
    try { const a = await dns.lookup(host); out.resolve = { ok: true, address: a.address }; }
    catch (e: any) { out.resolve = { ok: false, error: e?.code || 'DNS lookup failed' }; }
  } else {
    out.resolve = { ok: true, address: host, note: 'IP address' };
  }
  out.tcp = await tcpProbe(host, port);
  out.reachable = out.tcp.ok;
  return json(out);
};
