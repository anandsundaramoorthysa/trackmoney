-- Any account already holding more than one unpaid order would block the
-- index below. Keep the oldest, which is the one a user would have been
-- handed by the reuse path anyway.
DELETE FROM "payments" p USING "payments" older
  WHERE p."user_id" = older."user_id"
    AND p."status" = 'created' AND older."status" = 'created'
    AND p."created_at" > older."created_at";--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_order_per_user" ON "payments" USING btree ("user_id") WHERE status = 'created';