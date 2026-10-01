CREATE TABLE "model_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"status" text NOT NULL,
	"reference_name" text,
	"reference_sha256" text NOT NULL,
	"ai_model" text NOT NULL,
	"meshy_task_id" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone,
	"result" jsonb,
	"published_asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_generation_jobs_live_spec_idx" ON "model_generation_jobs" USING btree ("spec_hash") WHERE status not in ('failed', 'rejected', 'cancelled', 'approved');--> statement-breakpoint
CREATE INDEX "model_generation_jobs_status_idx" ON "model_generation_jobs" USING btree ("status");