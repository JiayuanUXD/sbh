// OPT-038 Task 3 验证脚本（与证据 task3-form-states.json 同目录，随证据提交）：
// 在 dev server 上拦截两个提交端点，走完「第一步 → 第二步 → 完成」三态，
// 逐态导出计算样式与盒模型。dev-story 预览页在 next start 下**按设计 404**，
// 所以这里显式打 dev server，并在第一步就**真读 HTTP 状态码**——不是 200 直接抛，
// 避免「拿两张 404 页比出 0 差异」那类空结论。
//
// 跑法（先在 payload-office-platform 里起 dev server，端口避开 3717）：
//   pnpm exec next dev -p 3719
//   node --experimental-... 无需；直接：
//   cd payload-office-platform && node ../artifacts/verification/OPT-038/task3-form-states-probe.mjs
// （必须从 payload-office-platform 目录跑，@playwright/test 在那里的 node_modules。）
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3719'
const PATH = '/dev-story/opt038'
const OUT = process.env.PROBE_OUT ?? './task3-form-states.json'

const cs = `(el, props) => { const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s[p]; return o }`

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const calls = []
  await page.route('**/api/city-partner-applications', async (route) => {
    calls.push({ path: '/create', body: route.request().postDataJSON() })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/api/city-partner-applications/details', async (route) => {
    calls.push({ path: '/details', body: route.request().postDataJSON() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  const response = await page.goto(BASE + PATH, { waitUntil: 'networkidle' })
  const httpStatus = response?.status()
  if (httpStatus !== 200) throw new Error(`预览页 HTTP ${httpStatus}（期望 200）——环境不对，测出来的一切都不算数`)

  const scope = '#rc-core '
  const measure = (label) => page.evaluate(({ scope, csSrc }) => {
    const cs = eval(csSrc)
    const q = (s) => document.querySelector(s)
    const form = q(scope + 'form.city-partner-form') || q(scope + '.city-partner-form__success')
    const box = form.getBoundingClientRect()
    const out = {
      root: form.className,
      rect: { w: Math.round(box.width), h: Math.round(box.height) },
      surface: cs(form, ['backgroundColor', 'borderTopWidth', 'borderRadius', 'padding', 'boxShadow', 'display', 'gap']),
      heading: form.querySelector('h2') ? { text: form.querySelector('h2').textContent, ...cs(form.querySelector('h2'), ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'margin']) } : null,
      statusRoleCount: document.querySelectorAll('[role="status"]').length,
      h1Count: document.querySelectorAll('h1').length,
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      asideRect: (() => { const a = q(scope + '.rc-aside'); const r = a.getBoundingClientRect(); return { w: Math.round(r.w ?? r.width), h: Math.round(r.height) } })(),
      asidePosition: cs(q(scope + '.rc-aside'), ['position', 'top']),
    }
    const checks = q(scope + '.city-partner-form__checks')
    if (checks) {
      out.checks = {
        grid: cs(checks, ['gridTemplateColumns', 'gap']),
        labels: [...checks.querySelectorAll('label')].map((l) => ({
          text: l.textContent.trim(),
          w: Math.round(l.getBoundingClientRect().width),
          h: Math.round(l.getBoundingClientRect().height),
          lines: l.getClientRects().length,
          ...cs(l, ['borderRadius', 'padding', 'fontSize']),
        })),
      }
    }
    const ta = q('#partner-experience')
    if (ta) out.textarea = cs(ta, ['height', 'padding', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'fontSize', 'lineHeight'])
    const skip = [...document.querySelectorAll(scope + 'button')].find((b) => b.textContent.includes('暂不补充'))
    if (skip) out.skip = { text: skip.textContent, ...cs(skip, ['minHeight', 'padding', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'fontSize', 'fontWeight', 'color', 'backgroundColor']) }
    const cta = form.querySelector('.btn--primary')
    if (cta) out.cta = { text: cta.textContent, ...cs(cta, ['height', 'borderRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'padding', 'width']) }
    return out
  }, { scope, csSrc: cs }).then((data) => ({ label, ...data }))

  const states = {}
  states.stageOne = await measure('第一步 · 必填')

  await page.getByLabel('姓名').fill('预览申请人')
  await page.getByLabel('手机号').fill('13800001111')
  await page.getByLabel('合作身份').selectOption('local-operations')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.getByRole('heading', { name: '补充合作信息（可选）' }).waitFor()
  states.stageTwo = await measure('第二步 · 可选')

  await page.getByLabel('本地运营团队').check()
  await page.getByRole('button', { name: '提交补充信息' }).click()
  await page.getByText('申请已收到').waitFor()
  states.complete = await measure('提交成功')

  mkdirSync(new URL(OUT.replace(/[^/]+$/, ''), import.meta.url), { recursive: true })
  writeFileSync(new URL(OUT, import.meta.url), JSON.stringify({ base: BASE, path: PATH, httpStatus, calls, states }, null, 2))
  console.log(JSON.stringify({ httpStatus, callPaths: calls.map((c) => c.path), states }, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
