# Task 2 Report: Hardened Public Partner APIs

## Status

Complete. The dedicated city-partner pool now has strict stage-one and stage-two public write boundaries. Public callers cannot select an inactive/noncanonical city, write workflow state, bypass the Task 1 trusted stage contexts, expose internal records, or overwrite completed details.

## Implementation

- Added strict stage-one and stage-two request guards for JSON media type, same origin, body size, exact keys (including nested objects), safe request IDs, canonical city slugs, normalized Chinese mobile numbers, closed identity/resource enums, `other` dependencies, consent version, fixed source path, and field limits.
- Added stage-one persistent idempotency using `sha256(requestId | phoneNormalized | cityId)`. The service resolves the submitted slug through the validated public city-profile resolver, uses the Task 1 server-owned stage-one context, stores only the normalized phone, and rereads after a matching unique-index race.
- Added separate persistent/shared rate-limit keys and module-level prune state for create and details endpoints, reusing the existing PostgreSQL rate-limit table and configuration. Rate-limit keys contain only a daily salted IP hash.
- Added PII-safe public responses and logs. Success bodies are exactly `{ok,idempotent}`; errors use safe codes and never return record IDs, status, assignee, applicant facts, or exception messages.
- Added canonical stage-two fingerprints over normalized optional facts. Exact retries are idempotent, changed retries return 409, and a mismatched request ID/normalized-phone identity returns 404.

## Atomic Completion Mechanism

No schema change was needed. The implementation uses Payload 3.86's supported database transaction lifecycle:

1. `payload.db.beginTransaction()` opens an isolated Drizzle session.
2. The transaction session executes a parameterized PostgreSQL `SELECT ... FOR UPDATE` by `request_id + contact_phone`.
3. While holding the row lock, the service reads `details_completed_at` and `details_fingerprint`.
4. A first completion calls Payload Local API update with the same `req.transactionID` and the Task 1 stage-two context/markers, so hooks and versions stay active inside that transaction.
5. The service commits on every decided outcome and rolls back on failure.

Concurrent requests for the same application therefore serialize. The loser observes the committed marker/fingerprint: identical normalized content becomes an idempotent retry and different content becomes a conflict. The focused test starts two different first completions with `Promise.all`, proves only one Local API update runs, proves the losing payload cannot overwrite facts, and separately asserts the row-lock SQL, shared transaction ID, and commit contract.

## TDD Evidence

All verification used Node 22 with the repository's pnpm 8.6.1 installation.

Initial RED, captured before production edits:

```text
npx -y node@22 node_modules/vitest/vitest.mjs run tests/city-partner-api-guards.test.ts tests/city-partner-api-route.test.ts tests/city-partner-details-route.test.ts
```

All 3 suites failed to collect because `request-guards`, the create route, and `public-service`/details route did not exist. The tests already covered strict schemas, create idempotency and unique races, invalid city, rate limiting, PII boundaries, wrong stage-two identity, exact retry/change conflict, concurrent completion, and the transaction/row-lock contract.

Focused GREEN after implementation: 3 files, 37/37 tests passed.

## Verification

- Focused Task 2 suite: 3 files, 37/37 passed.
- Relevant Task 1, permission/navigation/migration, API route, distributed-rate-limit, privacy and security suite: 16 files, 285/285 passed.
- Full unit suite: 195 files, 2833/2833 passed.
- Node 22 `tsc --noEmit --pretty false`: exit 0, no diagnostics.
- Targeted ESLint on all Task 2 production and test files: exit 0, no diagnostics.
- `git diff --check`: exit 0.

## Scope and Concerns

- No collection/schema/migration, database, plan/ledger, deployment, push, or production action was performed.
- Stage two deliberately matches the normalized phone stored by stage one. Pre-Task-2/manual rows with non-normalized phone data fail closed as 404 and require controlled repair rather than fuzzy identity matching.
- The API accepts both `live` and `coming-soon` profiles when their canonical city relationship is active, matching the city-partner entry-point design; malformed, missing, disabled, or noncanonical profile/city relationships fail closed through the Plan 1 resolver.
