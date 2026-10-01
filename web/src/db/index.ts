import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const g = globalThis as unknown as { pgPool?: Pool; db?: NodePgDatabase<typeof schema> };

/** Created on first use, so builds and imports work without DATABASE_URL. */
function getPool(): Pool {
  if (!g.pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string (see .env.example).");
    g.pgPool = new Pool({ connectionString: url, max: 5, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined });
  }
  return g.pgPool;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!g.db) g.db = drizzle(getPool(), { schema });
  return g.db;
}

const lazy = <T extends object>(get: () => T) =>
  new Proxy({} as T, {
    get: (_, prop) => {
      const target = get() as Record<string | symbol, unknown>;
      const value = target[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });

export const pool: Pool = lazy(getPool);
export const db: NodePgDatabase<typeof schema> = lazy(getDb);
