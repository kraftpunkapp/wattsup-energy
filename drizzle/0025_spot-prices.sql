CREATE TABLE "spot_price" (
	"start" timestamp with time zone PRIMARY KEY NOT NULL,
	"eur_mwh" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
