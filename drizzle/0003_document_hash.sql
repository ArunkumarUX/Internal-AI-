ALTER TABLE `documents` ADD `sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `documents_user_sha256` ON `documents` (`user_id`,`sha256`);
