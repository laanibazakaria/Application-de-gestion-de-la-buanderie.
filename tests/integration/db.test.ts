import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

describe("base de test", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  it("répond et utilise PostgreSQL 16 ou plus", async () => {
    const { rows } = await pool.query<{ v: string }>("select current_setting('server_version_num') as v");
    expect(Number(rows[0]?.v)).toBeGreaterThanOrEqual(160000);
  });
});
