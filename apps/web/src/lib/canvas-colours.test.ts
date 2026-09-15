import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOUR } from './canvas-colours';

/**
 * The canvas and the panel have to agree about what colour the designer is.
 *
 * They are on screen at the same time — a cursor moving over the plan, a stage strip beside it —
 * and the whole reason the AI has a colour of its own is so that "this is something else acting on
 * your garden" reads at a glance. Two indigos a shade apart reads as two different things, and
 * nothing else in the build would catch it: Konva takes a literal hex and Tailwind takes a token,
 * so the two values live in different files and neither imports the other.
 */
describe('the designer\'s colour', () => {
  it('is the same hex in the stylesheet and on the canvas', () => {
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
    const declared = /--color-garden-ai:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css);

    expect(declared, 'globals.css must declare --color-garden-ai').not.toBeNull();
    expect(declared![1]!.toLowerCase()).toBe(COLOUR.ai.toLowerCase());
  });
});
