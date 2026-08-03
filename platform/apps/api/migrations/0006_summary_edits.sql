CREATE TABLE `summary_edits` (
	`client_id` text NOT NULL,
	`period` text NOT NULL,
	`body` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`client_id`, `period`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
