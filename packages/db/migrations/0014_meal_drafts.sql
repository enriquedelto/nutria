CREATE TABLE "meal_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"meal_slot" text,
	"started_at" timestamp with time zone NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_drafts_status_ck" CHECK ("meal_drafts"."status" in ('open', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "meal_drafts" ADD CONSTRAINT "meal_drafts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_drafts" ADD CONSTRAINT "meal_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_drafts_person_id_status_index" ON "meal_drafts" USING btree ("person_id","status");