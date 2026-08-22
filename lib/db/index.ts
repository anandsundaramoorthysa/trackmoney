import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | null = null;

/**
 * Neon in production, plain Postgres anywhere else.
 *
 * Neon's serverless driver speaks an HTTP protocol that only Neon answers, so
 * pointing it at a local `postgres://localhost` database fails. Choosing the
 * driver from the host means the same code runs against Neon on Vercel, against
 * a local Postgres for development, and against a throwaway database in the
 * test suite — without the app carrying a separate "test mode".
 */
function isNeonUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

function connect(): Database {
  if (instance) return instance;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }

  instance = isNeonUrl(connectionString)
    ? drizzleNeon(neon(connectionString), { schema })
    : (drizzlePg(new Pool({ connectionString }), {
        schema,
      }) as unknown as Database);

  return instance;
}

/**
 * The connection is resolved on first use rather than at import time.
 *
 * Next.js evaluates route modules while collecting page data during a build, so
 * throwing at import would make a missing DATABASE_URL fail the build rather
 * than fail the request. Deferring it means a fresh clone builds fine and the
 * pages render their setup instructions instead.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const value = Reflect.get(connect(), property, receiver);
    return typeof value === "function" ? value.bind(connect()) : value;
  },
});

export { schema };
