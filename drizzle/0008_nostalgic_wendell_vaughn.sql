CREATE TABLE "payment_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
