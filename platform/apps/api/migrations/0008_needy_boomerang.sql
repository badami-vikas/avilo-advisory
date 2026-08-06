-- Hand-trimmed after generation, deliberately.
--
-- `drizzle-kit generate` emitted CREATE TABLE for app_settings, blueprint_proposals and
-- summary_edits as well: migrations 0005-0007 were hand-written and their meta snapshots
-- were never updated, so the generator believed those tables did not exist yet. Applying
-- that SQL to any database created before today fails on the first CREATE TABLE, which is
-- precisely the failure mode CLAUDE.md warns about — migration bugs hide behind fresh
-- installs. Only the genuinely new table is kept here. The regenerated meta snapshot IS
-- kept, so the next generated migration starts from an accurate picture.
CREATE TABLE `configuration_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`summary` text NOT NULL,
	`blueprint` text NOT NULL,
	`diff` text NOT NULL,
	`proposal_id` text,
	`restored_from` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `configuration_versions_seq_idx` ON `configuration_versions` (`seq`);
