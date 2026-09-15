#!/usr/bin/env node
/**
 * A small guard against committing a credential.
 *
 * This is not a replacement for gitleaks — run that too if you have it. It
 * exists because the cheapest moment to catch a leaked key is before the push,
 * and because a project that ships `.env.example` invites the mistake of
 * shipping `.env` next to it.
 *
 * Exits non-zero on the first finding, printing the file and line.
 */
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json', 'LICENSE', 'secret-scan.mjs']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.astro', '.json', '.sql', '.md',
  '.yaml', '.yml', '.css', '.html', '.txt', '.example', '',
]);

const RULES = [
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style API key'],
  [/sk-or-v1-[A-Za-z0-9]{20,}/, 'OpenRouter API key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN (?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/, 'private key'],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/, 'Telegram bot token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  // Assignments that look like a real value rather than a placeholder.
  [/(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'${}\s]{12,}["']/i,
   'hardcoded credential'],
];

// Lines that are allowed to match: documentation of the shape of a secret,
// and the example file, which is meant to show the names without the values.
const ALLOW = [
  /example|placeholder|CHANGEME|your-|<[a-z]+>|openssl rand/i,
  /^\s*(?:\/\/|#|--|\*)/,
];

let findings = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name));
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.name !== '.env.example' && !TEXT_EXT.has(extname(entry.name))) continue;
    if (statSync(path).size > 2_000_000) continue;
    scan(path);
  }
}

function scan(path) {
  const rel = relative(ROOT, path);
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const [re, what] of RULES) {
      if (re.test(line)) {
        console.error(`${rel}:${i + 1}  possible ${what}`);
        console.error(`    ${line.trim().slice(0, 120)}`);
        findings++;
        return;
      }
    }
  });
}

await walk(ROOT);

if (findings) {
  console.error(`\n${findings} possible secret(s) found. Nothing was committed.`);
  process.exit(1);
}
console.log('Secret scan clean.');
