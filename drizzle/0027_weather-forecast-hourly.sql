CREATE TABLE "weather_forecast_hourly" (
	"lat_e2" integer NOT NULL,
	"lon_e2" integer NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"radiation_wm2" real,
	"temperature_c" real,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_forecast_hourly_lat_e2_lon_e2_start_pk" PRIMARY KEY("lat_e2","lon_e2","start")
);
