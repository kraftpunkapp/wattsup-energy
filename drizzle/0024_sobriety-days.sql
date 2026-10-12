CREATE TABLE "sobriety_day" (
	"date" date PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sobriety_override" (
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sobriety" boolean NOT NULL,
	CONSTRAINT "sobriety_override_household_id_date_pk" PRIMARY KEY("household_id","date")
);
--> statement-breakpoint
ALTER TABLE "sobriety_override" ADD CONSTRAINT "sobriety_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;