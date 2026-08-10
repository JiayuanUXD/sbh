# LandingHero Full-Bleed Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared landing hero full-bleed and give `/publish` and `/entrust` separate COS-hosted background images.

**Architecture:** Add a small background image prop to `LandingHero`, keep the content container unchanged, and apply full-bleed CSS at the shared component layer. Store generated image assets in COS under the existing `media` prefix and reference them through Payload's existing media file route.

**Tech Stack:** Next.js 16 App Router, React 19, Payload CMS media file route, Tencent COS via S3-compatible storage, Vitest, Playwright.

## Global Constraints

- Node environment does not change.
- Package manager remains `pnpm`.
- Do not introduce shadcn-ui, Tailwind reset, global third-party reset, S3/SEO plugins, or a new visual system.
- `/publish` and `/entrust` must use separate background image files.
- Background image must not contain text, logo, watermark, or identifiable private information.
- Do not commit, push, or create PR without user confirmation.

---

### Task 1: Lock hero background contract with tests

**Files:**
- Modify: `tests/publish-page.test.ts`
- Create: `tests/landing-hero-layout.test.ts`

**Interfaces:**
- Consumes: `PublishPage`, `EntrustPage`, `src/app/(frontend)/styles.css`
- Produces: Failing tests that require page-specific COS URLs and full-bleed CSS.

- [ ] **Step 1: Add tests**

Add assertions that `/publish` renders `/api/media/file/landing-hero-publish-20260810.jpg?prefix=media`, `/entrust` renders `/api/media/file/landing-hero-entrust-20260810.jpg?prefix=media`, and the two URLs differ. Add a CSS static test requiring `.landing-hero` to include `width: 100vw` and `margin-inline: calc(50% - 50vw)`.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/publish-page.test.ts tests/landing-hero-layout.test.ts`

Expected: tests fail because existing `LandingHero` has no background image support and `.landing-hero` is not full-bleed.

### Task 2: Generate and upload background assets

**Files:**
- No committed source file required.

**Interfaces:**
- Produces:
  - `/api/media/file/landing-hero-publish-20260810.jpg?prefix=media`
  - `/api/media/file/landing-hero-entrust-20260810.jpg?prefix=media`

- [ ] **Step 1: Generate `/publish` image**

Use built-in image generation for a photorealistic high-end Shanghai office leasing background with no text, logo, or watermark.

- [ ] **Step 2: Generate `/entrust` image**

Use built-in image generation for a distinct consulting/office selection background with no text, logo, or watermark.

- [ ] **Step 3: Optimize and upload**

Convert each generated image to JPEG if needed, upload to COS keys:

```text
media/landing-hero-publish-20260810.jpg
media/landing-hero-entrust-20260810.jpg
```

### Task 3: Implement LandingHero background

**Files:**
- Modify: `src/components/frontend/landing/LandingHero.tsx`
- Modify: `src/app/(frontend)/publish/page.tsx`
- Modify: `src/app/(frontend)/entrust/page.tsx`
- Modify: `src/app/(frontend)/styles.css`

**Interfaces:**
- Produces: `LandingHero` prop `backgroundImage?: { src: string; alt?: string }`

- [ ] **Step 1: Implement minimal component support**

Render a decorative background image layer before `.landing-hero__inner` when `backgroundImage` is provided.

- [ ] **Step 2: Wire page-specific URLs**

Pass the `/publish` COS URL only on `PublishPage`, and the `/entrust` COS URL only on `EntrustPage`.

- [ ] **Step 3: Implement CSS**

Make `.landing-hero` full-bleed, add image cover layer and scrim, adjust text color/readability, and keep publish card z-index above the hero.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/publish-page.test.ts tests/landing-hero-layout.test.ts`

Expected: pass.

### Task 4: Regression and browser validation

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: local dev server at `http://localhost:3717`.

- [ ] **Step 1: Static verification**

Run:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

- [ ] **Step 2: Build verification**

Run: `pnpm build`

- [ ] **Step 3: Browser verification**

Validate `/publish` and `/entrust` at 375×812, 768×1024, 1440×900, and 1920×1080. Confirm no horizontal scroll and no new console errors.
