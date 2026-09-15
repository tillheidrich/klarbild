// Task prompts for the image API. Guiding principle (01 §1): reproduce and extend,
// do not reinterpret. Leave colours, composition, textures and above all the
// lettering faithful.
//
// The prompt text stays in English on purpose: it is a functional instruction to
// the image model, not something a person reads, so it is not translated.

export type Task = 'clean' | 'cutout' | 'format' | 'contour' | 'deliver';

const CLEAN =
  'Recreate ONLY the actual artwork/motif as a clean, complete, high-resolution image. ' +
  'Remove everything around it that is not part of the motif: picture frames, walls, ' +
  'phone/app UI bars, shop overlays, cart icons, price tags, watermarks from your own ' +
  'screenshot, timestamps and reflections. Reconstruct edges that were cropped or hidden. ' +
  'Keep the original style, colors, textures, composition and ESPECIALLY any lettering ' +
  'pixel-faithful. Do not reinterpret, do not add new elements.';

const CUTOUT =
  'Isolate only the main subject. The background must be fully transparent (alpha).';

const FORMAT_EXTEND =
  'Extend the scene naturally to fill the requested aspect ratio (outpainting), keeping ' +
  'the existing composition centered and consistent in style.';

const FORMAT_KEEP_RATIO =
  'Produce the motif in the requested aspect ratio without distorting it.';

export interface PromptOpts {
  tasks: Task[];
  cropMode?: 'crop' | 'extend';
  customInstruction?: string | null;
}

/** Builds the combined prompt out of the preset recipe's tasks (in a fixed order). */
export function buildPrompt({ tasks, cropMode, customInstruction }: PromptOpts): string {
  const parts: string[] = [];
  if (tasks.includes('clean')) parts.push(CLEAN);
  if (tasks.includes('cutout')) parts.push(CUTOUT);
  if (tasks.includes('format')) {
    parts.push(cropMode === 'extend' ? FORMAT_EXTEND : FORMAT_KEEP_RATIO);
  }
  if (!tasks.includes('clean') && !tasks.includes('cutout') && parts.length === 0) {
    // format only, without cleaning up: just reproduce
    parts.push('Reproduce the image faithfully, no stylistic changes.');
  }
  if (customInstruction?.trim()) parts.push(`Additional instruction: ${customInstruction.trim()}`);
  parts.push('Output only the resulting image.');
  return parts.join(' ');
}

/** Combine/convert: one OR several reference images + a description → ONE new image.
 *  With one reference image = convert the image per the instruction (a photo → an oil painting, say).
 *  With several = the first one leads, the others supply elements/people/subjects. */
export function buildComposePrompt(description: string, extend = false, count = 2): string {
  const parts: string[] = [];
  if (count <= 1) {
    parts.push(
      'Transform the given image according to the instruction below into ONE new, ' +
      'high-resolution image. Keep the subject, composition and important details recognizable ' +
      'unless the instruction explicitly asks to change them.');
  } else {
    parts.push(
      'You are given several reference images. Combine them into ONE new, coherent, ' +
      'high-resolution image that follows the instruction below. Treat the first image as ' +
      'the main scene/style reference and use the other images as elements to integrate ' +
      '(people, pets, objects) — match their identity, colors and lighting faithfully so ' +
      'they look naturally part of the same photo.');
  }
  if (description.trim()) parts.push(`Instruction: ${description.trim()}`);
  if (extend) parts.push('Extend the scene naturally to fill the requested aspect ratio (outpainting).');
  parts.push('Output only the resulting image.');
  return parts.join(' ');
}

/** Free text: no reference image at all → a completely new image out of the description. */
export function buildGeneratePrompt(description: string): string {
  const d = description.trim() || 'A clean, high-quality image.';
  return `Create a new, high-resolution image. ${d} Output only the resulting image.`;
}
