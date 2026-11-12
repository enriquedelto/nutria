DROP TABLE "nutrient_references" CASCADE;--> statement-breakpoint
DROP TABLE "fasting_protocols" CASCADE;--> statement-breakpoint
ALTER TABLE "store_accounts" DROP COLUMN "credentials_enc";--> statement-breakpoint
ALTER TABLE "store_accounts" DROP COLUMN "postal_code";