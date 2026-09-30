import {
  sqliteTable,
  uniqueIndex,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("records_user_kind").on(t.userId, t.kind)],
);
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at").notNull(),
    client: text("client").notNull().default(""),
    category: text("category").notNull().default(""),
    docDate: text("doc_date").notNull().default(""),
    sha256: text("sha256").notNull().default(""),
  },
  (t) => [index("documents_user").on(t.userId)],
);
export const connections = sqliteTable(
  "connections",
  {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    data: text("data").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    event: text("event").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_user_created").on(t.userId, t.createdAt)],
);
export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("members_email").on(t.email)],
);
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    title: text("title").notNull().default(""),
    dmKey: text("dm_key").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("conversations_dm_key").on(t.dmKey)],
);
export const conversationMembers = sqliteTable(
  "conversation_members",
  {
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    lastReadAt: text("last_read_at").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_members_user").on(t.userId),
  ],
);
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("messages_conversation_created").on(t.conversationId, t.createdAt)],
);
export const loginCodes = sqliteTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  sentAt: text("sent_at").notNull(),
});
export const authThrottle = sqliteTable("auth_throttle", {
  key: text("key").primaryKey(),
  windowStart: text("window_start").notNull(),
  count: integer("count").notNull().default(0),
});
