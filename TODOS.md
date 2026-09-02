# TODOS

Deferred work, with enough context to pick it up cold. The setup script reads the first
few unchecked boxes and prints them, so keep the most relevant item near the top.

Full decision record for the current scope:
`~/.gstack/projects/adammat2004-design-app/ceo-plans/2026-08-30-plan-realism.md`
Implementation plan: `~/.claude/plans/can-you-look-at-peaceful-lemon.md`

---

## In flight — plan realism

- [x] **Phase 0 — foundations.** Green build and test, one-command `script/setup`, CI, TODOS.
- [x] **Phase 1 — schema and refactor.** Height manifest, `site.location`, `site.sun`,
      `DrawPass`/`RenderPass`. Proved byte-identical against the previous render.
- [x] **Phase 2 — render.** Sun model (suncalc), shadow layer, planting `form` axis, LOD policy,
      cut edges, water, one light everywhere, dev HUD, `before/` history, three diagrams.
- [ ] **Phase 3 — deliverable.** In progress. - [x] T18 error boundaries; API-down told apart from 404 (verified in the browser) - [x] T22 label truncation - [x] T17 project list, landing copy corrected, e2e flow added - [ ] T14 plan view with labels, legend and a quantity schedule - [ ] T15 print at true scale, chunked with progress - [ ] T21 correct the stale CLAUDE.md claims and record the decisions

- [x] **Nobody has clicked any of this.** Done: the app was driven with Playwright. Shadows
      appear once a location is set, the time slider moves them correctly, the sun panel is
      reachable from step 1, a missing plan and a stopped API now show different screens, and a
      saved plan can be found again from the front door. No page or console errors.

- [ ] **`next dev` rewrites `apps/web/AGENTS.md` on every run.** It is a generated file that keeps
      reappearing as an uncommitted change. Its warning is real and was worth heeding — following
      it caught `reset` vs `retry` in the error boundaries — so commit it rather than fight it.
      **Effort:** trivial.

---

## Findings worth acting on

- [ ] **T9 is smaller than estimated — it needs a `form` axis, not a new symbol layer.**
      **Why:** looking at `.material-preview/08-materials-close.png` shows the blob renderer
      already does the hard part — irregular lobed outlines, per-unit tone, a highlight scaled
      from the unit's own outline, size range, overlap. What is missing is that every planting
      material uses the _same round blob_ and differs only in size, density and hue. That is
      why `ornamental-grasses` reads as pale cauliflower and `hedging` reads as loose blobs
      rather than a clipped mass.
      **Shape:** add `form` to the scatter pattern in `material-patterns.ts`. `blob` is the
      current behaviour (shrubs, ground-cover). Two genuinely new forms are needed:
      `tufted` (radiating linear strokes — grasses) and `clipped-mass` (continuous body with a
      defined edge — hedging). `wildflower` and `mixed-border` already work because colour
      variation substitutes for form.
      **Effort:** revises T9 down from 3-4 weeks. Re-estimate once `tufted` is prototyped.
      **Blocked by:** Phase 1 (`RenderContext`).

- [ ] **The whole-plan preview (T19) should render a shadow-hours sheet.**
      **Why:** a throwaway script that drew the same plot at 09:00, 12:00, 16:00 and 19:00 was
      how the shadow layer got verified, and it was far more informative than any single frame —
      the noon ratio of 0.58 visibly matches `1/tan(60 degrees)`, and the 19:00 frame is the one
      that shows the house throwing a diagonal across the garden. Four frames across a day should
      be a permanent case in the preview script, not something rebuilt each time.
      **Blocked by:** nothing. Small once T19's whole-plan rendering exists.

- [ ] **A blob's shading threshold compares a radius against a full-dimension constant.**
      **Why:** `drawBlob` skips its highlight when `radius < MIN_SHADED_PX` (12), where the module
      path compares the module's full width against the same 12. So a blob 16 px across goes
      unshaded while a slab 16 px across is lit. Probably over-conservative for planting.
      **Not changed** when the LOD policy was unified, deliberately: that refactor's gate was that
      it altered no pixels, and it was proved byte-identical against the previous run. Correcting
      it is a tuning decision to make on its own, with the contact sheet open.
      **Effort:** S.

- [ ] **The API test suite truncates the dev database.**
      **Why:** `apps/api/src/test/db.ts` runs `truncate table plan_projects`, against the same
      Postgres `pnpm dev` uses. So `pnpm test` silently deletes every plan you were looking at,
      which cost time twice while verifying the review screen. Not wrong — the tests need a clean
      table — but it should either use a separate database or say so in the README.
      **Effort:** S.

- [ ] **The schedule cannot give net areas, only drawn ones.**
      **Why:** ground cover is the full zone with everything laid over it, so the table groups by
      layer and says the groups overlap rather than pretending to a net figure. The exact remainder
      IS computable — `FillService.accentRegions` already does it server-side with PostGIS — but
      deriving it on the client from element areas would lean on the generator's disjointness
      guarantees, which the editor breaks the moment someone drags one bed over another.
      **Fix when:** the print sheet needs orderable quantities. Compute it on the server.
      **Effort:** M.

- [ ] **`shrubs` density leaves too much soil showing at plan scale.**
      **Why:** `{density: 2.4, sizeRange: 700-1250mm}` reads as sparse blobs on brown at the
      zoom the plan is actually judged at. `material-patterns.ts` documents the rule that
      `density x mean unit area` must stay appreciably above 1 so units overlap — worth
      re-checking that arithmetic for shrubs specifically against the contact sheet.
      **Effort:** S. Tune and look, no new code.

---

## Deferred from the CEO review

- [ ] **Sun-aware generation.** Once `site.location` and the height manifest land, the PostGIS
      placer could put seating in afternoon sun and shade-tolerant planting in the house's
      shadow, and defend both. This is the real research contribution and it is deliberately
      out of scope for the current pass.
      **Blocked by:** Phase 1 (heights + location must be in `packages/schema`, which they are
      being put in specifically so the server can read them).

- [ ] **Evaluation harness.** Benchmark over the generator: constraint satisfaction rate,
      requested-feature inclusion rate, determinism, latency by plot scale. The codebase is
      unusually ready for this — generation is seeded and `geometryIsLegal` is a ready-made
      oracle. **This is the biggest remaining risk to the mark** and nothing else in the plan
      addresses it. **Priority: P1 once Phase 2 lands.**

- [ ] **Maturity toggle (year 1 vs year 5)**, NOT a seasonal toggle. A density-and-size scalar
      over the planting forms. Answers "how long until it looks like this", which is the second
      question every real client asks after cost. The seasonal framing was rejected: it
      multiplies palette work by four, entangles with the sun model, and makes a horticultural
      claim the catalogue cannot support (it holds `mixed-border`, not species names).
      **Effort:** ~3 days once forms exist.

- [ ] **3D preview.** `three`, `@react-three/fiber` and `@react-three/drei` are installed and
      entirely unused. The height manifest from Phase 1 is exactly what R3F would need.
      Either build it or drop the dependencies — carrying an unused 3D stack is bundle weight
      and a question a marker will ask.

- [ ] **Verify the live Anthropic call.** `ANTHROPIC_API_KEY` is now present in `apps/api/.env`
      and the path has never been exercised — every assistant test mocks the SDK. Check
      `usage.cache_read_input_tokens` on the first real call before claiming the caching win.
      Note `CLAUDE.md` still says there is no key; correct that at the same time.

- [ ] **Mobile / responsive.** Not mentioned anywhere in the codebase or any review. A garden
      plan on a phone is a real question (pinch-zoom on Konva, panels that do not fit).

---

## Smaller

- [ ] `.vscode/extensions.json` recommending Prettier and ESLint. `.gitignore` already writes
      `!.vscode/extensions.json`, so the intent was recorded and never acted on.
- [ ] Sub-headings and a generated table of contents for `CLAUDE.md`'s "Decisions worth
      knowing" — 490 unindexed lines carrying most of the document's value.
- [ ] Correct three stale `CLAUDE.md` claims: the API key IS present; `node` IS on the Bash
      tool's PATH (v24.20.0 — the PowerShell warning applies to `pnpm install` postinstall
      steps, not to running scripts); the landing page copy contradicts the README on
      persistence.

---

## Decided against — do not revisit without new information

- **Devcontainer.** Would permanently kill toolchain drift, judged heavier than the problem.
- **Full Renovate / Dependabot version PRs.** Security advisories only. Revisit once CI is
  green and the 963 tests actually gate upgrades.
- **CONTRIBUTING.md, issue templates, examples/.** No contributor audience exists.
- **Material-pair edge table.** 784 combinations that cannot be tuned or tested. Edges are
  keyed on the 7-category pair instead.
- **Server-side PDF rendering.** Would add an unauthenticated endpoint spawning a headless
  browser on an API that has no auth and must stay on localhost.
- **Costing in currency.** `Material.cost` is a relative 1-4. Quantities are defensible,
  prices are not.
