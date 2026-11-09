ALTER TABLE "foods" ADD COLUMN "food_group" text;--> statement-breakpoint
CREATE INDEX "foods_food_group_idx" ON "foods" USING btree ("food_group","popularity" DESC NULLS LAST);