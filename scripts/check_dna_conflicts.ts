import { spawnSync } from 'node:child_process'
// One read-only audit implementation; no real email addresses in console output.
const result = spawnSync(process.execPath, ['scripts/audit-organization-integrity.mjs'], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
