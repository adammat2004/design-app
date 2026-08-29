-- The postgis/postgis image enables this in the default database on first init, but the
-- migration declares it explicitly so the schema is reproducible on any Postgres instance.
-- drizzle-kit does not generate extension statements; keep this line on regeneration.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "garden_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'Untitled garden' NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
