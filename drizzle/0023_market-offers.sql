CREATE TABLE "market_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_commit" text NOT NULL,
	"offers" integer NOT NULL,
	"compared" integer NOT NULL,
	"added" jsonb NOT NULL,
	"removed" jsonb NOT NULL,
	"updated" jsonb NOT NULL,
	"unreadable" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_offer" (
	"name" text PRIMARY KEY NOT NULL,
	"source_path" text NOT NULL,
	"definition" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_sync" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"source_commit" text,
	"source_committed_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"status" text,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "market_import_at_idx" ON "market_import" USING btree ("at");