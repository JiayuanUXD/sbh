// OPT-038 终审修复 · 证据脚本（随证据提交）
//
// 覆盖终审的三条 Important：
//   I1  select 下拉三角：逐路由读 `getComputedStyle(select).backgroundImage/Repeat/Position`，
//       把「三角还在」从零证据变成一条可比对的实测数（守卫本身落在 e2e，见
//       tests/e2e/city-partner-flow.spec.ts）。
//   I2  表单卡移动端内边距：四断点 × 两个消费面读 `.city-partner-form` 的 padding，
//       并全页截图；`before` / `after` 两轮对比证明差异只在 ≤640 的卡内边距。
//   I3  focus 态**真实测**：键盘 Tab 与 `.focus()` 两条路径各测一次，
//       量之前先把整页 `transition: none`（testing.md 那条陷阱正是它自己在讲的），
//       并记录 `el.matches(':focus-visible')` 的真实布尔值。
// 顺带落 M10（次级按钮 hover 底色）与 M11（--invalid 与 :focus-visible 的顺序）的实测数。
//
// 跑法（cwd = payload-office-platform，@playwright/test 在那里的 node_modules）：
//   FINALFIX_TAG=before node ../artifacts/verification/OPT-038/final-fix-probe.mjs
// 环境变量：FINALFIX_BASE（默认 http://127.0.0.1:3923）、FINALFIX_TAG（before/after）、
//           FINALFIX_OUT（默认脚本同目录）
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 的 import 按**脚本自身位置**解析，而本脚本住在 artifacts/ 下、
// @playwright/test 装在 payload-office-platform/node_modules。所以从 cwd 解析。
const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test')

const BASE = process.env.FINALFIX_BASE ?? 'http://127.0.0.1:3923'
const TAG = process.env.FINALFIX_TAG ?? 'after'
const OUT = process.env.FINALFIX_OUT ?? dirname(fileURLToPath(import.meta.url))
const SHOTS = join(OUT, `final-fix-shots-${TAG}`)

/** 预热清单：期望状态码写死，比对失败即抛——避免「两张 404 页比出 0 差异」那类空结论。 */
const WARMUP = [
  ['/city-partner', 200],
  ['/hangzhou', 200],
]

// 640 是 styles.css 那条被压死的断点本身的取值；375 在它以内、768 在它以外，
// 641 / 640 两档专门夹住断口，证明生效边界就是 640 而不是别的数。
const BREAKPOINTS = [375, 640, 641, 768, 1440, 1920]
const SHOT_BREAKPOINTS = [375, 768, 1440, 1920]
const SURFACES = [
  { key: 'city-partner', path: '/city-partner' },
  { key: 'hangzhou', path: '/hangzhou' },
]

const report = { tag: TAG, base: BASE, warmup: [], breakpoints: [], focus: [], hover: [], invalid: [] }

async function warmup() {
  for (const [path, expected] of WARMUP) {
    const res = await fetch(BASE + path, { redirect: 'manual' })
    report.warmup.push({ path, status: res.status, expected })
    if (res.status !== expected) {
      throw new Error(`预热失败：${path} → HTTP ${res.status}（期望 ${expected}）。环境不对，后面测出来的一切都不算数`)
    }
  }
}

/** I1 + I2 的逐断点读数。 */
function measure() {
  const de = document.documentElement
  const form = document.querySelector('.city-partner-form')
  const success = document.querySelector('.city-partner-form__success')
  const selects = Array.from(document.querySelectorAll('.city-partner-form .filter-bar__select'))
  const box = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      padding: s.padding,
      paddingTop: s.paddingTop,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
    }
  }
  return {
    viewportWidth: window.innerWidth,
    overflowX: de.scrollWidth - de.clientWidth,
    scrollHeight: de.scrollHeight,
    form: box(form),
    success: box(success),
    // I1：三角是一张 background-image；`none` 就是它被简写连坐掉了
    selects: selects.map((el) => {
      const s = getComputedStyle(el)
      return {
        id: el.id || null,
        disabled: el.disabled,
        backgroundImage: s.backgroundImage === 'none' ? 'none' : `url(len=${s.backgroundImage.length})`,
        backgroundImageIsNone: s.backgroundImage === 'none',
        backgroundRepeat: s.backgroundRepeat,
        backgroundPosition: s.backgroundPosition,
        backgroundColor: s.backgroundColor,
        appearance: s.appearance,
        paddingRight: s.paddingRight,
      }
    }),
    // M11：`--invalid` 修饰类在真实 DOM 里到底出不出现
    invalidClassCount:
      document.querySelectorAll('.filter-bar__input--invalid, .filter-bar__select--invalid').length,
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
      if (SHOT_BREAKPOINTS.includes(width)) {
        await page.screenshot({
          path: join(SHOTS, `${surface.key}-${width}.png`),
          fullPage: true,
          type: 'png',
        })
      }
    }
  }
}

/**
 * I3 · focus 态真实测。
 * 两条路径都跑：`.focus()`（程序聚焦）与 Tab（真键盘）。量之前先 `transition: none`
 * ——不置的话过渡态会读回基态假象，那正是 testing.md 里那条陷阱本身。
 */
async function focusProbe(page) {
  for (const surface of SURFACES) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BASE + surface.path, { waitUntil: 'networkidle' })
    await page.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })

    const read = () =>
      page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return { active: null }
        const s = getComputedStyle(el)
        return {
          active: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          matchesFocus: el.matches(':focus'),
          matchesFocusVisible: el.matches(':focus-visible'),
          borderColor: s.borderColor,
          boxShadow: s.boxShadow,
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          backgroundImage: s.backgroundImage === 'none' ? 'none' : `url(len=${s.backgroundImage.length})`,
        }
      })

    // ① 程序聚焦：逐个字段
    for (const id of ['partner-city', 'partner-name', 'partner-phone', 'partner-identity']) {
      const exists = await page.evaluate((sel) => Boolean(document.getElementById(sel)), id)
      if (!exists) continue
      await page.evaluate((sel) => document.getElementById(sel)?.focus(), id)
      report.focus.push({ surface: surface.key, route: 'programmatic', target: id, ...(await read()) })
    }

    // ② 真键盘：从卡内标题起连按 Tab，把落到的前 6 个可聚焦元素逐个记下来
    await page.evaluate(() => {
      document.activeElement?.blur?.()
      document.querySelector('.city-partner-form')?.scrollIntoView()
    })
    await page.locator('.city-partner-form').first().click({ position: { x: 5, y: 5 } })
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      report.focus.push({ surface: surface.key, route: 'keyboard-tab', step: i + 1, ...(await read()) })
    }

    // M10：次级按钮 hover 底色（与卡底色同色 ⇒ 变化恒为 0）
    const btn = page.locator('.rc-secondary-btn').first()
    if (await btn.count()) {
      const before = await btn.evaluate((el) => {
        const s = getComputedStyle(el)
        const card = el.closest('.rc-cta')
        return {
          background: s.backgroundColor,
          borderColor: s.borderColor,
          cardBackground: card ? getComputedStyle(card).backgroundColor : null,
        }
      })
      await btn.hover()
      const after = await btn.evaluate((el) => {
        const s = getComputedStyle(el)
        return { background: s.backgroundColor, borderColor: s.borderColor }
      })
      report.hover.push({ surface: surface.key, base: before, hover: after })
    }
  }
}

/** M11 · 校验失败后被 focusFirst 聚焦的那个字段，实际长什么样。 */
async function invalidProbe(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE + '/city-partner', { waitUntil: 'networkidle' })
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.waitForTimeout(200)
  report.invalid.push(
    await page.evaluate(() => {
      const el = document.activeElement
      const s = el ? getComputedStyle(el) : null
      return {
        activeId: el?.id ?? null,
        activeClassName: el?.className ?? null,
        ariaInvalid: el?.getAttribute('aria-invalid') ?? null,
        hasInvalidModifier: Boolean(el?.className?.includes?.('--invalid')),
        matchesFocusVisible: el?.matches?.(':focus-visible') ?? null,
        borderColor: s?.borderColor ?? null,
        boxShadow: s?.boxShadow ?? null,
        errorTexts: Array.from(document.querySelectorAll('.field__error')).map((n) => n.textContent),
        errorColor: getComputedStyle(document.querySelector('.field__error')).color,
        // 全表单里带 --invalid 修饰类的控件数（0 ⇒ 那条规则在本表单上无消费方）
        invalidModifierCount: document.querySelectorAll(
          '.filter-bar__input--invalid, .filter-bar__select--invalid',
        ).length,
      }
    }),
  )
  await page.screenshot({
    path: join(SHOTS, 'form-validation-failed-1440.png'),
    fullPage: true,
    type: 'png',
  })
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
    await focusProbe(page)
    await invalidProbe(page)
  } finally {
    report.consoleErrors = consoleErrors
    await browser.close()
    writeFileSync(join(OUT, `final-fix-probe-${TAG}.json`), JSON.stringify(report, null, 2), 'utf8')
    console.log(`写入 ${join(OUT, `final-fix-probe-${TAG}.json`)}；截图 ${SHOTS}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
