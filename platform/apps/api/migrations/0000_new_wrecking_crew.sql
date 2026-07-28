CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`statement` text NOT NULL,
	`role` text DEFAULT 'total' NOT NULL,
	`unit` text DEFAULT 'currency' NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_statement_idx` ON `accounts` (`statement`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actor` text DEFAULT 'local' NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`stage` text DEFAULT 'Active' NOT NULL,
	`industry` text,
	`owner` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (`name`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`period` text NOT NULL,
	`account_id` text NOT NULL,
	`value` real NOT NULL,
	`source_file_id` text,
	`source_row_label` text,
	`source_column_label` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_client_period_account_unique` ON `facts` (`client_id`,`period`,`account_id`);--> statement-breakpoint
CREATE INDEX `facts_client_period_idx` ON `facts` (`client_id`,`period`);--> statement-breakpoint
CREATE TABLE `formula_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`formula_id` text NOT NULL,
	`version` integer NOT NULL,
	`expression` text NOT NULL,
	`author` text DEFAULT 'local' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`formula_id`) REFERENCES `formulas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `formula_versions_unique` ON `formula_versions` (`formula_id`,`version`);--> statement-breakpoint
CREATE INDEX `formula_versions_formula_idx` ON `formula_versions` (`formula_id`);--> statement-breakpoint
CREATE TABLE `formulas` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`expression` text NOT NULL,
	`unit` text DEFAULT 'currency' NOT NULL,
	`description` text,
	`benchmark` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `label_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`report_type` text NOT NULL,
	`normalized_label` text NOT NULL,
	`raw_label` text NOT NULL,
	`account_id` text NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_mappings_scope_unique` ON `label_mappings` (`client_id`,`report_type`,`normalized_label`);--> statement-breakpoint
CREATE INDEX `label_mappings_lookup_idx` ON `label_mappings` (`report_type`,`normalized_label`);--> statement-breakpoint
CREATE TABLE `overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`period` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`value` real NOT NULL,
	`previous_value` real,
	`reason` text,
	`author` text DEFAULT 'local' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`superseded_by_source_file_id` text,
	`superseded_value` real,
	`superseded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`superseded_by_source_file_id`) REFERENCES `source_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `overrides_lookup_idx` ON `overrides` (`client_id`,`period`,`target_kind`,`target_id`,`status`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_files` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`filename` text NOT NULL,
	`stored_path` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`extension` text NOT NULL,
	`report_type` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`classified_by` text DEFAULT 'rules' NOT NULL,
	`periods_detected` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`uploaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`imported_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_files_client_idx` ON `source_files` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_files_client_sha_unique` ON `source_files` (`client_id`,`sha256`);