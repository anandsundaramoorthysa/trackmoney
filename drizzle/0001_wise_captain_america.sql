CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "dedup_key" text;--> statement-breakpoint
-- Backfill existing rows with the same fingerprint the application computes:
-- sha256 over user | day | amount | normalised merchant, truncated to 32 hex
-- characters. Adding the column NOT NULL outright would fail on any database
-- that already holds transactions.
UPDATE "transactions" SET "dedup_key" = left(
  encode(
    sha256(
      convert_to(
        "user_id"::text || '|' || "occurred_on"::text || '|' || "amount_paise"::text || '|' ||
        left(
          btrim(regexp_replace(regexp_replace(lower("merchant"), '[^a-z0-9\s]', ' ', 'g'), '\s+', ' ', 'g')),
          40
        ),
        'UTF8'
      )
    ),
    'hex'
  ),
  32
) WHERE "dedup_key" IS NULL;--> statement-breakpoint
-- Any pre-existing duplicates would block the unique constraint below. Keep the
-- oldest row of each colliding group, which is what an import would have done.
DELETE FROM "transactions" t USING "transactions" older
  WHERE t."user_id" = older."user_id"
    AND t."dedup_key" = older."dedup_key"
    AND t."created_at" > older."created_at";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_month_idx" ON "transactions" USING btree ("user_id","occurred_on");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_dedup_key" UNIQUE("user_id","dedup_key");