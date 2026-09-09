/**
 * 全幅出血横向溢出验证探针。
 *
 * 产出 artifacts/verification/frontend-horizontal-scroll-clip/probe.output.json，
 * 与同目录 README.md 的每个数字一一对应。README 不自证——这支脚本才是事实源
 * （.agent/testing.md「证据质量」第 1 条）。
 *
 * ## 必须关掉 --hide-scrollbars，否则这个缺陷测不到
 *
 * Playwright headless 默认带 `--hide-scrollbars`，滚动条宽度为 0，`100vw` 就恒等于
 * `documentElement.clientWidth`，出血盒不再探出，缺陷**结构性地无法复现**。
 * 实测：默认 `clientWidth 1440 / scrollbarWidth 0`；关掉后 `1425 / 15`。
 * 这正是 tests/e2e/detail-pages.spec.ts 早就在 1440 / 1920 断言
 * `scrollWidth <= clientWidth`、却从没红过的原因。
 *
 * 用法（需要先起 dev server 或 next start）：
 *     pnpm dev                                             # 另开一个终端
 *     node scripts/verify-horizontal-bleed-overflow.mjs
 *     BASE_URL=http://localhost:3000 node scripts/verify-horizontal-bleed-overflow.mjs
 *
 * 退出码 0 = 全部通过；1 = 有失败项（详见 stdout 与 JSON 的 failures 段）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:3717'
// 相对脚本自身定位，避免「从哪个目录运行」影响产物落点
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../artifacts/verification/frontend-horizontal-scroll-clip')

/** 五处 `width: 100vw` 出血点各取一个真实消费路由。marker 用来证明页面真渲染了。 */
const ROUTES = [
  { name: 'home', url: '/shanghai', marker: '.hm-home' },
  { name: 'list', url: '/shanghai/listings', marker: '.ls-page' },
  { name: 'detail', url: '/shanghai/listings/changning-hongqiao-serviced', marker: '.dt-page' },
  { name: 'recruit', url: '/city-partner', marker: '.rc-page' },
  { name: 'landing', url: '/entrust', marker: '.landing-hero' },
]
const VIEWPORTS = [375, 768, 1440, 1920]
const CONTAINERS = '.hm-container, .ls-container, .dt-container, .rc-container, .landing-hero__inner'

/** 在页面里跑：量几何 + 找出真正会顶到视口的溢出元素。 */
const measure = ([markerSel, containerSel]) => {
  const d = document.documentElement
  const cw = d.clientWidth
  d.scrollLeft = 9999
  const maxScrollLeft = d.scrollLeft
  d.scrollLeft = 0

  const rect = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2) }
  }
  // 内层横滑轨道（.hm-rail 等）自带 overflow，不向视口贡献溢出，必须排除，
  // 否则会把一堆合法的轨道子元素误报成缺陷。
  const contained = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true
    }
    return false
  }
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) continue
    if ((b.right > cw + 0.5 || b.left < -0.5) && !contained(el)) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        left: +b.left.toFixed(2),
        right: +b.right.toFixed(2),
      })
    }
  }

  const shellRect = rect(document.querySelector(markerSel))
  return {
    innerWidth: window.innerWidth,
    clientWidth: cw,
    scrollbarWidth: window.innerWidth - cw,
    maxScrollLeft,
    htmlOverflowX: getComputedStyle(d).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    shell: shellRect,
    // 出血带必须覆盖整个可视宽度（左边缘 <= 0 且右边缘 >= clientWidth）
    bandCoversViewport: shellRect ? shellRect.left <= 0.5 && shellRect.right >= cw - 0.5 : null,
    // 左右探出量之差，衡量出血带是否居中（应约等于 0）
    bandAsymmetry: shellRect
      ? +Math.abs(Math.abs(shellRect.left) - Math.abs(shellRect.right - cw)).toFixed(2)
      : null,
    container: rect(document.querySelector(containerSel)),
    headerInner: rect(document.querySelector('.site-header__inner')),
    uncontainedOverflowCount: offenders.length,
    uncontainedOverflowTop: offenders.slice(0, 5),
  }
}

/** html/body 的 overflow-x 四组组合，证明「两条缺一不可」。 */
const mechanism = async (page) => {
  const combos = [
    ['visible', 'clip', '修复前的状态'],
    ['clip', 'visible', ''],
    ['clip', 'clip', '本次修复'],
    ['hidden', 'clip', 'hidden 会让根元素变成滚动容器、吸顶失效，不能用'],
  ]
  const out = []
  for (const [h, b, note] of combos) {
    const r = await page.evaluate(
      ([hv, bv]) => {
        let s = document.getElementById('__probe')
        if (!s) {
          s = document.createElement('style')
          s.id = '__probe'
          document.head.appendChild(s)
        }
        s.textContent = 'html{overflow-x:' + hv + '}body{overflow-x:' + bv + '}'
        const d = document.documentElement
        d.scrollLeft = 9999
        const max = d.scrollLeft
        d.scrollLeft = 0
        return { maxScrollLeft: max, docScrollWidth: d.scrollWidth, clientWidth: d.clientWidth }
      },
      [h, b],
    )
    out.push({ html: h, body: b, note, ...r })
  }
  await page.evaluate(() => {
    const s = document.getElementById('__probe')
    if (s) s.remove()
  })
  return out
}

const run = async () => {
  // 关掉 --hide-scrollbars，恢复经典滚动条；不关就测不到（见文件头注释）
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const report = {
    baseUrl: BASE,
    generatedAt: new Date().toISOString(),
    note: '滚动条宽度须为 15；若为 0 说明 --hide-scrollbars 未关闭，本报告不作数',
    routes: {},
    mechanism: null,
    sticky: null,
  }
  const failures = []

  for (const route of ROUTES) {
    report.routes[route.name] = {}
    for (const width of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      let status = 0
      let markerPresent = false
      let attempts = 0
      // 重试一次：dev server 首次编译某路由时偶发导航失败（实测 home@768 出过一次
      // HTTP 0，重跑即好）。证据必须可复现，不能靠「再跑一遍碰运气」。
      for (attempts = 1; attempts <= 2 && !markerPresent; attempts++) {
        try {
          // 不用 networkidle：dev server 的 HMR websocket 可能永不静默
          const res = await page.goto(BASE + route.url, { waitUntil: 'domcontentloaded', timeout: 120000 })
          status = res ? res.status() : 0
          // 先证明页面真的渲染了：状态码 + 该路由特有的选择器
          //（.agent/testing.md 证据质量第 2 条：拿两张 404 页比出过「0 差异像素」的空结论）
          await page.waitForSelector(route.marker, { timeout: 15000 })
          markerPresent = true
        } catch {
          markerPresent = (await page.locator(route.marker).count()) > 0
        }
      }
      if (status !== 200) failures.push(route.name + '@' + width + ': HTTP ' + status)
      if (!markerPresent) failures.push(route.name + '@' + width + ': 缺选择器 ' + route.marker)

      let m = null
      if (status === 200 && markerPresent) {
        m = await page.evaluate(measure, [route.marker, CONTAINERS])
        if (m.scrollbarWidth === 0 && width >= 768) {
          failures.push(route.name + '@' + width + ': 滚动条宽度为 0，--hide-scrollbars 未关闭')
        }
        if (m.maxScrollLeft !== 0) {
          failures.push(route.name + '@' + width + ': 可横向拖动 ' + m.maxScrollLeft + 'px')
        }
        if (m.bandCoversViewport === false) {
          failures.push(route.name + '@' + width + ': 出血带未覆盖可视宽度')
        }
      }
      report.routes[route.name][width] = {
        url: route.url,
        status,
        markerPresent,
        marker: route.marker,
        navAttempts: attempts - 1,
        ...(m || {}),
      }
      await page.close()
    }
  }

  // 机制对照 + 纵向滚动 / 吸顶回归，都在首页 1440 上做
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE + '/shanghai', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('.hm-home', { timeout: 15000 })
  report.mechanism = await mechanism(page)
  report.sticky = await page.evaluate(() => {
    const d = document.documentElement
    d.scrollTop = 800
    const applied = d.scrollTop
    const h = document.querySelector('.site-header')
    const top = h ? +h.getBoundingClientRect().top.toFixed(2) : null
    d.scrollTop = 0
    return { verticalScrollWorks: applied === 800, scrollTopApplied: applied, headerTopWhileScrolled: top }
  })
  if (!report.sticky.verticalScrollWorks) failures.push('纵向滚动失效')
  if (report.sticky.headerTopWhileScrolled !== 0) failures.push('吸顶头部失效')
  await page.close()
  await browser.close()

  report.failures = failures
  report.passed = failures.length === 0
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'probe.output.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  const sample = report.routes.home && report.routes.home[1440]
  console.log('滚动条宽度(home@1440):', sample ? sample.scrollbarWidth : 'n/a', '（应为 15）')
  console.log('机制对照（首页 1440）:')
  for (const c of report.mechanism) {
    console.log('  html:' + c.html.padEnd(8) + ' body:' + c.body.padEnd(8) + ' -> maxScrollLeft ' + c.maxScrollLeft + '  ' + c.note)
  }
  console.log(failures.length ? '✗ 失败 ' + failures.length + ' 项:\n  ' + failures.join('\n  ') : '✓ 全部通过')
  process.exit(failures.length ? 1 : 0)
}

run()
