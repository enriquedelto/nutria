-- Keep only the latest measurement per person, day and site before making it unique.
DELETE FROM "body_measurements" a USING "body_measurements" b
WHERE a.person_id = b.person_id AND a.date = b.date AND a.site = b.site
  AND (a.created_at, a.id) < (b.created_at, b.id);--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_day_site_uq" ON "body_measurements" USING btree ("person_id","date","site");
