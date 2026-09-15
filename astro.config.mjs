import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// Klarbild runs as a Node server (SSR) with an in-process queue.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // CSRF: handled by our own SameSite=Lax session cookie. Astro's checkOrigin
  // breaks multipart uploads behind a reverse proxy, because the proxy speaks
  // http to the app while the browser spoke https and the origins no longer match.
  security: { checkOrigin: false },
  // Content-Security-Policy with hashes instead of 'unsafe-inline': Astro computes
  // the hash of every inline script and style it emits, at build time. The remaining
  // directives are set by the middleware (src/middleware.ts).
  experimental: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
    },
  },
  server: { host: true, port: Number(process.env.PORT) || 4321 },
  vite: {
    ssr: {
      // Do not bundle native modules
      external: ['sharp', 'argon2', 'pg', 'pg-boss', 'ssh2-sftp-client', 'basic-ftp', 'heic-convert'],
    },
  },
});
