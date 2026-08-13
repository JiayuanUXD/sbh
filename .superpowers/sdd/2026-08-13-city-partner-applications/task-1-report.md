# Task 1 Report: City Partner Application Pool

## Status

Complete. A dedicated `city-partner-applications` pool now owns applicant facts and workflow state without creating or reusing leads, supply submissions, merchants, teams, users, brokers, buildings, listings, or public content.

## Implementation

- Added closed applicant-identity, resource-type, and workflow-status enums plus the exact forward-only transition graph. Terminal states have no outgoing transitions.
- Added a standalone Payload Collection with four explicit field groups: stage-one applicant facts, one-time stage-two facts, admin workflow, and source/consent metadata. Collection-level public create/delete are closed; applicant facts are immutable outside the trusted server-owned stage context; workflow mutations require `city_partner_application:manage` and are recorded through Payload versions.
- Added read/manage access that requires the operation permission and authoritative request-derived city scope. ADM with global scope is unrestricted; OPS/MGR return a city predicate; missing or empty scope fails closed.
- Added `contactPhone` masking through the existing server-side field-mask hook. Only `phone:full` (or wildcard) preserves the full value.
- Added menu and operation permission codes, OPS/MGR fixture grants, navigation under `商户合作`, and a pending-count badge. The badge requires the same menu/read permission boundary and applies the same city scope.
- Registered the Collection and regenerated Payload types.
- Generated and renamed the schema migration to `20260813_020000_city_partner_applications.{ts,json}`. The initial generated body was preserved for Task 1; Fix Round 1 records the independently reproduced rollback defect and narrow correction below. Added the idempotent `20260813_021000_city_partner_permissions.ts` migration, which validates the exact built-in role set before granting OPS/MGR only.

## Controller Correction

The task brief said to preserve a “six built-in role” invariant, while the complete plan and repository define exactly five roles: ADM, OPS, MGR, BRK, and CSR. The controller confirmed that “six” was a typo meaning no sixth role may be created. Implementation and migration therefore preserve the exact five-role invariant.

## TDD Evidence

All commands used the Node 22 / pnpm 8.6.1 wrapper.

Initial RED command:

```text
pnpm exec vitest run tests/city-partner-domain.test.ts tests/city-partner-access.test.ts tests/city-partner-migration.test.ts tests/permission-codes.test.ts tests/permission-matrix.test.ts tests/admin-navigation-config.test.ts tests/admin-navigation-badges.test.ts
```

Before production edits, all 7 files failed: the domain, Collection, and migration modules did not exist; permission registry/role grants, navigation leaf, and badge behavior were absent. The suite reported 5 failed assertions, 100 existing assertions passed, and 3 suites could not collect tests because their new modules were missing.

After implementation, the same focused suite passed: 7 files, 116/116 tests.

## Local Test Database Migration Evidence

- `pnpm migrate:dry-run`: 46 migrations, 0 blocking findings; 2 warnings were pre-existing historical geo migration warnings.
- `pnpm exec payload migrate`: schema migration applied in 98 ms and permission migration in 4 ms.
- `pnpm migrate:status`: code 46, applied 46, pending 0.
- `pnpm migrate:verify`: 180 checks, 0 failures, 18 warnings. Warnings were historical missing snapshots plus the expected no-JSON warning for the hand-written permission migration.
- Read-only post-query invariants:
  - `city_partner_applications` exists and contains 0 rows.
  - city, status, created-at, and unique idempotency-key indexes exist.
  - built-in role count remains exactly 5.
  - ADM retains wildcard menu/operation grants.
  - OPS and MGR contain the city-partner menu plus read/manage operations.
  - BRK and CSR contain no city-partner grant.

No production database, migration, deployment, or push action was performed.

## Verification

- Focused Task 1 suite: 7 files, 116/116 passed.
- Broader permission/navigation/migration regression suite: 11 files, 165/165 passed.
- Migration-count and role-navigation follow-up suite: 2 files, 31/31 passed.
- Full unit suite: 192 files, 2790/2790 passed.
- `pnpm generate:types`: exit 0.
- `pnpm typecheck`: exit 0, no diagnostics.
- Targeted ESLint: 0 errors; three migration files were skipped by the repository ignore rules and reported as warnings only.
- Initial `git diff --check`: the only findings were whitespace emitted by Payload in the generated schema migration; all other changed files were clean. Fix Round 1 mechanically normalizes that generated whitespace and records a clean rerun below.

## Concerns and Follow-up

- Task 1 intentionally exposes no public API. The trusted stage-one/stage-two services, request validation, idempotent exact-retry behavior, and public rate limits belong to Task 2.
- Workflow history uses Payload document versions (maximum 50 per application). Physical deletion remains closed, preserving the application and its retained workflow versions.
- The local test database now has both Task 1 migrations applied, as authorized. The schema migration inserted no application data and the permission migration preserved all five built-in roles.

## Fix Round 1 (2026-08-13)

### Changes

- Workflow updates now derive a fresh permission context and enforce both `city_partner_application:manage` and membership of `originalDoc.city`. Only global ADM bypasses the city-membership check; `overrideAccess: true` cannot bypass it. Trusted stage-one/stage-two branches remain separate and are not mistaken for admin workflow writes.
- Extracted one city-partner-specific city-scope predicate and reused it for Collection access and the pending badge. MGR's general `dataScope: team` no longer incorrectly makes the city-partner badge `NO_MATCH`; both paths use the authoritative city IDs only.
- Trusted stage-two writes now require a non-empty server-owned `detailsCompletedAt` and nonblank `detailsFingerprint`, while still rejecting an already-completed record. Task 2 must enforce the one-time completion atomically with a transaction or conditional write to close concurrent races; Task 1 does not expand into that service/API work.
- Reproduced the generated schema migration rollback defect on the authorized local test database. `DROP TABLE city_partner_applications CASCADE` removed the locked-document FK, so the later explicit `DROP CONSTRAINT` failed. The narrow correction moves that FK drop before the cascade. The rest of the generated SQL semantics are unchanged; tabs/trailing whitespace were mechanically normalized so `git diff --check` is clean.

### TDD and Verification Evidence

- RED focused suite: 4 files, 29 tests; 25 passed and 4 failed for the four intended missing behaviors: stage-two marker validation, workflow city enforcement under override access, shared MGR badge scope, and migration FK-drop ordering.
- GREEN focused suite: 4 files, 29/29 passed.
- Broader access/navigation/migration regression suite: 13 files, 200/200 passed.
- Full unit suite: 192 files, 2794/2794 passed.
- `pnpm typecheck`: exit 0, no diagnostics.
- Targeted ESLint: exit 0, no diagnostics.
- `git diff --check`: exit 0 after mechanical generated-file whitespace cleanup.

### Local Database Rollback/Forward Evidence

- The uncorrected generated down migration failed exactly at `payload_locked_documents_rels_city_partner_applications_fk` because the preceding table cascade had already removed it; Payload rolled the transaction back.
- Corrected `migrate:down`: succeeded, schema down in 16 ms. Intermediate status showed 44 applied and the two Task 1 migrations pending.
- Dry-run before forward apply: 46 migrations, 0 blocking findings, the same 2 historical geo warnings.
- Forward apply: schema migration 119 ms, permission migration 5 ms.
- Final status: 46 applied, 0 pending.
- Final verifier: 180 checks, 0 failures, 18 historical/manual-migration snapshot warnings.
- Final post-query invariants: application table exists with 0 rows; city/status/created-at/unique-idempotency indexes exist; built-in role count remains 5; ADM remains wildcard; OPS/MGR retain the exact new grants; BRK/CSR retain none.
