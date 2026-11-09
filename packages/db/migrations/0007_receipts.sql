CREATE TABLE "receipt_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"chain" text DEFAULT '' NOT NULL,
	"norm_text" text NOT NULL,
	"food_id" uuid NOT NULL,
	"uses" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"raw_text" text NOT NULL,
	"name" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'ud' NOT NULL,
	"unit_price" numeric(10, 2),
	"line_total" numeric(10, 2) NOT NULL,
	"discount" numeric(10, 2),
	"food_id" uuid,
	"match_confidence" real,
	"price_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text,
	"store_id" uuid,
	"purchased_on" date,
	"purchased_time" text,
	"total" numeric(10, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"share_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"ai_estimate_id" uuid,
	"shopping_list_id" uuid,
	"reading" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"open_prices" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prices" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "chain" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "osm_id" bigint;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "osm_type" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "lat" real;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "lon" real;--> statement-breakpoint
ALTER TABLE "receipt_aliases" ADD CONSTRAINT "receipt_aliases_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_aliases" ADD CONSTRAINT "receipt_aliases_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shopping_list_id_shopping_lists_id_fk" FOREIGN KEY ("shopping_list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_aliases_uq" ON "receipt_aliases" USING btree ("group_id","chain","norm_text");--> statement-breakpoint
CREATE INDEX "receipt_items_receipt_id_index" ON "receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_items_food_id_index" ON "receipt_items" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "receipts_group_id_purchased_on_index" ON "receipts" USING btree ("group_id","purchased_on");--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prices_receipt_id_index" ON "prices" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_osm_uq" ON "stores" USING btree ("osm_type","osm_id") WHERE "stores"."osm_id" is not null;