# Quiz reward history grouping — 2026-10-27

Base: `fb14ebae2ee3871839e9e7f89a6bf5bc1d30644c`.

The legacy Quiz reward writer issues one ledger entry per newly rewarded correct answer. The history API paginated those entries directly, so one attempt earning nine Stars appeared as nine `+1` lines and could split across pages.

The history read model now groups positive lesson/final Quiz rewards by proven attempt ID, assessment, learning cycle, competition month and lesson/final category before counting or paginating. One attempt earning nine Stars displays one `+9` history event. Pass/bonus entries for that attempt are included together. Distinct attempts/cycles/months remain separate; videos, adjustments, nonpositive entries and legacy entries without a valid attempt ID stay individual. No association is guessed from title or timestamp.

Reward calculation, payment keys, duplicate prevention, the underlying ledger, balances and ranking facts are unchanged. The existing API response/title enrichment and balance-only path remain compatible. Personal Star history bypasses stale browser/session caches and the API uses `no-store`.

Changed implementation:

- `src/lib/star-history.ts`: scoped grouped count and page queries.
- `src/app/api/v1/stars/me/route.ts`: use grouped history before enrichment.
- `src/lib/api/client.ts`: refresh personal Star history instead of reusing stale rows.

Verification:

- Real route + isolated PostgreSQL regression observed RED: nine legacy rows with `limit=2` yielded two separate rows instead of one event.
- After the fix, the same fixture PASS: one event `+9`, `totalItems=1`, `totalPages=1`, balance 9; raw ledger still contains nine entries.
- Integration checks PASS for separate attempts/cycles, pass+bonus grouping, already aggregated native rewards, individual videos/adjustments/unknown legacy rows, grouped pagination without duplicate IDs, unchanged paginated total/balance, another user's rewards excluded, and balance-only behavior.
- Existing business rules 66/66 PASS; formula/oracle rules 49/49 PASS.
- TypeScript and production build PASS.
- Independent read-only review: no actionable Critical/Important/Minor findings.
- Chromium on the local production build PASS: exactly one `+9` history row, no `+1` duplicates, a pre-seeded old nine-row session cache ignored, F5 preserves the result, no page errors. Screenshot: `scratch/star-history/quiz-nine-stars-one-event.png`.

All new fixtures use an explicitly guarded disposable loopback database. No production ledger rewrite, data backfill or schema migration is required or performed by this fix. The earlier requested account reset is a separate operation.
