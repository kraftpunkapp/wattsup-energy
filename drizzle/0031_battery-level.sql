CREATE TABLE "battery_level" (
	"household_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"soc_percent" real NOT NULL,
	CONSTRAINT "battery_level_household_id_measured_at_pk" PRIMARY KEY("household_id","measured_at")
);
--> statement-breakpoint
ALTER TABLE "battery_level" ADD CONSTRAINT "battery_level_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Reprise du dernier relevé gardé jusqu'ici (battery_state, retirée par la migration suivante).
INSERT INTO "battery_level" ("household_id", "measured_at", "soc_percent") SELECT "household_id", "measured_at", "soc_percent" FROM "battery_state";
