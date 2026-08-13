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
- Generated and renamed the schema migration to `20260813_020000_city_partner_applications.{ts,json}` without editing the generated body. Added the idempotent `20260813_021000_city_partner_permissions.ts` migration, which validates the exact built-in role set before granting OPS/MGR only.

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
- `git diff --check`: exit 0.

## Concerns and Follow-up

- Task 1 intentionally exposes no public API. The trusted stage-one/stage-two services, request validation, idempotent exact-retry behavior, and public rate limits belong to Task 2.
- Workflow history uses Payload document versions (maximum 50 per application). Physical deletion remains closed, preserving the application and its retained workflow versions.
- The local test database now has both Task 1 migrations applied, as authorized. The schema migration inserted no application data and the permission migration preserved all five built-in roles.
