/**
 * One function between the tool and whichever image model is in use.
 *
 * Everything the tool does — prompting, post-processing, the catalogue — is the same whatever
 * model draws the picture, so the model is the one thing behind an interface. Anthropic's API does
 * not generate images, which is why the default is not the SDK the rest of the repository uses.
 */
export interface ImageRequest {
  prompt: string;
  /** The size wanted. A provider may round to what its model accepts; the tool resizes after. */
  sizePx: { w: number; h: number };
  transparent: boolean;
}

export interface ImageProvider {
  name: string;
  /** PNG bytes. With alpha when `transparent` was asked for and the model can oblige. */
  generate(request: ImageRequest): Promise<Buffer>;
}
