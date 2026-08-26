// OPT-038 Task 5 验收脚本（随证据提交）
//
// 打的是**生产 build 的真实路由**（`next start`），不是 dev-story 预览页——
// 那一页在 next start 下按设计 404，拿它做验收会比出「两张 404 页」。
//
// 做四件事：
//   1. 预热并**真读 HTTP 状态码**：任一路由不是期望码就直接抛，
//      避免「两侧都是 404 页比出 DOM 完全一致」那类空结论；
//   2. 四断点（375 / 768 / 1440 / 1920）× 两个消费面（/city-partner、/hangzhou）
//      逐屏截图 + 量页面级横向溢出与关键盒模型。**每次改视口后 reload 再测**——
//      不 reload 时 100vw 出血层保持旧视口宽，会读出一整套假数（工作项 §5.5.2）；
//   3. sticky 实测：1440 下滚动采样 `.rc-aside` 的 rect.top，判定粘附/释放；
//      375 下确认 `position: static`；
//   4. 表单三态（校验失败 / 提交成功 / 限流）截图 + `[role=status]` 计数。
//
// 跑法（cwd = payload-office-platform，@playwright/test 在那里的 node_modules）：
//   node ../artifacts/verification/OPT-038/task5-acceptance.mjs
// 环境变量：TASK5_BASE（默认 http://127.0.0.1:3919）、TASK5_OUT（默认脚本同目录）
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 的 import 是按**脚本自身位置**解析的，而本脚本住在 artifacts/ 下、
// @playwright/test 装在 payload-office-platform/node_modules。所以从 cwd 解析。
const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test')

const BASE = process.env.TASK5_BASE ?? 'http://127.0.0.1:3919'
const OUT = process.env.TASK5_OUT ?? dirname(fileURLToPath(import.meta.url))
const SHOTS = join(OUT, 'task5-shots')

/** 预热清单：期望状态码写死在这里，比对失败即抛。 */
const WARMUP = [
  ['/', 200],
  ['/listings', 200],
  ['/buildings', 200],
  ['/city-partner', 200],
  ['/hangzhou', 200],
  ['/admin', 200],
  ['/dev-story/opt038', 404], // 生产 build 下按设计 404
]

const BREAKPOINTS = [375, 768, 1440, 1920]
const SURFACES = [
  { key: 'city-partner', path: '/city-partner' },
  { key: 'hangzhou', path: '/hangzhou' },
]

const report = { base: BASE, warmup: [], breakpoints: [], sticky: {}, formStates: [], longCityName: {} }

async function warmup() {
  for (const [path, expected] of WARMUP) {
    const res = await fetch(BASE + path, { redirect: 'manual' })
    report.warmup.push({ path, status: res.status, expected })
    if (res.status !== expected) {
      throw new Error(`预热失败：${path} → HTTP ${res.status}（期望 ${expected}）。环境不对，后面测出来的一切都不算数`)
    }
  }
}

/** 页面级横向溢出 + 关键盒模型 + live region 计数。 */
function measure() {
  const rect = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return {
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      left: Math.round(r.left * 100) / 100,
      position: s.position,
      top: s.top,
      cols: s.gridTemplateColumns,
      flexDirection: s.flexDirection,
      padding: s.padding,
      background: s.backgroundColor,
      borderRadius: s.borderRadius,
      fontSize: s.fontSize,
      color: s.color,
    }
  }
  const de = document.documentElement
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflowX: de.scrollWidth - de.clientWidth,
    h1Count: document.querySelectorAll('h1').length,
    h1Text: document.querySelector('h1')?.textContent ?? null,
    statusRoleCount: document.querySelectorAll('[role="status"]').length,
    rcPage: rect('.rc-page'),
    container: rect('.rc-container'),
    core: rect('.rc-core'),
    aside: rect('.rc-aside'),
    vp: rect('.rc-vp'),
    form: rect('.city-partner-form'),
    asideNote: rect('.rc-aside__note'),
    districtGrid: rect('.rc-district-grid'),
    cta: rect('.rc-cta'),
    ctaTitle: rect('.rc-cta__title'),
    ctaBtn: rect('.rc-secondary-btn'),
    quickLinks: rect('.rc-quick-links'),
    heroTitle: rect('.rc-hero__title'),
    heroEyebrow: rect('.rc-hero__eyebrow'),
    sectionCount: document.querySelectorAll('.rc-section').length,
    // 旧模块必须一个都不剩（接线后新旧两套并存是本任务最大的失败形状）
    legacy: {
      benefits: document.querySelectorAll('.city-coming-soon__benefits').length,
      stats: document.querySelectorAll('.city-coming-soon__stats').length,
      dualActions: document.querySelectorAll('.city-coming-soon__dual-actions').length,
      districtCard: document.querySelectorAll('.city-coming-soon__district-card').length,
      tenantNote: document.querySelectorAll('.city-coming-soon__tenant-note').length,
    },
    legacyText: {
      firstBatch: document.body.innerText.includes('首批上线'),
      preparing: document.body.innerText.includes('筹备中'),
      plannedArea: document.body.innerText.includes('规划服务区'),
      fakeStats: document.body.innerText.includes('30,000') || document.body.innerText.includes('98.5'),
    },
  }
}

async function shootBreakpoints(page) {
  for (const surface of SURFACES) {
    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 900 })
      // ⚠️ 改视口后必须 reload：不刷新时 100vw 出血层保持旧视口宽（工作项 §5.5.2）
      const res = await page.goto(BASE + surface.path, { waitUntil: 'networkidle' })
      if (res?.status() !== 200) throw new Error(`${surface.path} @${width} → HTTP ${res?.status()}`)
      const data = await page.evaluate(measure)
      report.breakpoints.push({ surface: surface.key, width, ...data })
      await page.screenshot({
        path: join(SHOTS, `${surface.key}-${width}.jpg`),
        fullPage: true,
        type: 'jpeg',
        quality: 72,
      })
    }
  }
}

async function stickyProbe(page) {
  for (const surface of SURFACES) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BASE + surface.path, { waitUntil: 'networkidle' })
    const samples = await page.evaluate(async () => {
      const aside = document.querySelector('.rc-aside')
      const core = document.querySelector('.rc-core')
      const vp = document.querySelector('.rc-vp')
      const card = document.querySelector('.city-partner-form')
      if (!aside || !core) return null
      // ⚠️ 全站 `scroll-behavior: smooth` 会让 scrollTo 变成动画：只等两帧就读，
      // 读到的是「请求 2400、实际 235」的假位置。先强制成瞬时滚动。
      const prevBehavior = document.documentElement.style.scrollBehavior
      document.documentElement.style.scrollBehavior = 'auto'
      const out = []
      for (const y of [0, 200, 400, 600, 800, 1200, 1600, 2400]) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
        out.push({
          requested: y,
          scrollY: Math.round(window.scrollY),
          asideTop: Math.round(aside.getBoundingClientRect().top),
          coreTop: Math.round(core.getBoundingClientRect().top),
        })
      }
      window.scrollTo(0, 0)
      document.documentElement.style.scrollBehavior = prevBehavior
      return {
        computedPosition: getComputedStyle(aside).position,
        computedTop: getComputedStyle(aside).top,
        leftColumnHeight: vp ? Math.round(vp.getBoundingClientRect().height) : null,
        cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
        asideHeight: Math.round(aside.getBoundingClientRect().height),
        coreHeight: Math.round(core.getBoundingClientRect().height),
        samples: out,
      }
    })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(BASE + surface.path, { waitUntil: 'networkidle' })
    const mobile = await page.evaluate(() => {
      const aside = document.querySelector('.rc-aside')
      return aside ? { position: getComputedStyle(aside).position } : null
    })
    report.sticky[surface.key] = { desktop1440: samples, mobile375: mobile }
  }
}

/** 超长城市名：把真实路由 DOM 里的文案换成最长城市名后重新量行盒（布局探针，非伪造数据）。 */
async function longCityNameProbe(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE + '/hangzhou', { waitUntil: 'networkidle' })
  const data = await page.evaluate(() => {
    const h1 = document.querySelector('.rc-hero__title')
    const ctaTitle = document.querySelector('.rc-cta__title')
    const ctaBody = document.querySelector('.rc-cta__body')
    if (h1) h1.textContent = '商办租赁即将登陆乌鲁木齐，诚邀本地城市合伙人'
    if (ctaTitle) ctaTitle.textContent = '您是需要在乌鲁木齐寻租办公室的企业？'
    if (ctaBody) ctaBody.textContent = '留下面积与预算，乌鲁木齐开通后第一批推送匹配房源。'
    const lineBoxes = (el) => {
      if (!el) return null
      const range = document.createRange()
      range.selectNodeContents(el)
      return Array.from(range.getClientRects()).map((r) => Math.round(r.width))
    }
    const de = document.documentElement
    return {
      h1LineWidths: lineBoxes(h1),
      h1Height: h1 ? Math.round(h1.getBoundingClientRect().height) : null,
      ctaTitleLineWidths: lineBoxes(ctaTitle),
      ctaHeight: Math.round(document.querySelector('.rc-cta')?.getBoundingClientRect().height ?? 0),
      overflowX: de.scrollWidth - de.clientWidth,
    }
  })
  await page.screenshot({ path: join(SHOTS, 'hangzhou-1440-long-city-name.jpg'), fullPage: true, type: 'jpeg', quality: 72 })
  report.longCityName = data
}

/** 表单三态：校验失败 / 提交成功 / 限流。 */
async function formStates(page) {
  await page.setViewportSize({ width: 1440, height: 900 })

  // ① 校验失败：直接提交空表单
  await page.goto(BASE + '/city-partner', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.waitForTimeout(200)
  report.formStates.push({
    state: 'validation-failed',
    ...(await page.evaluate(() => ({
      errors: Array.from(document.querySelectorAll('.field__error')).map((n) => n.textContent),
      statusRoleCount: document.querySelectorAll('[role="status"]').length,
      invalidBorder: getComputedStyle(document.querySelector('#partner-name')).borderColor,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))),
  })
  await page.screenshot({ path: join(SHOTS, 'form-validation-failed-1440.jpg'), fullPage: true, type: 'jpeg', quality: 72 })

  // ② 限流：拦 429
  let calls = 0
  await page.route('**/api/city-partner-applications', async (route) => {
    calls += 1
    await route.fulfill({
      status: calls === 1 ? 429 : 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: calls !== 1 }),
    })
  })
  await page.route('**/api/city-partner-applications/details', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }))
  await page.goto(BASE + '/city-partner?city=hangzhou', { waitUntil: 'networkidle' })
  await page.getByLabel('姓名').fill('验收申请人')
  await page.getByLabel('手机号').fill('13800001111')
  await page.getByLabel('合作身份').selectOption('local-operations')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.getByText('提交过于频繁，请稍后再试。').waitFor()
  report.formStates.push({
    state: 'rate-limited',
    ...(await page.evaluate(() => ({
      alertText: document.querySelector('[role="alert"]')?.textContent ?? null,
      keptName: document.querySelector('#partner-name')?.value ?? null,
      statusRoleCount: document.querySelectorAll('[role="status"]').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))),
  })
  await page.screenshot({ path: join(SHOTS, 'form-rate-limited-1440.jpg'), fullPage: true, type: 'jpeg', quality: 72 })

  // ③ 提交成功：重试 → 第二步 → 跳过 → 完成态
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.getByRole('heading', { name: '补充合作信息（可选）' }).waitFor()
  await page.screenshot({ path: join(SHOTS, 'form-stage-two-1440.jpg'), fullPage: true, type: 'jpeg', quality: 72 })
  const stageTwo = await page.evaluate(() => ({
    statusRoleCount: document.querySelectorAll('[role="status"]').length,
    cardWidth: Math.round(document.querySelector('.city-partner-form')?.getBoundingClientRect().width ?? 0),
    cardHeight: Math.round(document.querySelector('.city-partner-form')?.getBoundingClientRect().height ?? 0),
  }))
  report.formStates.push({ state: 'stage-two', ...stageTwo })
  await page.getByRole('button', { name: '暂不补充，完成申请' }).click()
  await page.getByRole('status').filter({ hasText: '申请已收到' }).waitFor()
  report.formStates.push({
    state: 'complete',
    ...(await page.evaluate(() => ({
      statusRoleCount: document.querySelectorAll('[role="status"]').length,
      successText: document.querySelector('.city-partner-form__success')?.textContent ?? null,
      cardWidth: Math.round(document.querySelector('.city-partner-form__success')?.getBoundingClientRect().width ?? 0),
      cardHeight: Math.round(document.querySelector('.city-partner-form__success')?.getBoundingClientRect().height ?? 0),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))),
  })
  await page.screenshot({ path: join(SHOTS, 'form-complete-1440.jpg'), fullPage: true, type: 'jpeg', quality: 72 })
  await page.unrouteAll()
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await warmup()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  try {
    await shootBreakpoints(page)
    await stickyProbe(page)
    await longCityNameProbe(page)
    await formStates(page)
  } finally {
    report.consoleErrors = consoleErrors
    await browser.close()
    writeFileSync(join(OUT, 'task5-acceptance.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(`写入 ${join(OUT, 'task5-acceptance.json')}；截图 ${SHOTS}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
