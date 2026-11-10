CREATE TABLE "heart_rate_daily" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"min_bpm" smallint,
	"avg_bpm" real,
	"max_bpm" smallint,
	"resting_bpm" smallint,
	"samples" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heart_rate_daily" ADD CONSTRAINT "heart_rate_daily_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "heart_rate_daily_person_id_date_index" ON "heart_rate_daily" USING btree ("person_id","date");