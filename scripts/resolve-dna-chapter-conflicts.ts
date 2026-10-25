/** Deprecated: never guess a Chapter or backfill a real ledger from current membership. */
console.error('Automatic DNA/Chapter repair is disabled. Run node scripts/audit-organization-integrity.mjs and review effective timestamps before any correction.')
process.exitCode = 1
