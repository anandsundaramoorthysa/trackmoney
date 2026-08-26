CREATE TABLE "purchase_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"max_amount_paise" integer NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_mandates_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "purchase_mandates" ADD CONSTRAINT "purchase_mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;