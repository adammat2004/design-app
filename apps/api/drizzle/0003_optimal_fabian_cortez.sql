CREATE TABLE "design_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_events" ADD CONSTRAINT "design_events_plan_project_id_plan_projects_id_fk" FOREIGN KEY ("plan_project_id") REFERENCES "public"."plan_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_events_plan_idx" ON "design_events" USING btree ("plan_project_id","created_at");--> statement-breakpoint
CREATE INDEX "design_events_kind_idx" ON "design_events" USING btree ("kind");