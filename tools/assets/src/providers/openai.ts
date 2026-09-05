import type { ImageProvider, ImageRequest } from './provider.js';

/**
 * OpenAI's image model, over plain `fetch`.
 *
 * No SDK: the endpoint is one JSON POST, and pulling a client library into a tool that runs a few
 * times a year would be the SDK-shaped trap for no gain. `gpt-image-1` is the model that can return
 * a genuinely transparent background, which is the whole reason it is the default.
 */

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const MODEL = 'gpt-image-2';

/** The sizes the model accepts. A request is snapped to the nearest aspect. */
const SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;

function sizeFor(request: ImageRequest): (typeof SIZES)[number] {
  const aspect = request.sizePx.w / request.sizePx.h;
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 0.83) return '1024x1536';
  return '1024x1024';
}

export function openAiProvider(apiKey: string, quality: 'low' | 'medium' | 'high'): ImageProvider {
  return {
    name: `${MODEL} (${quality})`,
    async generate(request) {
      const body = {
        model: MODEL,
        prompt: request.prompt,
        n: 1,
        size: sizeFor(request),
        quality,
        output_format: 'png',
        ...(request.transparent ? { background: 'transparent' } : {}),
      };

      /*
       * Rate limits are the ordinary failure here — a whole run is eighty pictures and the
       * images-per-minute allowance is small — so a 429 or a 5xx is waited out and retried, honouring
       * `Retry-After` when the server names a wait and backing off geometrically when it does not.
       * Anything else is a real error and is thrown at once.
       */
      for (let attempt = 1; ; attempt += 1) {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const json = (await response.json()) as { data?: { b64_json?: string }[] };
          const b64 = json.data?.[0]?.b64_json;
          if (!b64) throw new Error('OpenAI returned no image data');
          return Buffer.from(b64, 'base64');
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
