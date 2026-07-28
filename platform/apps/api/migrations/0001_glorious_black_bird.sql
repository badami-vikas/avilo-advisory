CREATE TABLE `detail_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`value` real NOT NULL,
	`bucket` text,
	`count` real,
	`source_file_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `detail_rows_lookup_idx` ON `detail_rows` (`client_id`,`period`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `detail_rows_unique` ON `detail_rows` (`client_id`,`period`,`kind`,`label`,`bucket`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`stage` text DEFAULT 'Onboarding' NOT NULL,
	`industry` text,
	`owner` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_clients`("id", "name", "legal_name", "fiscal_year_start_month", "stage", "industry", "owner", "notes", "created_at", "updated_at") SELECT "id", "name", "legal_name", "fiscal_year_start_month", "stage", "industry", "owner", "notes", "created_at", "updated_at" FROM `clients`;--> statement-breakpoint
DROP TABLE `clients`;--> statement-breakpoint
ALTER TABLE `__new_clients` RENAME TO `clients`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (`name`);