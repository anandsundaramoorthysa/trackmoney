import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | null = null;

function connect(): Database {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }

  instance ??= drizzle(neon(connectionString), { schema });
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
