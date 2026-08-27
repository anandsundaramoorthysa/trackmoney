import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
  /**
   * scrypt, salted per user, formatted "scrypt$<salt-hex>$<hash-hex>".
   * Null only for the seeded demo account, which is entered by a button
   * rather than a password.
   */
  passwordHash: text("password_hash"),
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  /** Throttling. A wrong password costs the attacker time, not us. */
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Only the *hash* of a session token is stored.
 *
 * The token itself exists in one place — the user's cookie — so a database
 * leak reveals no usable sessions. Same reasoning as password hashing, applied
 * to the credential that actually rides on every request.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Hashed, single-use, and dead 15 minutes after it is issued. */
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchant: text("merchant").notNull(),
    category: text("category").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    occurredOn: date("occurred_on").notNull(),
    /**
     * Content fingerprint of owner + day + amount + normalised merchant.
     *
     * Re-importing a statement that overlaps an earlier one is the normal case,
     * not the exceptional one, so the same charge must not land twice. The
     * uniqueness is enforced by the index below rather than by a check in the
     * import code: a rule the database keeps cannot be bypassed by a second
     * code path that forgets to ask.
     */
    dedupKey: text("dedup_key").notNull(),
    source: text("source", { enum: ["manual", "import", "seed"] })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("transactions_user_dedup_key").on(table.userId, table.dedupKey),
    index("transactions_user_month_idx").on(table.userId, table.occurredOn),
  ],
);

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

export const payments = pgTable(
  "payments",
  {
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
    /**
     * Who set the money in motion. All three go through one function, which is
     * the claim the audit trail exists to let someone verify.
     */
    initiatedBy: text("initiated_by", {
      enum: ["agent", "billing_page", "ai_buyer"],
    })
      .notNull()
      .default("billing_page"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * At most one unpaid order per account, enforced by the database.
     *
     * "One open order per user" was previously a read followed by a write,
     * which two requests arriving together can both pass. A partial unique
     * index makes the rule true rather than merely usually true, and the loser
     * of the race is handed the winner's order.
     */
    uniqueIndex("payments_one_open_order_per_user")
      .on(table.userId)
      .where(sql`status = 'created'`),
  ],
);

/**
 * A purchase mandate — PLAN.md §10.5.
 *
 * The human-facing flow gates a money action on a person clicking. An AI buyer
 * has no one to click, so the equivalent has to be issued in advance: a scoped,
 * expiring, single-use authorisation naming what may be bought and the most it
 * may cost. The token is stored only as a hash, like every other bearer
 * credential here.
 *
 * This is the honest version of "agent-to-agent commerce": the buyer never
 * gains authority of its own, it presents authority a person granted.
 */
export const purchaseMandates = pgTable("purchase_mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  maxAmountPaise: integer("max_amount_paise").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** Free text from the issuer, shown in the audit trail. */
  purpose: text("purpose"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A parsed statement, held between the preview and the commit.
 *
 * The rows used to travel in the URL between those two steps, which worked
 * until someone imported a real statement: three hundred rows encode to about
 * 28 KB, and Node rejects a request line over 16 KB outright. Keeping them here
 * and putting only an id in the URL also means the commit reads what was
 * actually parsed rather than what the form posted back.
 */
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rows: jsonb("rows").$type<unknown[]>().notNull(),
  ignoredCount: integer("ignored_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ImportBatch = typeof importBatches.$inferSelect;
export type PurchaseMandate = typeof purchaseMandates.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type PlanConfig = typeof planConfig.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type Payment = typeof payments.$inferSelect;
