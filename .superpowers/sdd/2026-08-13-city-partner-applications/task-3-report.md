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
