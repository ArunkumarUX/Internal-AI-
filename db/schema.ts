import {
  sqliteTable,
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
