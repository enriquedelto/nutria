CREATE TABLE "skinfolds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"site" text NOT NULL,
	"mm" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skinfolds" ADD CONSTRAINT "skinfolds_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skinfolds_person_id_date_index" ON "skinfolds" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "skinfolds_day_site_uq" ON "skinfolds" USING btree ("person_id","date","site");