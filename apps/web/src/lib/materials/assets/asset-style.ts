/**
 * The Garden Studio visual asset specification, as the thing a model is given.
 *
 * Every asset in the library is generated from **one composed prompt**:
 *
 *     template  +  subject  +  variant clause  +  (tint clause)  +  (global exclusions)
 *
 * where the *template* carries everything that has to be identical across the library — the camera,
 * the light, the background, the framing, the colour treatment — and the *subject* is the one
 * sentence a family author actually writes ("a mature multi-stem silver birch"). `composePrompt` is
 * the only place the pieces meet, so a family cannot be sent a different camera by accident, and
 * `tools/assets` cannot drift from the app's own tests: both call this function.
 *
 * Versioned, because a picture is drawn to a specification and the specification moves. The
 * catalogue records `ASSET_SPEC_VERSION` beside every generated file, which is what lets an audit
 * say "this file predates the light being softened" rather than only "something about the prompt
 * changed". Bump it when a template's *meaning* changes — the camera, the light, the shadow policy —
 * not for a reworded subject, which `promptHash` already catches on its own.
 *
 * The human-readable contract is `docs/visualise-asset-style.md`. That document explains *why* the
 * rules are what they are and this file is the rules in the form a model reads; a test holds the
 * two to the same version so neither can move alone.
 *
 * Deliberately a leaf module: it imports nothing, so `tools/assets` can read it by relative path
 * exactly as it reads `asset-spec.ts` and `render/camera.ts`.
 */

export const ASSET_SPEC_VERSION = '2.0';

/* ---------------------------------------------------------------- what every sprite is told */

/**
 * Appended to every sprite prompt in both cameras, last, so it is the model's final instruction.
 *
 * The diptych clause is the lesson from `brief-art.ts`: asked for "the same garden at dusk" a model
 * returned a before-and-after, which was a perfectly reasonable reading and useless on a card with
 * one thing to say. Any phrase implying two states is licence to draw both, so every sprite prompt
 * refuses the comparison outright rather than trusting the subject sentence not to imply one.
 */
const EXCLUSIONS =
  'No text, no watermark, no logo, no people, no animals, no background scenery and no unrelated ' +
  'objects. A single object in one image — never a diptych, a split view, a before-and-after or ' +
  'a grid of variations.';

/**
 * What a plant sprite has to be, now that the palette reaches it.
 *
 * A material's tones only touch a photograph through a *proportional multiply* — `SPRITE_TINT` for
 * a plant, `MASS_TEXTURE_TINT` for an aggregate — so the sprite supplies the *form* and the palette
 * supplies the colour. That changes what to ask for: neutral and mid-toned (a strongly coloured
 * photograph fights the tint instead of taking it), evenly lit (a multiply darkens what is already
 * dark), and a clean alpha edge (a matte-white halo tints to a coloured halo).
 *
 * Appended by `composePrompt` to every recolourable plan sprite rather than written into each
 * subject, because furniture wants the opposite — it is never recoloured and should keep its own
 * real colour — and a rule applied by the composer cannot be forgotten by a family.
 */
const TINTABLE =
  'Neutral, mid-toned, desaturated foliage with even soft lighting and no deep shadows or bright ' +
  'highlights, so the plan can tint it. Clean cut-out edges with no white fringe.';

/* ---------------------------------------------------------------- the two cameras */

/**
 * The plan camera: 2D Plan, the concept cards and the PNG export.
 *
 * Strictly overhead and strictly flat, because the drawing has to read as a measurable footprint —
 * a sprite here *is* its footprint, and the placer, the validator and the schedule all assume the
 * picture covers exactly the circle or rectangle of record. Light is even and shadowless for the
 * reason `TINTABLE` gives, and because the plan's own contact shadow (`fx-soft-shadow`) and cast
 * shadow layer say where the shade falls; a shadow baked into the sprite would be a second sun.
 */
const PLAN_CAMERA =
  'Photorealistic architectural landscape visualisation render of a single object, seen from ' +
  'directly above: a true top-down orthographic plan view with no perspective, no tilt and no ' +
  'foreshortening, the kind of cut-out placed on a professional landscape plan. Soft, flat, even ' +
  'diffuse daylight with only gentle ambient shading, no distinct lit side, no cast shadow on the ' +
  'ground, no ground plane, no base and no reflection. The object isolated on a fully transparent ' +
  'background with clean anti-aliased cut-out edges and no white fringe or halo, centred and ' +
  'filling the frame with a narrow margin and nothing clipped at any edge. Natural slightly ' +
  'desaturated colour, neutral white balance, restrained contrast.';

/**
 * The elevated camera: Visualise.
 *
 * Four things in here are load-bearing and none of them is stylistic:
 *
 * - **"twelve degrees off vertical"** is `RISE` in `lib/render/camera.ts`. The renderer lifts a
 *   point `h × RISE` up the screen and extrudes the fence, the house and the shed by the same rule,
 *   so an asset drawn at a different angle stands at a different angle from the drawn things
 *   beside it. Nothing downstream can detect that; only the sheet shows it.
 * - **"orthographic"** keeps the footprint an unforeshortened plan. With perspective, a sprite's
 *   footprint is a trapezium that no rect can hold, and the placement routine has nothing to key on.
 * - **"No cast shadow on the ground"** is the hybrid: the renderer casts the shadow, because a baked
 *   one rotates with the object and is fixed at one hour. This is the single most important
 *   sentence in the prompt and the one a model is most likely to ignore, which is why the QA pass
 *   measures it.
 * - **"from the upper left"** is `LIGHT_DIRECTION`. Two suns in one drawing is the most obvious way
 *   a render gives itself away — and it is also why the self-shading is asked for *soft*: a located
 *   plan's sun moves through the day while the art's does not, and the less directional the baked
 *   light, the less the two can be seen to disagree. Version 2.0 asks for a gentle gradient rather
 *   than a lit side and a dark side for exactly that reason.
 *
 * On the wording: a model does not measure an angle, it matches a description to pictures it has
 * seen. "Twelve degrees" names a camera almost nothing is photographed from, so it gets rounded
 * towards the nearest familiar one — the three-quarter product shot. What works is naming the family
 * of view, stating the geometric consequence, bounding the thing that varies and ruling out the
 * attractors by name. The numeric angle stays because it is the one place a reader can check the
 * prompt against `RISE`.
 */
const ELEVATED_CAMERA =
  'Photorealistic architectural landscape visualisation render of a single object, seen from ' +
  'almost directly overhead — a near-nadir aerial view, only about twelve degrees off vertical. ' +
  'The top surfaces are seen in true plan: square on, their real shape, NOT foreshortened and NOT ' +
  'squashed. Only a narrow sliver of the front faces shows below the top, about a tenth of the ' +
  "object's height. This is NOT a three-quarter view, NOT an isometric view, NOT a product " +
  'photograph taken from the side, and NOT a perspective view: the camera is nearly straight down. ' +
  'Orthographic projection with parallel vertical edges and no perspective convergence. Soft hazy ' +
  'daylight from the upper left at about fifty-five degrees elevation: gentle low-contrast ' +
  'self-shading only, a soft gradient across the object rather than a distinct lit side and dark ' +
  'side, no hard-edged shadow anywhere, and plenty of ambient fill so every surface stays readable. ' +
  'No cast shadow on the ground, no ground plane, no base, no reflection. The object isolated on a ' +
  'fully transparent background with clean cut-out edges and no white fringe, centred left to ' +
  'right, its front facing the bottom of the frame, filling the frame with a narrow margin and ' +
  'nothing clipped or cropped at any edge. Natural slightly desaturated colour, neutral white ' +
  'balance, restrained contrast.';

/**
 * The sentences both cameras have to say, in the same words.
 *
 * Two cameras are two specifications, and they are allowed to differ in exactly one thing — the
 * angle and what follows from it. Everything else is the shared visual system, and a test holds each
 * preamble to every phrase here so a rewording of one camera cannot quietly leave the other behind.
 */
export const SHARED_RULES = [
  'Photorealistic architectural landscape visualisation render of a single object',
  'no cast shadow on the ground',
  'no ground plane',
  'no reflection',
  'fully transparent background',
  'no white fringe',
  'filling the frame with a narrow margin',
  'Natural slightly desaturated colour, neutral white balance, restrained contrast',
] as const;

/* ---------------------------------------------------------------- opaque materials */

/*
 * Faces, tiles and skins are opaque surfaces, and their contract is unchanged from version 1: they
 * are lit flat because the *renderer* lights them — a slab takes its bevel from the scene light, a
 * skin takes its brightness from the face's own normal — and light baked into the photograph would
 * be light applied twice. They take no exclusions clause and no tint clause; their prompts are
 * byte-identical to the ones their files were generated from, which is what lets the surface
 * library be kept rather than regenerated.
 */

const FACE =
  'Photorealistic close-up photograph of the surface, shot from directly above, filling the entire ' +
  'frame edge to edge with no border, no joints, no gaps and no neighbouring pieces visible. Flat, ' +
  'even, diffuse daylight, no shadows, no highlights, no vignetting, no perspective.';

const TILE =
  'Seamless tileable photorealistic texture, shot from directly above at a fixed distance, evenly ' +
  'lit by soft diffuse daylight with no shadows, no highlights, no vignetting and no perspective. ' +
  'The pattern repeats without any visible edge.';

/**
 * A material for a vertical face — the one elevated family that is lit *flat*, for the reason
 * above. A texture in every respect that matters; only what it is used for makes it "elevated".
 */
const SKIN = `${TILE} A material seen face-on, as it appears on a vertical surface.`;

/* ---------------------------------------------------------------- the templates */

/**
 * One template per *kind of subject*, each a camera plus the sentence that says how that kind of
 * thing is framed — where its trunk is, that its legs stand on the ground, that its rim shows.
 *
 * Explicit on every family rather than derived from its kind and taxon, because the derivation is
 * fragile: a planter and a fire pit are both `feature`, and a hedge crown is vegetation that wants
 * the plain sprite framing rather than the plant one. A key the author chooses is a fact; a rule
 * the author has to remember is a bug waiting.
 */
export const STYLE = {
  version: ASSET_SPEC_VERSION,
  exclusions: EXCLUSIONS,
  tintable: TINTABLE,
  camera: { plan: PLAN_CAMERA, elevated: ELEVATED_CAMERA },
  template: {
    /* opaque materials, plan camera */
    face: FACE,
    tile: TILE,
    /* opaque material, elevated camera */
    skin: SKIN,
    /* plan camera sprites */
    sprite: PLAN_CAMERA,
    plant: `${PLAN_CAMERA} A single plant, its foliage seen from above.`,
    /* elevated camera sprites */
    elevated: ELEVATED_CAMERA,
    'elevated-tree': `${ELEVATED_CAMERA} A single tree, its canopy seen from above and slightly in front so the foliage has real depth, layered branches reading through the crown, and a short length of trunk visible where the canopy is thinner.`,
    'elevated-shrub': `${ELEVATED_CAMERA} A single shrub, a rounded mass of foliage with visible depth, lit across the top and shading gently underneath so it reads as a body rather than a disc.`,
    'elevated-plant': `${ELEVATED_CAMERA} A single herbaceous plant, one clump standing up off the ground with its foliage seen from above and slightly in front, so the stems and the height of the clump are both visible.`,
    'elevated-furniture': `${ELEVATED_CAMERA} A single piece of outdoor garden furniture, its seat tops and frame seen from above and slightly in front, so the legs and the front edge are visible and the piece reads as standing on the ground.`,
    'elevated-planter': `${ELEVATED_CAMERA} A single garden container, its rim and planting seen from above and a little of its outer side visible below, so the container reads as having real height.`,
    /* drawn by the tool: no model, no camera, the subject is a description for the reader */
    procedural: '',
  },
} as const;

export type AssetTemplate = keyof typeof STYLE.template;

/** Which camera each template draws to, so a family's `template` and `camera` can be held to agree. */
export const TEMPLATE_CAMERA: Record<AssetTemplate, 'plan' | 'elevated'> = {
  face: 'plan',
  tile: 'plan',
  skin: 'elevated',
  sprite: 'plan',
  plant: 'plan',
  elevated: 'elevated',
  'elevated-tree': 'elevated',
  'elevated-shrub': 'elevated',
  'elevated-plant': 'elevated',
  'elevated-furniture': 'elevated',
  'elevated-planter': 'elevated',
  procedural: 'plan',
};

/**
 * The elevated preamble by name, because `elevated.test.ts` and the style doc both refer to it.
 * Same string as `STYLE.camera.elevated`.
 */
export const ELEVATED = ELEVATED_CAMERA;

/* ---------------------------------------------------------------- composition */

/**
 * What `composePrompt` needs to know about a family. Structural rather than `AssetFamily` so this
 * module imports nothing and `asset-spec.ts` can import the template type from it without a cycle.
 */
export interface PromptSource {
  template: AssetTemplate;
  subject: string;
  /** One phrase per variant, when the variants are different things rather than different draws. */
  variantSubjects?: readonly string[];
  variants: number;
  kind: 'texture' | 'face' | 'sprite';
  camera?: 'plan' | 'elevated';
  recolourable?: boolean;
}

/**
 * The prompt one variant of a family is sent.
 *
 *     template  subject  [Specifically: <variant>.] | [Variant n of m, …]  [tint]  [exclusions]
 *
 * - `variantSubjects` names what each variant *is* — a species, a finish — and the nth is appended
 *   as "Specifically: …". Without it, a multi-variant family is asked to differ in arrangement and
 *   detail, which is enough for a paving slab and not enough for a shrub; the plant families all
 *   name theirs. The old regex that read the list out of prose silently fell through for fifteen
 *   families and sent every variant the same sentence, which is why the list is a field now.
 * - The tint clause goes on every recolourable plan sprite, by rule rather than by memory.
 * - The exclusions go on every sprite in either camera. Opaque materials take neither clause, so
 *   their prompts are exactly what their files were generated from.
 */
export function composePrompt(family: PromptSource, variant: number): string {
  const template = STYLE.template[family.template];
  if (family.template === 'procedural') return family.subject;

  const named = family.variantSubjects?.[variant - 1];
  const variantClause = named
    ? ` Specifically: ${named}.`
    : family.variants > 1
      ? ` Variant ${variant} of ${family.variants}, differing in arrangement and detail from the others.`
      : '';

  if (family.kind !== 'sprite') return `${template} ${family.subject}${variantClause}`;

  const tint =
    family.recolourable && (family.camera ?? 'plan') === 'plan' ? ` ${STYLE.tintable}` : '';

  return `${template} ${family.subject}${variantClause}${tint} ${STYLE.exclusions}`;
}
