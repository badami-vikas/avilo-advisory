CREATE TABLE `blueprint_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`author` text NOT NULL,
	`summary` text NOT NULL,
	`blueprint` text NOT NULL,
	`diff` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`decided_at` text,
	`decision_note` text
);
--> statement-breakpoint
CREATE INDEX `blueprint_proposals_status_idx` ON `blueprint_proposals` (`status`);
