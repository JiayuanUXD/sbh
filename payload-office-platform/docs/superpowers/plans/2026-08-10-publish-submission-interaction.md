# Publish Submission Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `/publish` submission feedback so users understand validation failures, temporary failures, retry options, and the successful next step.

**Architecture:** Keep the current single-card `SupplySubmissionForm` client component. Add a small typed error/status layer inside the component module, reuse existing `Field`, `Input`, `Select`, and `Button` primitives, and keep `/api/supply-submissions` unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Payload CMS public API route, Vitest, Playwright.

## Global Constraints

- Use pnpm only.
- Keep Node environment unchanged.
- Do not modify `/api/supply-submissions`, collections, migrations, or Payload permissions for this task.
- Use card-internal enhanced state only; do not add Toast, Modal, global notification, or result route.
- Success state has one primary action: `返回首页`, linking to `/`.
- Copy must be user-friendly and avoid product/developer wording.
- Failed submissions keep all user-entered form values.
- Do not expose phone, building name, address, requestId, backend exception message, or internal record ID in analytics or UI errors.
- Real API 500 caused by missing local migrations is out of scope; document it as a remaining verification blocker.

---

## File Structure

- Modify `src/components/frontend/landing/SupplySubmissionForm.tsx`: add typed form error reasons, user-friendly message helpers, focus management, status region, success return-home action, and adjusted button labels.
- Modify `tests/supply-submission-form.test.ts`: cover new error mapping, retry labels, success action markup, focus helper behavior, and privacy constraints.
- Modify `tests/e2e/landing-pages.spec.ts`: add browser coverage for focus, mocked API failure states, success return-home action, and existing viewport checks.
- Modify `src/app/(frontend)/styles.css` only if existing classes cannot support a readable inline status region and success action spacing.
- Read-only reference `docs/superpowers/specs/2026-08-10-publish-submission-interaction-design.md`: source of approved behavior.

## Task 1: Status Model And Copy

**Files:**
- Modify: `src/components/frontend/landing/SupplySubmissionForm.tsx`
- Test: `tests/supply-submission-form.test.ts`

**Interfaces:**
- Produces: `SupplyFormErrorReason`, `getSupplyStatusMessage(state)`, `getSupplySubmitLabel(state)`, `getFirstSupplyErrorField(errors)`.
- Consumes: existing `SupplyFormState`, `SupplyFieldErrors`, `SupplySubmissionResult`.

- [ ] **Step 1: Add failing unit tests for error reason and labels**

Add tests in `tests/supply-submission-form.test.ts` that assert:

```ts
expect(getSupplySubmitLabel({ status: 'idle', fieldErrors: {}, formError: null })).toBe('立即投放')
expect(getSupplySubmitLabel({ status: 'submitting', fieldErrors: {}, formError: null })).toBe('提交中...')
expect(getSupplySubmitLabel({
  status: 'error',
  fieldErrors: {},
  formError: '刚才提交得有点频繁，请稍后再试。',
  errorReason: 'rate_limited',
})).toBe('稍后重试')
```

Run:

```bash
pnpm test -- tests/supply-submission-form.test.ts
```

Expected before implementation: TypeScript compile failure or failed assertions because `errorReason`, `getSupplySubmitLabel`, and status messages do not exist.

- [ ] **Step 2: Extend state type and message helpers**

In `SupplySubmissionForm.tsx`, update `SupplyFormState` to include:

```ts
export type SupplyFormErrorReason =
  | 'client_validation'
  | 'server_validation'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'

export type SupplyFormState = Readonly<{
  status: 'idle' | 'submitting' | 'success' | 'error'
  fieldErrors: SupplyFieldErrors
  formError: string | null
  errorReason: SupplyFormErrorReason | null
}>
```

Set `INITIAL_STATE.errorReason = null`.

Add:

```ts
const SUBMIT_LABELS: Record<SupplyFormState['status'], string> = {
  idle: PUBLISH_COPY.submit,
  submitting: '提交中...',
  success: PUBLISH_COPY.submit,
  error: '重新提交',
}

export function getSupplySubmitLabel(state: SupplyFormState): string {
  if (state.status === 'error' && state.errorReason === 'rate_limited') return '稍后重试'
  return SUBMIT_LABELS[state.status]
}

export function getSupplyStatusMessage(state: SupplyFormState): string | null {
  if (state.status === 'submitting') return '正在提交，我们会为您保留已填写的信息。'
  return state.formError
}

export function getFirstSupplyErrorField(
  errors: SupplyFieldErrors,
): keyof SupplyFieldErrors | null {
  for (const field of ['buildingName', 'address', 'areaSqm', 'rentAmount', 'contactPhone'] as const) {
    if (errors[field]) return field
  }
  return null
}
```

- [ ] **Step 3: Map failures to friendly messages**

Update coordinator branches:

```ts
updateState({
  status: 'error',
  fieldErrors: clientErrors,
  formError: '还有几项信息需要补充，请检查后再提交。',
  errorReason: 'client_validation',
})
```

For API validation:

```ts
const hasFieldErrors = Object.keys(fieldErrors).length > 0
updateState({
  status: 'error',
  fieldErrors,
  formError: hasFieldErrors
    ? '有几项信息还需要调整，请检查后再提交。'
    : '暂时没有提交成功，已填写的内容还在，请稍后再试。',
  errorReason: hasFieldErrors ? 'server_validation' : 'server_error',
})
```

For rate limit:

```ts
formError: '刚才提交得有点频繁，请稍后再试。',
errorReason: 'rate_limited',
```

For network:

```ts
formError: '网络好像不太稳定，已填写的内容还在，请检查网络后再试。',
errorReason: 'network_error',
```

For server/default:

```ts
formError: '暂时没有提交成功，已填写的内容还在，请稍后再试。',
errorReason: 'server_error',
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm test -- tests/supply-submission-form.test.ts
```

Expected: status helper and existing request-boundary tests pass.

## Task 2: Component Rendering And Focus

**Files:**
- Modify: `src/components/frontend/landing/SupplySubmissionForm.tsx`
- Optionally modify: `src/app/(frontend)/styles.css`
- Test: `tests/supply-submission-form.test.ts`

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces: rendered status region, success card with return-home link, first-error focus behavior.

- [ ] **Step 1: Add refs for focus targets**

Inside `SupplySubmissionForm`, create refs:

```ts
const successRef = useRef<HTMLDivElement>(null)
const fieldRefs = {
  buildingName: useRef<HTMLInputElement>(null),
  address: useRef<HTMLInputElement>(null),
  areaSqm: useRef<HTMLInputElement>(null),
  rentAmount: useRef<HTMLInputElement>(null),
  contactPhone: useRef<HTMLInputElement>(null),
} as const
```

Import `useEffect` and `useRef` from React.

- [ ] **Step 2: Focus first invalid field and success card**

Add:

```ts
useEffect(() => {
  if (formState.status === 'success') {
    successRef.current?.focus()
    return
  }
  if (formState.status !== 'error') return
  const firstErrorField = getFirstSupplyErrorField(formState.fieldErrors)
  if (!firstErrorField) return
  fieldRefs[firstErrorField].current?.focus()
}, [formState])
```

- [ ] **Step 3: Attach refs to inputs**

Pass `ref={fieldRefs.buildingName}`, `ref={fieldRefs.address}`, `ref={fieldRefs.areaSqm}`, `ref={fieldRefs.rentAmount}`, and `ref={fieldRefs.contactPhone}` to the matching `Input` or `AreaInput`.

If `AreaInput` currently does not forward refs, convert it to:

```ts
const AreaInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function AreaInput(props, ref) {
    return (
      <span className="input-suffix">
        <Input {...props} ref={ref} />
        <span className="input-suffix__unit" aria-hidden="true">㎡</span>
      </span>
    )
  },
)
```

- [ ] **Step 4: Render status region**

Before `.publish-card__actions`, render:

```tsx
const statusMessage = getSupplyStatusMessage(formState)

{statusMessage ? (
  <div
    className="publish-card__status"
    role={formState.status === 'error' ? 'alert' : 'status'}
    aria-live={formState.status === 'error' ? 'assertive' : 'polite'}
  >
    {statusMessage}
  </div>
) : null}
```

Update the button:

```tsx
<Button type="submit" variant="primary" loading={formState.status === 'submitting'}>
  {getSupplySubmitLabel(formState)}
</Button>
```

- [ ] **Step 5: Update success card**

Render:

```tsx
<div className="publish-card" role="status" aria-live="polite" tabIndex={-1} ref={successRef}>
  <h2 className="publish-card__title">{PUBLISH_COPY.successTitle}</h2>
  <p className="publish-card__footer">{PUBLISH_COPY.successBody}</p>
  <div className="publish-card__actions">
    <Button as="link" href="/" variant="primary">
      返回首页
    </Button>
  </div>
</div>
```

- [ ] **Step 6: Add or reuse styles**

If `publish-card__status` is not already styled, add minimal CSS to `src/app/(frontend)/styles.css` near existing `.publish-card` rules:

```css
.publish-card__status {
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  color: var(--color-text);
  padding: 12px 14px;
  font-size: 0.92rem;
  line-height: 1.6;
}
```

If those CSS variables are not present, use the existing frontend palette variables from the file.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm test -- tests/supply-submission-form.test.ts
```

Expected: all form tests pass.

## Task 3: Browser Tests And Verification

**Files:**
- Modify: `tests/e2e/landing-pages.spec.ts`
- Verify: `src/components/frontend/landing/SupplySubmissionForm.tsx`

**Interfaces:**
- Consumes: rendered messages, success link, preserved form state.
- Produces: Playwright coverage for approved interaction.

- [ ] **Step 1: Add mocked API failure tests**

In `/publish 投放房源`, add route-based tests:

```ts
test('API 500 时保留内容并提示稍后再试', async ({ page }) => {
  await page.route('**/api/supply-submissions', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) }),
  )
  await page.goto('/publish')
  await page.getByLabel('楼盘名称').fill('失败测试楼盘')
  await page.getByLabel('详细地址').fill('上海市静安区测试路 1 号')
  await page.getByLabel('出租面积').fill('200')
  await page.getByLabel('手机号').fill(publishPhone)
  await page.getByRole('button', { name: '立即投放' }).click()

  await expect(page.getByRole('alert')).toContainText('暂时没有提交成功')
  await expect(page.getByLabel('楼盘名称')).toHaveValue('失败测试楼盘')
  await expect(page.getByRole('button', { name: '重新提交' })).toBeVisible()
})
```

Add analogous tests for 422 and 429 using expected messages from the spec.

- [ ] **Step 2: Update success test**

For the success path, either use real API after migrations or route fulfillment for interaction-only coverage:

```ts
await page.route('**/api/supply-submissions', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
)
```

Then assert:

```ts
await expect(page.getByRole('status')).toContainText('已收到您的房源')
await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible()
await expect(page.getByRole('status')).toBeFocused()
await page.getByRole('link', { name: '返回首页' }).click()
await expect(page).toHaveURL(/\/$/)
```

- [ ] **Step 3: Verify no PII in analytics**

Keep existing serialized analytics checks:

```ts
expect(serializedEvents).not.toContain(publishPhone)
expect(serializedEvents).not.toContain(buildingName)
expect(serializedEvents).not.toContain(address)
```

Also assert it does not contain `requestId` if the capture exposes event payloads.

- [ ] **Step 4: Run checks**

Run:

```bash
pnpm test -- tests/supply-submission-form.test.ts
PLAYWRIGHT_SERVER_URL=http://localhost:3717/publish pnpm exec playwright test tests/e2e/landing-pages.spec.ts --grep "投放房源|主导航"
pnpm exec tsc --noEmit --pretty false
```

Expected:

- Unit tests pass.
- Interaction-only browser tests pass with mocked API responses.
- Real API success may remain blocked until local migrations create `supply_submissions`.
- TypeScript passes.

## Self-Review

- Spec coverage: plan covers方案 A, friendly copy, preserved values, success return-home action, no countdown lock, privacy, and API/migration non-goals.
- Placeholder scan: no pending placeholders or deferred behavior.
- Type consistency: `SupplyFormState.errorReason`, helper names, and expected E2E messages are defined before use.
