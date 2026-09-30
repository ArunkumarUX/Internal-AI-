CREATE TABLE `login_codes` (
	`email` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
