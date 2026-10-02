CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_owner_created` ON `audit` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`date` text NOT NULL,
	`memo` text NOT NULL,
	`kind` text NOT NULL,
	`lines` text NOT NULL,
	`source` text,
	`reversal` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `journals_owner_date` ON `journals` (`owner`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `journals_source` ON `journals` (`owner`,`source`);--> statement-breakpoint
CREATE UNIQUE INDEX `journals_reversal` ON `journals` (`owner`,`reversal`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_owner_kind` ON `records` (`owner`,`kind`);