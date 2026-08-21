import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * TrackMoney schema — PLAN.md §6.7.
 *
 * Deliberately small. There is no multi-tenancy, no row-level security and no
 * double-entry ledger: this app exists so the agent has something real to reason
 * about, and every table below earns its place in that story.
 *
 * All money is stored as integer paise. No floats anywhere.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  merchant: text("merchant").notNull(),
  category: text("category").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  occurredOn: date("occurred_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Plan limits and pricing live here as data, never as constants in components
 * or prompts. The agent reads its pitch numbers from these rows.
 */
export const planConfig = pgTable("plan_config", {
  plan: text("plan", { enum: ["free", "pro"] }).primaryKey(),
  label: text("label").notNull(),
  txnCapPerMonth: integer("txn_cap_per_month"), // null = unlimited
  recurringDetection: boolean("recurring_detection").notNull().default(false),
  pricePaise: integer("price_paise").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  state: text("state", {
    enum: ["open", "pitched", "declined", "converted"],
  })
    .notNull()
    .default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AgentEventType =
  | "suggestion"
  | "agent_reply"
  | "user_reply"
  | "intent"
  | "checkout_created"
  | "checkout_result"
  | "tool_refused";

/**
 * The audit trail. One row per thing the agent did or was stopped from doing.
 *
 * `facts` holds the exact deterministic inputs the agent was handed when it
 * spoke, so a reader can check the sentence against the numbers rather than
 * taking the sentence on trust. That column is what makes "explainable"
 * verifiable instead of rhetorical.
 */
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AgentEventType>().notNull(),
  explanation: text("explanation").notNull(),
  facts: jsonb("facts").$type<Record<string, unknown> | null>(),
  meta: jsonb("meta").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  razorpayPaymentId: text("razorpay_payment_id"),
  amountPaise: integer("amount_paise").notNull(),
  status: text("status", { enum: ["created", "success", "failed"] })
    .notNull()
    .default("created"),
  failureReason: text("failure_reason"),
  /** "agent" or "billing_page" — proves both paths hit the same function. */
  initiatedBy: text("initiated_by", { enum: ["agent", "billing_page"] })
    .notNull()
    .default("billing_page"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type PlanConfig = typeof planConfig.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type Payment = typeof payments.$inferSelect;
