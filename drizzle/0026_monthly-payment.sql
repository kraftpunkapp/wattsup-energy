ALTER TABLE "contract" ADD COLUMN "monthly_payment_cents" integer;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "payments_per_year" smallint;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "settlement_month" smallint;