CREATE TABLE `connections` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`)
);
