/** Applies db/schema.sql to DATABASE_URL (idempotent). Usage: npm run db:migrate */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (run `vercel env pull .env.local`)");
  const sql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'rescue' ORDER BY table_name",
    );
    console.log(`rescue schema ready: ${rows.map((r: { table_name: string }) => r.table_name).join(", ")}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error("migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
