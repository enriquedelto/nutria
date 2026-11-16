CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kcal_before" integer,
	"kcal_delta" integer DEFAULT 0 NOT NULL,
	"kcal_after" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_person_id_week_start_index" ON "checkins" USING btree ("person_id","week_start");