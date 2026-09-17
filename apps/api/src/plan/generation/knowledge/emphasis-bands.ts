import type { BriefEmphasis } from '@garden-studio/schema';
import { COMPOSITION_BANDS, type Band, type CompositionBands } from '../composition-rules.js';

/**
 * What *this* concept's shares should be, inside what any garden's should be.
 *
 * `COMPOSITION_BANDS` comes from a hand-traced professional plan and is deliberately wide: it has to
 * pass a naturalistic garden that is half lawn and a small modern one that is two thirds paving,
 * because both are good gardens. That width is exactly why it cannot tell the three concepts apart —
 * a plan built round one generous lawn and a plan built round eating outside both sit comfortably
 * inside it, and the scorer has nothing to say about which is which.
 *
 * So each emphasis **narrows** the traced band rather than replacing it. Two rules hold:
 *
 * - **Never wider.** The traced plan is the one piece of this system calibrated against a real
 *   design, and an emphasis that widened a band would be using the brief to excuse a proportion no
 *   garden should have. Every bound here is clamped back inside the band it narrows.
 * - **The fault is a different code.** Outside the traced band is `hard-excessive` or
 *   `leftover-pocket`: this plan is out of proportion for any garden. Inside the traced band and
 *   outside the emphasis's is `composition-off-brief`: it is the wrong proportion for *this* one.
 *   A difference of intention reported as a defect is the thing this file must not do.
 */

type Narrowing = Partial<Record<keyof CompositionBands['garden'], Partial<Band>>>;

const NARROWING: Record<BriefEmphasis, Narrowing> = {
  /* Built round eating outside: there has to be real paved room to put a table and people on. */
  social: { hard: { min: 0.3 } },
  /*
   * Built round one open panel, so there has to be grass. Just under the traced plan's own 0.21, and
   * that ceiling on the claim is the point: a narrowing that asked for *more* lawn than the
   * professional design has would be using the brief to argue with the one plan this system is
   * calibrated against.
   */
  open: { lawn: { min: 0.2 } },
  /* Built round deep planting: a quarter of the ground at least. */
  planted: { planting: { min: 0.25 } },
  /* A working garden earns its ground: little of it should be left showing through. */
  productive: { planting: { min: 0.2 }, undesigned: { max: 0.2 } },
};

/**
 * The bands this concept is judged against, and the wider ones every garden is.
 *
 * Both are returned because the two produce different faults. A courtyard takes the courtyard set
 * untouched: the narrowings are all claims about how a garden divides its open ground, and a plan
 * with no open ground has not made that decision.
 */
export function bandsFor(
  emphasis: BriefEmphasis,
  courtyard: boolean,
  bands: CompositionBands = COMPOSITION_BANDS,
): { traced: CompositionBands['garden']; brief: CompositionBands['garden'] } {
  const traced = courtyard ? bands.courtyard : bands.garden;
  if (courtyard) return { traced, brief: traced };

  const narrowing = NARROWING[emphasis];
  const brief = { ...traced };
  for (const key of Object.keys(brief) as (keyof typeof brief)[]) {
    brief[key] = narrow(traced[key], narrowing[key]);
  }
  return { traced, brief };
}

/** A band tightened by a narrowing, and never loosened past what it started as. */
function narrow(band: Band, by: Partial<Band> | undefined): Band {
  if (!by) return band;
  const min = Math.max(band.min, by.min ?? band.min);
  const max = Math.min(band.max, by.max ?? band.max);
  /* A narrowing that crossed over would say a share must be both above and below the same number. */
  return min <= max ? { min, max } : band;
}
