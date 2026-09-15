import { one } from './db';

/** Builds an accompanying metadata file (Markdown) for an item. */
export async function buildMetadataMd(itemId: string): Promise<string> {
  const it = await one<any>(
    `SELECT i.filename, i.output_px, i.has_alpha, i.model_used, i.prompt_used, i.cost,
            i.created_at, i.delivery_status, i.color_tag, j.mode, j.recipe_snapshot
       FROM items i JOIN jobs j ON j.id=i.job_id WHERE i.id=$1`, [itemId]);
  if (!it) return '';
  const r = it.recipe_snapshot || {};
  const tasks = Array.isArray(r.tasks) ? r.tasks.join(', ') : '';
  const TAG: Record<string, string> = { red: 'Red', orange: 'Orange', green: 'Green', final: 'Final' };
  const lines = [
    `# ${it.filename || itemId}`,
    '',
    `- **Created:** ${new Date(it.created_at).toISOString()}`,
    `- **Mode:** ${it.mode || 'each'}`,
    tasks ? `- **Tasks:** ${tasks}` : '',
    r.output_format ? `- **Format:** ${r.output_format}${r.orientation ? ` (${r.orientation})` : ''}` : '',
    it.output_px ? `- **Resolution:** ${it.output_px} px${r.dpi ? ` @ ${r.dpi} dpi` : ''}` : '',
    `- **Transparency:** ${it.has_alpha ? 'yes' : 'no'}`,
    it.model_used ? `- **Model:** ${it.model_used}` : '',
    it.color_tag ? `- **Tag:** ${TAG[it.color_tag] || it.color_tag}` : '',
    it.cost != null ? `- **Cost:** $${Number(it.cost).toFixed(4)}` : '',
    '',
    '## Prompt',
    '',
    '```',
    (it.prompt_used || '(no prompt stored)'),
    '```',
  ].filter((l) => l !== '');
  return lines.join('\n') + '\n';
}

/** File name of the sidecar file: <result>.md */
export function sidecarName(filename: string | null): string {
  const base = (filename || 'klarbild').replace(/\.[^.]+$/, '');
  return `${base}.md`;
}
