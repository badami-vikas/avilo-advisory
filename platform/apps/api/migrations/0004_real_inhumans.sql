CREATE TABLE `action_states` (
	`client_id` text NOT NULL,
	`period` text NOT NULL,
	`action_id` text NOT NULL,
	`owner` text,
	`due_date` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`client_id`, `period`, `action_id`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
