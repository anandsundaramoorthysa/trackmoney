CREATE TABLE "month_quota" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "month_quota_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
ALTER TABLE "month_quota" ADD CONSTRAINT "month_quota_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;