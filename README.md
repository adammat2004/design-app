# Garden Studio

An AI-assisted residential garden design tool. A homeowner describes their garden — its
shape, the house edge, and what is already there — and the system generates structured,
spatially valid layouts. Layouts are real geometry (polygons for zones, positioned objects),
never AI-generated images, so areas, quantities and costs can be derived from them.

The structured data is always the source of truth; any 2D plan or 3D preview is rendered
from it, never the other way around.

> **Status:** the six-step plan wizard works end to end — draw the plot, record what is already
> there, fill in a brief, generate concepts, edit one on the canvas or by asking for a change in
> plain English, and it is all still there tomorrow. Costing and the 3D preview are not built yet.

## Stack

| Area     | Choice                                                     |
| -------- | ---------------------------------------------------------- |
| Monorepo | pnpm workspaces                                            |
| Backend  | NestJS, Drizzle ORM, PostgreSQL + PostGIS                  |
| Frontend | Next.js (App Router), TypeScript, Tailwind v4, React-Konva |
| 3D       | React Three Fiber (installed, not used yet)                |
| State    | Zustand                                                    |
| Shared   | Zod schemas in `packages/schema`, imported by both apps    |
| AI       | Anthropic SDK (`claude-opus-5`), structured outputs        |
| Testing  | Vitest (unit), Playwright (e2e)                            |

```
apps/web          Next.js frontend — the plan editor
apps/api          NestJS backend — persistence and spatial validation
packages/schema   Zod schemas + geometry helpers shared by both
```

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (for PostgreSQL + PostGIS)

## Running it locally

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL + PostGIS
docker compose up -d

# 3. Configure the API (optionally add an ANTHROPIC_API_KEY — see "The design assistant")
cp apps/api/.env.example apps/api/.env

# 4. Build the shared schema package (both apps import its compiled output)
pnpm --filter @garden-studio/schema build

# 5. Create the database tables
pnpm --filter @garden-studio/api db:migrate

# 6. Start both dev servers
pnpm dev
```

- Frontend: http://localhost:3000
- API: http://localhost:3001
- Health check: http://localhost:3001/health (confirms the PostGIS connection)

The frontend reads `NEXT_PUBLIC_API_URL` from `apps/web/.env.local`; a copy is committed as
`apps/web/.env.example`.

## Scripts

Run from the repository root:

| Script              | Does                                      |
| ------------------- | ----------------------------------------- |
| `pnpm dev`          | Runs the API and web dev servers together |
| `pnpm build`        | Builds schema, API, then web              |
| `pnpm test`         | Runs every package's unit tests           |
| `pnpm lint`         | ESLint across all packages                |
| `pnpm format`       | Prettier write                            |
| `pnpm format:check` | Prettier check                            |

Per package:

| Script                                         | Does                            |
| ---------------------------------------------- | ------------------------------- |
| `pnpm --filter @garden-studio/schema dev`      | Rebuilds shared types on change |
| `pnpm --filter @garden-studio/api db:generate` | Generates a Drizzle migration   |
| `pnpm --filter @garden-studio/api db:migrate`  | Applies migrations              |
| `pnpm --filter @garden-studio/api db:studio`   | Drizzle Studio                  |
| `pnpm --filter @garden-studio/web test:e2e`    | Playwright end-to-end tests     |

## Testing

```bash
pnpm test                                    # unit tests
pnpm --filter @garden-studio/web test:e2e    # end-to-end
```

**The API tests need the database running.** `GeometryValidationService` is almost entirely
SQL, so its tests run against real PostGIS rather than a mock — a mock would assert on fake
rows and prove nothing about whether the geometry checks are correct. Start the database
with `docker compose up -d` first; without it those tests skip with an explanatory message
rather than failing confusingly.

The Playwright tests need the database, the API, and the web app all running.

## How validation works

Every plan is checked against hard spatial constraints:

- the boundary must be a valid, non-self-intersecting polygon
- the house footprint and every feature must sit fully inside the boundary
- no feature may share interior space with the house or with another feature
- generated and edited layout elements must stay inside the boundary and off the house

These are checked by PostGIS (`ST_IsValid`, `ST_Contains`, `ST_Intersects`/`ST_Touches`), not by
hand-written polygon maths. Validation builds its geometries inline from the submitted payload, so
it needs no stored rows and has no side effects — the same service backs
`POST /plan-projects/validate`.

Because the wizard autosaves, an invalid draft is **stored and reported**, not rejected: a section
patch returns `200` with a `violations` list, and Continue is what the violations block. Concept
generation is the exception — it returns **422** on an invalid plan, because the generator has to
be able to trust its input.

## The design assistant

Step 5 takes a sentence ("make the seating area bigger and use gravel instead of paving") and
returns a diff you review line by line before applying.

It is deliberately split in two. Claude turns the sentence into **structured intent** — resize by a
factor, move towards the house, use this material, add something of this size in this zone — and a
deterministic planner turns intent into geometry using the same PostGIS placer and the same
legality checks as the concept generator. The intent type has no field that can hold a coordinate,
so the model cannot position anything; and when something genuinely will not fit, the planner says
so in its own words rather than inventing a position.

**It is optional.** With no `ANTHROPIC_API_KEY` set, the endpoint returns 503 and the chat panel
says the assistant is unavailable; every other part of the app, and the whole test suite, works
unchanged. The API has no authentication, so keep it on localhost — a reachable deployment would
expose the key's spend. Requests are rate-limited regardless (20/min overall, 6/min per plan).

## API

| Method | Path                                                                | Purpose                            |
| ------ | ------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/health`                                                           | Liveness plus PostGIS version      |
| POST   | `/plan-projects`                                                    | Create a plan                      |
| GET    | `/plan-projects`                                                    | List plans, newest first           |
| GET    | `/plan-projects/:id`                                                | Fetch a plan                       |
| PATCH  | `/plan-projects/:id`                                                | Rename                             |
| PATCH  | `/plan-projects/:id/{site,features,brief,layout,concept-selection}` | Write one section                  |
| POST   | `/plan-projects/:id/concepts/generate`                              | Generate concepts (422 if invalid) |
| POST   | `/plan-projects/:id/assistant/messages`                             | Ask for a change, get a diff       |
| POST   | `/plan-projects/validate`                                           | Validate without saving            |

Every write carries the `revision` it was based on and gets a `409` if the plan moved on
underneath it.
