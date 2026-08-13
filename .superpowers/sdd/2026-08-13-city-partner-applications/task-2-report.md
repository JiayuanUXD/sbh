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

## Fix Round 1 (2026-08-13)

### Review fixes

- Stage-two identity lookup no longer uses `LIMIT 1`. The transaction locks every row matching `request_id + contact_phone`; zero matches return 404, exactly one continues, and more than one returns the safe 409 `identity_ambiguous` response. The ambiguous path commits its read-only transaction and updates no matching record, without exposing city, count, or IDs.
- Same-origin checks now fail closed when either `Origin` or `Host` is missing. A request is accepted only when the parsed Origin exactly equals the request URL origin (scheme, hostname, and effective port) and the Host header exactly equals the request URL host.
- Added a real local PostgreSQL concurrency integration test. The previous in-memory lock test remains useful for deterministic branch coverage and query-contract assertions, but it did not by itself prove database serialization. The real test supplies that missing evidence.
- The first real PostgreSQL run exposed a Payload update integration defect: the Task 1 stage-two hook returned only accepted stage-two fields, and Payload 3.86 then validated a document missing required stage-one/workflow fields. A new hook regression test captured that RED. The hook now returns the immutable previous document merged with only the accepted stage-two fields; its trusted context, marker checks, accepted-field allowlist, and unsealed-fact protection remain unchanged.

### RED evidence

- Origin/multi-match RED: 2 files, 38 tests; 6 intended failures showed missing Origin/Host and scheme mismatch were accepted, SQL still contained `LIMIT 1`, two matches incorrectly completed/updated, and the route lacked an ambiguous mapping.
- Real PostgreSQL first run reached the actual row-lock/update path and failed with Payload `ValidationError` for missing required stage-one/workflow fields. The temporary application was deleted by `afterAll`.
- Hook merge RED: 1 file, 10 tests; the new preservation assertion failed because only stage-two fields were returned.

### GREEN and real database evidence

- Focused unit suite: 4 files, 54/54 passed.
- Real PostgreSQL integration, loaded from local `.env.local` without printing configuration: 1 file, 1/1 passed. It created a uniquely named temporary application, issued two concurrent different stage-two completions using independent Payload transactions, and proved exactly one `completed` plus one `conflict`; the winning facts, completion timestamp, SHA-256 fingerprint, and a completed document version were persisted; no Payload transaction sessions remained. `afterAll` deleted the temporary application and a read-back asserted that no fixture row remained.
- Relevant Task 1/security/route/rate-limit suite: 16 files, 295/295 passed.
- Full unit suite without database environment: 195 files passed, 1 database integration file skipped; 2841 tests passed, 1 skipped. The skipped test is the same integration test executed separately against real PostgreSQL above.
- Node 22 TypeScript: exit 0, no diagnostics.
- Targeted ESLint: exit 0, no diagnostics.
- `git diff --check`: exit 0.

No schema, migration, plan/ledger, deployment, push, or production action was performed. The only local database mutations were the isolated integration fixture and its verified cleanup.
