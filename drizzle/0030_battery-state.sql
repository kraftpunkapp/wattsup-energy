CREATE TABLE "battery_state" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"soc_percent" real NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battery_state" ADD CONSTRAINT "battery_state_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;