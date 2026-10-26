CREATE TABLE "household_forecast" (
	"household_id" uuid NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"solar_kwh" real NOT NULL,
	"load_kwh" real NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_forecast_household_id_start_pk" PRIMARY KEY("household_id","start")
);
--> statement-breakpoint
ALTER TABLE "household_forecast" ADD CONSTRAINT "household_forecast_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;