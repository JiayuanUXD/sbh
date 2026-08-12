# Multi-City Frontend Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved seven-city frontend architecture, including city-scoped catalog data, reversible URL migration, existing demand/supply city attribution, and an independent city-partner application flow.

**Architecture:** The work is split into four independently reviewable plans. City Profile and resolver foundations land first; Public Catalog city isolation lands second; City Partner applications and frontend routing then consume those stable interfaces. Shared database migrations, generated types, and routing resources are serialized.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, Payload CMS 3.86, PostgreSQL, TypeScript 5.9, Vitest 4.1, Playwright 1.61, pnpm 8.6.1 on Node.js 22.

## Global Constraints

- Package manager is pnpm 8.6.1; run commands under Node.js 22.x.
- Use Server Components by default; Client Components only for interactive controls and forms.
- Public pages consume Public Catalog DTOs, never raw Payload documents.
- `SearchContext.city` is required; no city-scoped query may fail open to nationwide data.
- Public supply consumers reuse the single effective-supply service without weakening predicates.
- All Collection, field, relationship, unique-index, and permission changes require explicit migrations.
- Migration sequence is expand → backfill → verify → switch; production apply remains a separate approval.
- Imported Locations stay `frontendVisible=false` unless operations explicitly publishes individual nodes.
- Coming-soon pages never borrow another city's inventory and return `noindex,follow`.
- Entrust remains two-stage; Supply Submission remains an independent manual-review pool.
- City Partner Applications form a third independent pool and never auto-create Merchant, Team, User, Broker, Building, Listing, or public content.
- Public writes require schema validation, same-origin/CSRF, persistent idempotency, shared rate limiting, privacy version, and hashed IP only.
- Do not log or emit PII in responses, notifications, analytics, screenshots, or verification artifacts.
- Visual implementation keeps the approved existing frontend tokens and validates WCAG 2.2 AA at 375×812, 768×1024, 1440×900, and 1920×1080.
- Do not modify production data, deploy, push, or promote 307 redirects to 308 without separate user approval.

---

## Plan Set and Dependency Order

1. [City Foundation and Profiles](./2026-08-13-city-foundation-and-profiles.md)
   - Produces `CityContext`, `resolveCityContext`, City Site Profile schema, migrations, cache tags, and server-only routing flag.
2. [City-Scoped Public Catalog and Cache](./2026-08-13-city-public-catalog-and-cache.md)
   - Consumes `CityContext`; makes city mandatory in every catalog query, DTO, cache key, tag, and sitemap source.
3. [City Partner Applications](./2026-08-13-city-partner-applications.md)
   - Consumes city resolver; builds the independent Collection, API, permissions, notifications, two-stage page, and analytics.
4. [City Routing and Frontend Experience](./2026-08-13-city-routing-and-frontend-experience.md)
   - Consumes all prior interfaces; introduces prefixed routes, switcher, coming-soon page, legacy 307s, city-aware Entrust/Publish, SEO, and full E2E/browser evidence.

Plans 2 and 3 are logically independent after Plan 1, but execute them serially in a shared worktree because both regenerate Payload types and touch shared permission/config surfaces. Plan 4 runs last because it integrates the partner CTA and all canonical routes.

## Spec Coverage Map

| Approved spec section | Implemented by |
|---|---|
| §1–§5 context, profile model, slug freeze, initial seven-city data | Plan 1 Tasks 1–4 |
| §6 route compatibility and 307/308 rules | Plan 4 Tasks 1 and 3 |
| §7 city switcher and filter preservation | Plan 4 Tasks 1–2 |
| §8 live, coming-soon, and error states | Plan 4 Task 3 |
| §9 required city, DTO identity, cache factories, runtime cost | Plan 2 Tasks 1–4; Plan 4 Task 5 build baseline |
| §10 metadata, robots, canonical, sitemap | Plan 2 Task 4; Plan 4 Task 5 |
| §11.1–§11.3 Entrust/Publish city attribution | Plan 4 Task 4 |
| §11.4–§11.7 City Partner pool, API, permissions, notifications, page | Plan 3 Tasks 1–4 |
| §12 anonymous analytics and privacy | Plan 3 Task 4; Plan 4 Task 5 |
| §13 reversible release phases | This index dependency order; Plan 4 Tasks 3, 5, and 6 |
| §14 acceptance matrix | Plan 1 Task 4; Plan 2 Task 4; Plan 3 Tasks 1–4; Plan 4 Task 6 |
| §15 risks and §17 revision decisions | Corresponding task tests plus Gates A–F |

Self-review result: every approved requirement maps to at least one task; no implementation requirement is deferred outside this plan set. Gate F is intentionally a separately authorized production decision, not an implementation gap.

## Shared Task Packet and Evidence Convention

Each plan file is its Task Packet. Update its checkboxes only after the referenced command passes. Store long logs and screenshots outside git under:

```text
payload-office-platform/test-results/multi-city/MCF-01-foundation/
payload-office-platform/test-results/multi-city/MCF-02-catalog/
payload-office-platform/test-results/multi-city/MCF-03-partner/
payload-office-platform/test-results/multi-city/MCF-04-routing/
```

For every task commit, record in the plan footer:

Record five concrete lines: commit SHA/subject; exact test commands/pass counts; migration dry-run/apply/verify counts; browser routes/viewports/console result; and a specific remaining risk or the word `none`.

## Cross-Plan Release Gates

- [x] **Gate A — foundation:** PostgreSQL has exactly seven valid City Site Profiles, one per canonical city; resolver and slug freeze tests pass.
- [ ] **Gate B — isolation:** all catalog consumers compile with required city; cross-city cache-hit tests prove no Shanghai records appear in another city.
- [ ] **Gate C — application safety:** all three application flows persist server-resolved city; partner permissions, idempotency, notification fallback, and no-auto-conversion tests pass.
- [ ] **Gate D — reversible routing:** `MULTI_CITY_ROUTING_ENABLED=false` preserves old canonical URLs; `true` uses page-level 307s and prefixed canonical URLs.
- [ ] **Gate E — release candidate:** generated types, typecheck, full Vitest, webpack production build, PostgreSQL migration verification, E2E matrix, four-viewpoint browser review, and clean git status all pass.
- [ ] **Gate F — separate approval:** only after an observation cycle may `/`, `/listings`, and `/buildings` static mappings be promoted from 307 to 308 and the kill switch removed.
