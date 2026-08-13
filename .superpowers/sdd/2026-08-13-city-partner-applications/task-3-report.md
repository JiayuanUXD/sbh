# Task 3 Report: Retryable City-Scoped Partner Notifications

## Status

Complete. Initial city-partner application creates now emit a durable, identifier-only domain event and defer job enqueue until an independent read proves the application committed. The retryable consumer notifies only active, city-scoped users with `city_partner_application:read`, with active ADM users used only when that city has no eligible recipient.

## Implementation

- Added the `notify-city-partner-application-created` Payload task and dedicated `city-partner-application-notifications` queue.
- Added a create-only Collection `afterChange` producer. The event is persisted in the application transaction with the stable identity `city-partner-application-created:{applicationId}` and contains only the application ID. A zero-delay deferred callback performs a request-independent committed read before queueing, so an enqueue error cannot reject or roll back the already persisted public response.
- Added a retryable consumer with five exponential-backoff attempts. It resolves the application's populated city, paginates all active roles fail-closed, filters roles by `city_partner_application:read` (or `*`), and queries active users whose trusted `cityScope` contains that exact city. Only if that query yields no users does it query active ADM users.
- Added per-event/type/recipient replay checks and relies on the existing notification unique index for race safety. A unique conflict is accepted only after an independent exact read proves the winning row.
- Notification title/body contain only the canonical city name and application ID. Events, job inputs, fixed error state, and logs contain no applicant name, phone, organization, or free text.
- Registered the new event/aggregate/notification/source/task enum values, config task/queue, generated Payload types, migration index, and closed-enum regression expectations.
- Preserved the existing supply notification task and queue; its config test now accepts the additional independent auto-run queue.

## TDD Evidence

Initial RED, captured before production edits:

```text
npx -y node@22 node_modules/vitest/vitest.mjs run tests/city-partner-notify.test.ts
```

The suite failed to collect because `application-notify` did not exist. The tests already covered create-only/after-commit behavior, enqueue failure isolation, recipient city scope, ADM fallback, idempotency, retry state, PII boundaries, task registration, and migration values.

A later boundary RED proved that a fixed one-page role query missed readable roles after row 100 (`expected [1,2], received [undefined]`). The minimal fix added deterministic, validated role pagination matching the existing supply-notification fail-closed convention. Focused GREEN after this fix: 2 files, 27/27 tests.

## Migration and Local Database Evidence

- Dry-run: 47 migrations inspected, 0 blocking findings, 2 pre-existing Location type warnings.
- Apply: `20260813_022000_city_partner_notification_jobs` applied successfully in 3 ms.
- Status: 47 code migrations, 47 applied, 0 pending.
- Verify: 183 checks, 0 failures, 19 warnings. Warnings are the repository's existing/manual-migration missing-JSON convention, including this explicit enum-only migration.
- Post-query confirmed all six required enum registrations:
  - `city-partner-application.created`
  - aggregate/source `city-partner-application`
  - notification `city-partner-application-created`
  - job/log task `notify-city-partner-application-created`
- Post-query counts were applications 0, domain events 0, notifications 0, jobs 0. No persistent test data remained.
- `migrate-status.ts` printed the complete successful result but retained an open Payload database handle; after recording 47/47/0, the read-only process was terminated. The migration command itself and independent verification/post-query exited normally.

## Verification

- Focused city-partner + supply notification suite: 2 files, 27/27 passed.
- Relevant Task 1/2/3 domain, access, migration, public API, and notification suite: 8 files, 90/90 passed.
- Closed-enum/migration regression after updating new expected values: 2 files, 67/67 passed.
- Full unit suite: 196 files passed, 1 database integration file skipped; 2851 tests passed, 2 skipped.
- Node 22 `tsc --noEmit`: exit 0, no diagnostics.
- Targeted ESLint: 0 errors; 2 expected warnings that migration files are ignored by repository ESLint configuration.
- `git diff --check`: exit 0.

## Scope and Concerns

- The producer intentionally defers queue creation because Payload 3.86 Collection post-hooks still execute before the outer Local API transaction commits. The independent read prevents pre-commit enqueue, and both enqueue and delivery failures are isolated from the committed public response. A process terminating in the narrow interval between commit and the deferred callback leaves the durable domain event for operational reconciliation but cannot roll back or corrupt the application.
- Recipient fan-out remains capped at 50 and sorted by user ID, consistent with the existing notification safety cap. Role discovery itself is fully paginated so the fallback decision cannot be made from a truncated role set.
- No plan/ledger edits, deployment, push, production action, or schema changes beyond the required enum/task registration were performed.

## Fix Round 1 (2026-08-13): Durable Outbox Recovery

### Review fix

- Added the scheduled `reconcile-city-partner-notification-outbox` Payload task. Every 30 seconds the existing city-partner queue's `autoRun` scheduler creates/runs this durable task; restart recovery therefore comes from persisted task scheduling and durable domain events, not the producer's one-time best-effort callback.
- The reconciler performs one deterministic, capped scan of at most 50 unprocessed `city-partner-application.created` events, sorted by `occurredAt,id`. It validates event/application existence, then idempotently ensures an active `notify-city-partner-application-created` job exists.
- A PostgreSQL partial unique index on `payload_jobs(task_slug, input->>'eventId')`, limited to non-completed/non-terminal-error notify jobs, makes concurrent scans persist exactly one active job. A `23505` is accepted only after an independent exact active-job read proves the winner.
- The reconciler never marks the domain event processed. Only successful notification delivery does so. Queue failure and consumer failure therefore leave the durable event eligible for later scans; terminal failed jobs no longer suppress recovery.
- The original deferred callback remains a latency optimization, but now calls the same idempotent queue helper. Correctness and restart recovery no longer depend on that callback running.

### TDD evidence

- RED: 4 new outbox tests failed because `reconcileCityPartnerNotificationOutbox` did not exist. They covered post-commit recovery after an initial invisible read, repeated/concurrent scans, transient queue failure, PII-free job input, and one capped/stable scan.
- A migration behavior test then failed against the generated artifact because it repeated the already-applied 022000 enum additions and lacked active-event uniqueness. The corrected migration test proves only reconciler schema/task additions remain and down preserves all 022000 enums.
- Focused city-partner plus supply notification suite: 2 files, 32/32 passed.
- Relevant Task 1/2/3 and migration suite: 10 files, 162/162 passed.
- Full unit suite: 196 files passed, 2 database files skipped; 2856 tests passed, 3 skipped.
- Real PostgreSQL outbox integration: 1/1 passed. It created an isolated application/event, removed the hook's opportunistic job, ran two independent reconciler scans concurrently, and proved exactly one active identifier-only notification job persisted while the event remained unprocessed. Cleanup post-query showed 0 matching applications, events, and notify jobs.
- Node 22 TypeScript passed. Targeted ESLint reported 0 errors and one expected generated-types ignore warning. `git diff --check` passed.

### Generated migration correction and database evidence

- Payload 3.86 generated `20260813_060037_city_partner_notification_outbox_reconciler.ts` plus its schema JSON. The generated snapshot predated the applied 022000 enum-only migration, so its raw SQL incorrectly attempted to add the city-partner event/notification/notify-task enums again and its down would remove them.
- The TypeScript migration was minimally corrected: delete only those duplicate 022000 additions/removals; retain generated `payload_jobs_stats`, `payload_jobs.meta`, and reconcile task enum changes; add the verified partial unique index. Down first drops the index, then generated schema, and recreates task enums while retaining `notify-city-partner-application-created`.
- Dry-run: 48 migrations, 0 blocking findings, 2 historical Location warnings.
- Initial up succeeded in 14 ms. Real down removed only job-stats/meta/index/reconcile enum and post-query proved 022000 event, notification, and notify-task enums remained. Real re-up succeeded in 14 ms.
- Final status: 48 code, 48 applied, 0 pending. Verify: 186 checks, 0 failures, 19 repository warnings. Post-query proved job-stats, meta, partial index, and reconcile enum exist; business event/job counts remained 0.

No plan/ledger edit, deployment, push, production action, or persistent test data was performed.

## Fix Round 2 (2026-08-13): Stale Processing Lease Recovery

### Review fix and runtime mechanism

- Added an explicit 15-minute processing lease for the two city-partner jobs. The threshold is substantially longer than the notification task's five-attempt exponential retry window and avoids taking a legitimately long but fresh worker.
- Payload 3.86 source inspection established the correct independent recovery entry: `jobs.autoRun(payload)` is evaluated only when crons initialize, while `jobs.shouldAutoRun(payload)` is evaluated in every cron callback after scheduling and before `jobs.run`. The lease reaper therefore runs from `shouldAutoRun`; it does not require a stuck notify/reconcile job to start, and it still runs when there are no new applications. `PAYLOAD_DISABLE_JOB_AUTORUN=1` remains fail-closed and performs no recovery write.
- The reaper uses one parameterized PostgreSQL `UPDATE payload_jobs ... WHERE ... RETURNING id`. Its predicates restrict recovery to this queue, notify/reconcile task slugs, `processing=true`, incomplete/nonterminal jobs, and `updated_at <= cutoff`. The condition and update are atomic, so a fresh worker cannot be claimed and concurrent reapers cannot both claim the same lease.
- Recovery changes only `processing=false` and refreshes `updated_at`; task input, retry count, error state, wait time, and the Fix Round 1 partial unique-index identity are preserved. Payload autoRun can immediately run the released notify job or schedule/run a replacement reconciler.

### TDD and PostgreSQL evidence

- Initial RED: 2 tests failed because the lease recovery function did not exist and cron preflight still returned synchronous `true` without a recovery query.
- An initial Local API bulk-update implementation passed unit tests but failed real PostgreSQL concurrency: two concurrent reapers both reported the same stale job, total recovered 2 instead of 1. A new raw-SQL contract RED replaced it; the atomic parameterized update then passed.
- Focused city-partner plus supply notification suite: 2 files, 34/34 passed.
- Relevant Task 1/2/3 and migration suite: 10 files, 164/164 passed.
- Full unit suite: 196 files passed, 2 database files skipped; 2858 tests passed, 4 skipped.
- Real PostgreSQL suite: 2/2 passed. It proves two concurrent reapers recover one stale notify job exactly once, preserve a fresh processing reconciler, and retains the previous concurrent outbox recovery proof. Cleanup post-query found 0 lease/outbox jobs.
- Node 22 TypeScript, targeted ESLint, and `git diff --check`: exit 0.

No schema or migration change was needed. No plan/ledger edit, deployment, push, production action, or persistent test data was performed.
