CREATE TYPE "public"."access_role" AS ENUM('owner', 'manager', 'viewer', 'professional');--> statement-breakpoint
CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('lose', 'maintain', 'gain');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TYPE "public"."food_kind" AS ENUM('food', 'drink', 'supplement', 'alcohol');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('off', 'ciqual', 'usda', 'custom', 'ai', 'recipe', 'store');--> statement-breakpoint
CREATE TYPE "public"."nutrient_category" AS ENUM('energy', 'macro', 'carb_detail', 'fat_detail', 'vitamin', 'mineral', 'other');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	"role" text DEFAULT 'member' NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"person_id" uuid,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"ip" text,
	"request_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"preferences_md" text DEFAULT '' NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid,
	"provider" text NOT NULL,
	"base_url" text,
	"credentials_enc" text,
	"webhook_secret_enc" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"group_id" uuid,
	"group_role" "group_role" DEFAULT 'member' NOT NULL,
	"person_id" uuid,
	"access_role" "access_role",
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "access_role" NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid,
	"user_id" text,
	"display_name" text NOT NULL,
	"avatar_color" text DEFAULT '#22c55e' NOT NULL,
	"sex" "sex",
	"birth_date" date,
	"height_cm" real,
	"activity_level" "activity_level" DEFAULT 'light' NOT NULL,
	"goal_type" "goal_type" DEFAULT 'maintain' NOT NULL,
	"weekly_rate_kg" real DEFAULT 0 NOT NULL,
	"pregnancy" text,
	"diet_pattern" text,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"dislikes" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferences_md" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_child" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_height_ck" CHECK ("persons"."height_cm" is null or ("persons"."height_cm" > 30 and "persons"."height_cm" < 260))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" integer,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "additives" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"function" text,
	"risk" text,
	"description_es" text
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal_slot" text NOT NULL,
	"eaten_at" timestamp with time zone,
	"food_id" uuid,
	"recipe_id" uuid,
	"batch_id" uuid,
	"name" text NOT NULL,
	"brand" text,
	"grams" real NOT NULL,
	"serving_label" text,
	"serving_qty" real,
	"kcal" real DEFAULT 0 NOT NULL,
	"protein" real DEFAULT 0 NOT NULL,
	"carbs" real DEFAULT 0 NOT NULL,
	"fat" real DEFAULT 0 NOT NULL,
	"fiber" real DEFAULT 0 NOT NULL,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nova" smallint,
	"nutriscore" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"ai_estimate_id" uuid,
	"quick" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_grams_ck" CHECK ("diary_entries"."grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_favorites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"food_id" uuid,
	"recipe_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_servings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" real NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'off' NOT NULL,
	CONSTRAINT "food_servings_grams_ck" CHECK ("food_servings"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" "food_source" NOT NULL,
	"source_id" text,
	"barcode" text,
	"kind" "food_kind" DEFAULT 'food' NOT NULL,
	"name" text NOT NULL,
	"name_es" text,
	"brand" text,
	"quantity_label" text,
	"image_url" text,
	"group_id" uuid,
	"created_by" text,
	"kcal" real,
	"protein" real,
	"carbs" real,
	"sugars" real,
	"fat" real,
	"sat_fat" real,
	"fiber" real,
	"salt" real,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"density" real DEFAULT 1 NOT NULL,
	"nutriscore" text,
	"nova" smallint,
	"ecoscore" text,
	"additives" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"traces" text[] DEFAULT '{}'::text[] NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"ingredients_text" text,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"completeness" real,
	"verified" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"popularity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"default_time" time,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kcal_share" real
);
--> statement-breakpoint
CREATE TABLE "meal_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"meal_slot" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrient_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nutrient_code" text NOT NULL,
	"sex" text,
	"age_min_years" real NOT NULL,
	"age_max_years" real NOT NULL,
	"life_stage" text,
	"kind" text NOT NULL,
	"amount" real NOT NULL,
	"per_kg_body_weight" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'EFSA DRV 2019' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrients" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"unit" text NOT NULL,
	"category" "nutrient_category" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"upper_limit" real,
	"off_key" text,
	"ciqual_key" text
);
--> statement-breakpoint
CREATE TABLE "portion_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"key" text NOT NULL,
	"food_id" uuid,
	"grams" real NOT NULL,
	"samples" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplement_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"dose" real DEFAULT 1 NOT NULL,
	"dose_unit" text DEFAULT 'unidad' NOT NULL,
	"grams_per_dose" real NOT NULL,
	"times" time[] DEFAULT '{}'::time[] NOT NULL,
	"days_of_week" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_log" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "water_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"ml" integer NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" text
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"category" text NOT NULL,
	"met" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"site" text NOT NULL,
	"cm" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"description" text,
	"sensitive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"flow" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_symptoms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"symptom" text NOT NULL,
	"intensity" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_summaries" (
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kcal" real DEFAULT 0 NOT NULL,
	"protein" real DEFAULT 0 NOT NULL,
	"carbs" real DEFAULT 0 NOT NULL,
	"fat" real DEFAULT 0 NOT NULL,
	"fiber" real DEFAULT 0 NOT NULL,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entries" integer DEFAULT 0 NOT NULL,
	"upf_kcal_pct" real,
	"quality_score" real,
	"water_ml" integer DEFAULT 0 NOT NULL,
	"exercise_kcal" real DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drug_food_interactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"substance_code" text NOT NULL,
	"substance_name_es" text NOT NULL,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"severity" text NOT NULL,
	"message_es" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"started_at" timestamp with time zone,
	"activity_code" text,
	"name" text NOT NULL,
	"duration_min" real NOT NULL,
	"kcal" real NOT NULL,
	"met" real,
	"volume_kg" real,
	"sets" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fasting_protocols" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"fast_hours" real,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "fasting_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"protocol" text DEFAULT '16:8' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"target_hours" real NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target_value" real NOT NULL,
	"start_value" real,
	"start_date" date NOT NULL,
	"target_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"reached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" real,
	"period_start" date,
	"period_end" date,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_parameters" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"unit" text NOT NULL,
	"ref_low" real,
	"ref_high" real,
	"related_nutrient" text,
	"category" text DEFAULT 'general' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"lab_name" text,
	"storage_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ai_estimate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"parameter_code" text,
	"raw_name" text NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"ref_low" real,
	"ref_high" real,
	"flag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_feelings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal_slot" text NOT NULL,
	"hunger_before" smallint,
	"satiety_after" smallint,
	"mood" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_doses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"medication_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"taken_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active_ingredient" text,
	"substance_code" text,
	"dose" text,
	"times" time[] DEFAULT '{}'::time[] NOT NULL,
	"days_of_week" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
	"with_food" text,
	"start_date" date,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_conditions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"condition_code" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"since" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"pose" text DEFAULT 'front' NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sleep_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"bedtime" timestamp with time zone,
	"wake_time" timestamp with time zone,
	"hours" real NOT NULL,
	"quality" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"steps" integer NOT NULL,
	"kcal" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptom_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"date" date NOT NULL,
	"symptom" text NOT NULL,
	"intensity" smallint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text DEFAULT 'Diario' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kcal" real NOT NULL,
	"protein" real NOT NULL,
	"carbs" real NOT NULL,
	"fat" real NOT NULL,
	"fiber" real,
	"micros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned" text[] DEFAULT '{}'::text[] NOT NULL,
	"mode" text DEFAULT 'dynamic' NOT NULL,
	"source" text DEFAULT 'formula' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tdee_estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"formula_tdee" real NOT NULL,
	"adaptive_tdee" real,
	"avg_intake" real,
	"trend_weight_start" real,
	"trend_weight_end" real,
	"window_days" integer NOT NULL,
	"logged_days" integer NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"under_logging_suspected" boolean DEFAULT false NOT NULL,
	"suggested_kcal" real,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kg" real NOT NULL,
	"body_fat_pct" real,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_kg_ck" CHECK ("weight_logs"."kg" > 1 and "weight_logs"."kg" < 400)
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid,
	"estimate_id" uuid,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"row_ids" text[] NOT NULL,
	"before" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'Conversación' NOT NULL,
	"kind" text DEFAULT 'coach' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_estimates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confidence" real,
	"model" text,
	"error" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"category" text NOT NULL,
	"content_md" text NOT NULL,
	"source" text DEFAULT 'coach' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"backend" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real,
	"duration_ms" integer,
	"ok" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"cook_session_id" uuid,
	"recipe_id" uuid,
	"title" text NOT NULL,
	"portions_total" real NOT NULL,
	"portions_left" real NOT NULL,
	"grams_per_portion" real,
	"location" text DEFAULT 'nevera' NOT NULL,
	"cooked_on" date NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_left_ck" CHECK ("batches"."portions_left" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cook_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"title" text DEFAULT 'Batch cooking' NOT NULL,
	"recipe_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"steps_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal_slot" text NOT NULL,
	"recipe_id" uuid,
	"food_id" uuid,
	"batch_id" uuid,
	"title" text NOT NULL,
	"portions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cooked" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"budget" numeric(10, 2),
	"person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_estimate_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"food_id" uuid,
	"name" text NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'ud' NOT NULL,
	"grams_per_unit" real,
	"location" text DEFAULT 'despensa' NOT NULL,
	"expires_on" date,
	"opened_on" date,
	"staple" boolean DEFAULT false NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_retros" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"person_id" uuid,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"food_id" uuid,
	"barcode" text,
	"store_id" uuid,
	"group_id" uuid,
	"price" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"price_per_kg" numeric(10, 2),
	"pack_grams" real,
	"source" text NOT NULL,
	"observed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"food_id" uuid,
	"grams" real,
	"quantity" real,
	"unit" text,
	"optional" boolean DEFAULT false NOT NULL,
	"section" text,
	"shopping_category" text
);
--> statement-breakpoint
CREATE TABLE "recipe_ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"stars" smallint,
	"verdict" text,
	"not_eaten" boolean DEFAULT false NOT NULL,
	"comment" text,
	"plan_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"text" text NOT NULL,
	"timer_sec" integer
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid,
	"created_by" text,
	"title" text NOT NULL,
	"description" text,
	"servings" real DEFAULT 1 NOT NULL,
	"prep_min" integer,
	"cook_min" integer,
	"image_url" text,
	"source_url" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"nutrients_per_serving" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kcal_per_serving" real,
	"protein_per_serving" real,
	"carbs_per_serving" real,
	"fat_per_serving" real,
	"total_weight_g" real,
	"cost_per_serving" numeric(10, 2),
	"food_id" uuid,
	"freezable" boolean DEFAULT false NOT NULL,
	"fridge_days" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"food_id" uuid,
	"name" text NOT NULL,
	"quantity" real,
	"unit" text,
	"category" text DEFAULT 'otros' NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_by" text,
	"estimated_price" numeric(10, 2),
	"store_product_id" text,
	"from_recipes" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"plan_id" uuid,
	"name" text DEFAULT 'Compra' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"store_id" uuid,
	"estimated_total" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"credentials_enc" text,
	"postal_code" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_product_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid,
	"store_id" uuid NOT NULL,
	"food_id" uuid,
	"ingredient_key" text,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"pack_size" text,
	"pack_grams" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"postal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"code" text PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"description_es" text NOT NULL,
	"icon" text DEFAULT 'trophy' NOT NULL,
	"rule" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rule" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_achievements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"achievement_code" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"date" date,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"best" integer DEFAULT 0 NOT NULL,
	"last_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_access" ADD CONSTRAINT "person_access_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_access" ADD CONSTRAINT "person_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrient_references" ADD CONSTRAINT "nutrient_references_nutrient_code_nutrients_code_fk" FOREIGN KEY ("nutrient_code") REFERENCES "public"."nutrients"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_memory" ADD CONSTRAINT "portion_memory_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_memory" ADD CONSTRAINT "portion_memory_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_schedules" ADD CONSTRAINT "supplement_schedules_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_schedules" ADD CONSTRAINT "supplement_schedules_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_logs" ADD CONSTRAINT "water_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_periods" ADD CONSTRAINT "cycle_periods_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_symptoms" ADD CONSTRAINT "cycle_symptoms_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_activity_code_activities_code_fk" FOREIGN KEY ("activity_code") REFERENCES "public"."activities"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fasting_sessions" ADD CONSTRAINT "fasting_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_report_id_lab_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."lab_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_parameter_code_lab_parameters_code_fk" FOREIGN KEY ("parameter_code") REFERENCES "public"."lab_parameters"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_feelings" ADD CONSTRAINT "meal_feelings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_conditions" ADD CONSTRAINT "person_conditions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_conditions" ADD CONSTRAINT "person_conditions_condition_code_conditions_code_fk" FOREIGN KEY ("condition_code") REFERENCES "public"."conditions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_logs" ADD CONSTRAINT "sleep_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_logs" ADD CONSTRAINT "step_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_logs" ADD CONSTRAINT "symptom_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_sets" ADD CONSTRAINT "target_sets_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tdee_estimates" ADD CONSTRAINT "tdee_estimates_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_estimate_id_ai_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."ai_estimates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_estimates" ADD CONSTRAINT "ai_estimates_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_estimates" ADD CONSTRAINT "ai_estimates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_cook_session_id_cook_sessions_id_fk" FOREIGN KEY ("cook_session_id") REFERENCES "public"."cook_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD CONSTRAINT "cook_sessions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_retros" ADD CONSTRAINT "plan_retros_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_retros" ADD CONSTRAINT "plan_retros_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ratings" ADD CONSTRAINT "recipe_ratings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ratings" ADD CONSTRAINT "recipe_ratings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_accounts" ADD CONSTRAINT "store_accounts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_accounts" ADD CONSTRAINT "store_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_links" ADD CONSTRAINT "store_product_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_links" ADD CONSTRAINT "store_product_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_links" ADD CONSTRAINT "store_product_links_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_achievements" ADD CONSTRAINT "person_achievements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_achievements" ADD CONSTRAINT "person_achievements_achievement_code_achievements_code_fk" FOREIGN KEY ("achievement_code") REFERENCES "public"."achievements"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_notes" ADD CONSTRAINT "professional_notes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_notes" ADD CONSTRAINT "professional_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_index" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_id_index" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_index" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_index" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_index" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_person_id_created_at_index" ON "audit_log" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_created_at_index" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_id_user_id_index" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "group_members_user_id_index" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "imports_user_id_index" ON "imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_accounts_user_id_index" ON "integration_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_accounts_user_id_provider_person_id_index" ON "integration_accounts" USING btree ("user_id","provider","person_id");--> statement-breakpoint
CREATE INDEX "invitations_email_index" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_group_id_index" ON "invitations" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user_id_type_index" ON "notification_prefs" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_index" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "person_access_person_id_user_id_index" ON "person_access" USING btree ("person_id","user_id");--> statement-breakpoint
CREATE INDEX "person_access_user_id_index" ON "person_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persons_group_id_index" ON "persons" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_user_own_uq" ON "persons" USING btree ("user_id") WHERE "persons"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_index" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhooks_user_id_index" ON "webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "diary_person_date_idx" ON "diary_entries" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "diary_entries_food_id_index" ON "diary_entries" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_client_uq" ON "diary_entries" USING btree ("client_id") WHERE "diary_entries"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "food_favorites_person_id_index" ON "food_favorites" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "food_servings_food_id_index" ON "food_servings" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_uq" ON "foods" USING btree ("source","source_id") WHERE "foods"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "foods_group_idx" ON "foods" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "foods_name_trgm_idx" ON "foods" USING gin ((coalesce("name_es", "name") || ' ' || coalesce("brand", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "foods_categories_idx" ON "foods" USING gin ("categories");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_slots_person_id_key_index" ON "meal_slots" USING btree ("person_id","key");--> statement-breakpoint
CREATE INDEX "meal_templates_person_id_index" ON "meal_templates" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "nutrient_references_nutrient_code_index" ON "nutrient_references" USING btree ("nutrient_code");--> statement-breakpoint
CREATE UNIQUE INDEX "portion_memory_person_id_key_index" ON "portion_memory" USING btree ("person_id","key");--> statement-breakpoint
CREATE INDEX "supplement_schedules_person_id_index" ON "supplement_schedules" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "water_logs_person_id_date_index" ON "water_logs" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "body_measurements_person_id_date_index" ON "body_measurements" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "cycle_periods_person_id_start_date_index" ON "cycle_periods" USING btree ("person_id","start_date");--> statement-breakpoint
CREATE INDEX "cycle_symptoms_person_id_date_index" ON "cycle_symptoms" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_summaries_pk" ON "daily_summaries" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "drug_food_interactions_substance_code_index" ON "drug_food_interactions" USING btree ("substance_code");--> statement-breakpoint
CREATE INDEX "exercise_logs_person_id_date_index" ON "exercise_logs" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_external_uq" ON "exercise_logs" USING btree ("person_id","source","external_id") WHERE "exercise_logs"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "fasting_sessions_person_id_started_at_index" ON "fasting_sessions" USING btree ("person_id","started_at");--> statement-breakpoint
CREATE INDEX "goals_person_id_index" ON "goals" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "insights_person_id_kind_created_at_index" ON "insights" USING btree ("person_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "lab_reports_person_id_date_index" ON "lab_reports" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "lab_results_person_id_parameter_code_date_index" ON "lab_results" USING btree ("person_id","parameter_code","date");--> statement-breakpoint
CREATE INDEX "lab_results_report_id_index" ON "lab_results" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_feelings_person_id_date_meal_slot_index" ON "meal_feelings" USING btree ("person_id","date","meal_slot");--> statement-breakpoint
CREATE INDEX "medication_doses_person_id_scheduled_at_index" ON "medication_doses" USING btree ("person_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "medication_doses_medication_id_index" ON "medication_doses" USING btree ("medication_id");--> statement-breakpoint
CREATE INDEX "medications_person_id_index" ON "medications" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_conditions_person_id_condition_code_index" ON "person_conditions" USING btree ("person_id","condition_code");--> statement-breakpoint
CREATE INDEX "progress_photos_person_id_date_index" ON "progress_photos" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_logs_person_id_date_index" ON "sleep_logs" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "step_logs_person_id_date_index" ON "step_logs" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "symptom_logs_person_id_occurred_at_index" ON "symptom_logs" USING btree ("person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "target_sets_person_id_index" ON "target_sets" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tdee_estimates_person_id_date_index" ON "tdee_estimates" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "weight_logs_person_id_date_index" ON "weight_logs" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_external_uq" ON "weight_logs" USING btree ("person_id","source","external_id") WHERE "weight_logs"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "ai_actions_user_id_created_at_index" ON "ai_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_person_id_updated_at_index" ON "ai_conversations" USING btree ("person_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_estimates_user_id_created_at_index" ON "ai_estimates" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_estimates_person_id_kind_index" ON "ai_estimates" USING btree ("person_id","kind");--> statement-breakpoint
CREATE INDEX "ai_memories_person_id_category_index" ON "ai_memories" USING btree ("person_id","category");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_id_created_at_index" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_created_at_index" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "batches_group_id_index" ON "batches" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "cook_sessions_group_id_date_index" ON "cook_sessions" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "meal_plan_items_plan_id_date_index" ON "meal_plan_items" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "meal_plan_items_recipe_id_index" ON "meal_plan_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "meal_plans_group_id_week_start_index" ON "meal_plans" USING btree ("group_id","week_start");--> statement-breakpoint
CREATE INDEX "pantry_items_group_id_index" ON "pantry_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "pantry_items_group_id_expires_on_index" ON "pantry_items" USING btree ("group_id","expires_on");--> statement-breakpoint
CREATE INDEX "plan_retros_plan_id_index" ON "plan_retros" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "prices_food_id_observed_on_index" ON "prices" USING btree ("food_id","observed_on");--> statement-breakpoint
CREATE INDEX "prices_barcode_index" ON "prices" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_id_index" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_food_id_index" ON "recipe_ingredients" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "recipe_ratings_recipe_id_index" ON "recipe_ratings" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ratings_person_id_index" ON "recipe_ratings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "recipe_steps_recipe_id_index" ON "recipe_steps" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_group_id_index" ON "recipes" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "recipes_title_trgm_idx" ON "recipes" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recipes_tags_idx" ON "recipes" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "shopping_items_list_id_index" ON "shopping_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_group_id_status_index" ON "shopping_lists" USING btree ("group_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_accounts_group_id_store_id_index" ON "store_accounts" USING btree ("group_id","store_id");--> statement-breakpoint
CREATE INDEX "store_product_links_store_id_food_id_index" ON "store_product_links" USING btree ("store_id","food_id");--> statement-breakpoint
CREATE INDEX "store_product_links_store_id_ingredient_key_index" ON "store_product_links" USING btree ("store_id","ingredient_key");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_participants_challenge_id_person_id_index" ON "challenge_participants" USING btree ("challenge_id","person_id");--> statement-breakpoint
CREATE INDEX "challenges_group_id_end_date_index" ON "challenges" USING btree ("group_id","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "person_achievements_person_id_achievement_code_index" ON "person_achievements" USING btree ("person_id","achievement_code");--> statement-breakpoint
CREATE INDEX "professional_notes_person_id_created_at_index" ON "professional_notes" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "streaks_person_id_kind_index" ON "streaks" USING btree ("person_id","kind");