import { GRADE_FILTER_ID, warmthMatrix } from '@/lib/materials/grade';

/**
 * The warm half of the scene grade, as an SVG filter the CSS `filter` list can reference.
 *
 * ## Why this exists
 *
 * Three of the grade's four terms are CSS shorthand — `brightness`, `contrast`, `saturate` — and
 * the fourth is a per-channel gain, for which CSS has no shorthand at all. The alternative was to
 * apply the warm term only in `applyGrade`, where real pixels are processed, and leave the live
 * view without it: a grade the screen has and the download does not is two different pictures of
 * one garden, and that exact symptom is already recorded twice in these notes as a bug.
 *
 * ## The two things that are load-bearing
 *
 * **`color-interpolation-filters="sRGB"`.** An SVG filter operates in *linearRGB* by default, so
 * the identical matrix gives visibly different pixels from the arithmetic in `grade.ts` unless it
 * is told otherwise. This is the whole trap: it fails by looking slightly wrong rather than by
 * failing.
 *
 * **One instance, rendered once.** A filter is referenced by id from anywhere in the document, so
 * this is mounted beside the view it grades rather than inside it — a filter inside the element it
 * filters would be filtered by itself.
 *
 * The matrix comes from `warmthMatrix()` rather than being written here, so the screen and the
 * export cannot hold two sets of numbers.
 */
export function GradeFilter() {
  return (
    <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
      <filter id={GRADE_FILTER_ID} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={warmthMatrix()} />
      </filter>
    </svg>
  );
}
