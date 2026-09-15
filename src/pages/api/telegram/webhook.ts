import type { APIRoute } from 'astro';
import { webhookCallback } from 'grammy';
import { getBot, getWebhookSecret } from '../../../lib/telegram';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
let handler: ((req: Request) => Promise<Response>) | null = null;

export const POST: APIRoute = async ({ request }) => {
  if (!has('telegram')) return moduleOff('telegram');
  const bot = await getBot();
  if (!bot) return new Response('Bot inactive', { status: 503 });
  if (!handler) {
    handler = webhookCallback(bot, 'std/http', { secretToken: getWebhookSecret() || undefined });
  }
  try {
    return await handler(request);
  } catch (e) {
    console.error('[telegram] webhook', e);
    return new Response('ok'); // do not flood Telegram with 5xx
  }
};
