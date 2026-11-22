import { Pool, type QueryResultRow } from 'pg'

// Direct database access is only for fixtures the product has no screen for (time travel, reading
// facts the API hides). The guard mirrors scripts/test/e2e-target.cjs.
const { validateE2eTarget } = require('../../../../scripts/test/e2e-target.cjs')

let pool: Pool | null = null
function getPool() {
  if (!pool) {
    validateE2eTarget(process.env.E2E_DATABASE_URL)
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 })
  }
  return pool
}

export async function sql<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await getPool().query<T>(text, params)).rows
}

export async function one<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params)
  if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}: ${text}`)
  return rows[0]
}

export async function userByEmail(email: string) {
  return one<{ id: string; role: string; status: string; lock_reason: string | null; failed_login_count: number }>(
    'SELECT id, role, status, lock_reason, failed_login_count FROM users WHERE email = $1', [email])
}
