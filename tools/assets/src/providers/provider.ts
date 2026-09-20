/**
 * One function behind which an image model sits.
 *
 * The tool asks for a picture of a given size with or without a transparent background, and gets
 * the bytes back with what was actually requested — so the catalogue can record the true request
 * rather than the family's nominal size, which a model may not accept verbatim.
 */

/** The cost lever. Which tiers a model accepts is the provider's business. */
export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ImageRequest {
  prompt: string;
  /** The output size the family wants. The provider asks for something at least this big. */
  sizePx: { w: number; h: number };
  transparent: boolean;
}

export interface GeneratedImage {
  png: Buffer;
  /** The size the model was actually asked for, which the catalogue records. */
  requestedSize: { w: number; h: number };
}

export interface ImageProvider {
  /** For the log line: model and quality in one string. */
  name: string;
  model: string;
  quality: ImageQuality;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}
