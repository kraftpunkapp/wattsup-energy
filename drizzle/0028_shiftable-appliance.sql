CREATE TABLE "shiftable_appliance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"power_kw" real NOT NULL,
	"duration_min" integer NOT NULL,
	"allowed_from" smallint NOT NULL,
	"allowed_to" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shiftable_appliance" ADD CONSTRAINT "shiftable_appliance_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shiftable_appliance_household_idx" ON "shiftable_appliance" USING btree ("household_id");