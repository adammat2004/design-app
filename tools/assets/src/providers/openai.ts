import type { GeneratedImage, ImageProvider, ImageQuality, ImageRequest } from './provider.js';

/**
 * OpenAI's image models, over plain `fetch`.
 *
 * No SDK: the endpoint is one JSON POST, and pulling a client library into a tool that runs a few
 * times a year would be the SDK-shaped trap for no gain.
 *
 * **The model is configuration, not a constant.** It used to be a module-level `MODEL`, which meant
 * regenerating one family on a newer model was a source edit — and the docstring beside it went on
 * naming a model two generations older than the one in the constant. `resolveModel` reads the flag,
 * then the environment, then the default, and whichever it chose is written into the catalogue
 * beside every file it made.
 *
 * The default is a **dated snapshot** so a regeneration a year from now asks the same model, not
 * whatever the alias has moved to. Sunburst rather than Flare: both cost the same per token, Flare
 * is faster, Sunburst holds fine detail better, and a library generated a few times a year is
 * judged on its foliage rather than on its latency.
 */
export const DEFAULT_MODEL = 'gpt-image-2.5-sunburst-2026-09-08';
export const MODEL_ENV = 'ASSET_IMAGE_MODEL';

export function resolveModel(flag: string | null): string {
  return flag ?? process.env[MODEL_ENV] ?? DEFAULT_MODEL;
}

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

/** The tiers each generation of model accepts. Anything else is refused before a request is sent. */
export function qualitiesFor(model: string): readonly ImageQuality[] {
  if (/^gpt-image-2\.5/.test(model)) return ['low', 'medium', 'high', 'xhigh', 'max'];
  return ['low', 'medium', 'high'];
}

/** The three sizes the first-generation model accepts. A request is snapped to the nearest aspect. */
const PRESET_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;

function presetFor(sizePx: { w: number; h: number }): { w: number; h: number } {
  const aspect = sizePx.w / sizePx.h;
  const preset = aspect > 1.2 ? '1536x1024' : aspect < 0.83 ? '1024x1536' : '1024x1024';
  const [w, h] = (preset as (typeof PRESET_SIZES)[number]).split('x').map(Number);
  return { w: w!, h: h! };
}

/**
 * The size to ask a model that accepts arbitrary dimensions for.
 *
 * `gpt-image-2` and later take any `WIDTHxHEIGHT` with both sides a multiple of 16 and the aspect
 * within 3:1, so the frame is requested at its own aspect rather than snapped to a preset and
 * padded — which is what an elevated sprite's bottom-aligned framing was always asking for. The
 * family's `sizePx` is the *output*; the model is asked for the same aspect with the long edge
 * between 1024 and 2048 px, and the post-processing downsamples.
 */
export function customSizeFor(sizePx: { w: number; h: number }): { w: number; h: number } {
  const long = Math.max(sizePx.w, sizePx.h);
  let scale = Math.min(2048 / long, Math.max(1, 1024 / long));
  /*
   * The model also has a *minimum pixel budget*: a 512×1024 request — a lounger at the long edge
   * the rule above gives it — comes back `400 Requested resolution is below the current minimum
   * pixel budget`, and so did every narrow furniture and fitting family on the first full run. A
   * megapixel is the floor a square request has always cleared, so anything under it is scaled up
   * at its own aspect until it clears too.
   */
  if (sizePx.w * sizePx.h * scale * scale < MIN_PIXELS) {
    scale = Math.sqrt(MIN_PIXELS / (sizePx.w * sizePx.h));
  }
  const ceil16 = (value: number) => Math.max(16, Math.ceil(value / 16) * 16);
  let w = ceil16(sizePx.w * scale);
  let h = ceil16(sizePx.h * scale);
  if (w / h > 3) h = ceil16(w / 3);
  if (h / w > 3) w = ceil16(h / 3);
  return { w, h };
}

const MIN_PIXELS = 1024 * 1024;

/** A request that has not answered in this long is retried; the first full run hung for minutes on each dropped connection. */
const REQUEST_TIMEOUT_MS = 180_000;

function acceptsCustomSizes(model: string): boolean {
  return /^gpt-image-2/.test(model);
}

export function openAiProvider(
  apiKey: string,
  options: { model: string; quality: ImageQuality },
): ImageProvider {
  const { model, quality } = options;
  if (!qualitiesFor(model).includes(quality)) {
    throw new Error(
      `${model} does not accept --quality ${quality}; use ${qualitiesFor(model).join(', ')}`,
    );
  }

  return {
    name: `${model} (${quality})`,
    model,
    quality,
    async generate(request: ImageRequest): Promise<GeneratedImage> {
      const requestedSize = acceptsCustomSizes(model)
        ? customSizeFor(request.sizePx)
        : presetFor(request.sizePx);

      const body = {
        model,
        prompt: request.prompt,
        n: 1,
        size: `${requestedSize.w}x${requestedSize.h}`,
        quality,
        output_format: 'png',
        ...(request.transparent ? { background: 'transparent' } : {}),
      };

      /*
       * Rate limits are the ordinary failure here — a whole run is hundreds of pictures and the
       * images-per-minute allowance is small — so a 429 or a 5xx is waited out and retried, honouring
       * `Retry-After` when the server names a wait and backing off geometrically when it does not.
       * Anything else is a real error and is thrown at once.
       */
      for (let attempt = 1; ; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (error) {
          /*
           * A dropped connection or a timed-out request is as ordinary as a 429 on a run that
           * lasts hours, and the first full run lost forty pictures to `fetch failed` because it
           * was thrown straight through. Retried with the same backoff; only exhaustion throws.
           */
          if (attempt >= MAX_ATTEMPTS) {
            throw new Error(
              `OpenAI unreachable after ${attempt} attempts: ${error instanceof Error ? error.message : error}`,
            );
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(60_000, 4_000 * 2 ** (attempt - 1))),
          );
          continue;
        }

        if (response.ok) {
          const json = (await response.json()) as { data?: { b64_json?: string }[] };
          const b64 = json.data?.[0]?.b64_json;
          if (!b64) throw new Error('OpenAI returned no image data');
          return { png: Buffer.from(b64, 'base64'), requestedSize };
        }

        const text = await response.text();
        const retryable = response.status === 429 || response.status >= 500;

        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(`OpenAI ${response.status}: ${text.slice(0, 300)}`);
        }

        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(60_000, 4_000 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    },
  };
}

const MAX_ATTEMPTS = 6;
