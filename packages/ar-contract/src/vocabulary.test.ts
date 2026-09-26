import { SYMBOLS, SymbolIdSchema, type SymbolId } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ModelKeySchema } from './vocabulary.js';

/**
 * The contract keeps its own copy of the product symbols so the phone never imports the schema.
 * This is the check that the copy has not drifted. `@garden-studio/schema` is a dev dependency
 * only — it is here for this test and never reaches the runtime package.
 */
describe('ModelKey', () => {
  it('names only symbols the plan knows', () => {
    const symbols = new Set<string>(SymbolIdSchema.options);
    for (const key of ModelKeySchema.options) expect(symbols.has(key), key).toBe(true);
  });

  it('covers every product symbol and none of the structures', () => {
    // Structures are whatever rectangle the placer gave them, so they are `solid`s built from
    // their outline — never a model stretched into a rectangle.
    const structures = new Set<SymbolId>([
      'steps',
      'pergola',
      'shed',
      'gazebo',
      'raised-bed',
      'garden-room',
      'greenhouse',
    ]);
    const products = SymbolIdSchema.options.filter((id) => !structures.has(id));
    expect([...ModelKeySchema.options].sort()).toEqual([...products].sort());
    for (const id of structures) expect(SYMBOLS[id].category).toBe('structure');
  });
});
