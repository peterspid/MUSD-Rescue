import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP query function. All tables live in the `rescue` schema. */
export function sql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    _sql = neon(url);
  }
  return _sql;
}

export async function dbHealthy(): Promise<boolean> {
  try {
    const rows = await sql()`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
