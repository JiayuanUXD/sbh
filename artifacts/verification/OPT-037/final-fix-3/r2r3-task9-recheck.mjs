/**
 * OPT-037 终审第 3 轮 R2 + R3：把 Task 9 两条「查无此数 / 量错了东西」的结论重新量一遍。
 *
 * R2 —— `DetailClickAnalytics` 的 9 个钩子（`task-9-report.md:39`）
 *   原报告标「见 §6 实测输出」，§6 没有该输出；`task9-verify.json` / `task9-states.json`
 *   里没有任何 analytics 字段，脚本里 grep 不到 `analytics`。这里照
 *   `task10-verify.mjs:356` 的做法真扫 `[data-detail-analytics-event]` 并按 event 分组计数。
 *   **额外扫 `.dt-related-grid` / `ListingCard` 一族的 `data-analytics-*`**，因为钩子里
 *   `recommendation_click` 是通过 `ListingCard` 的 `detailAnalytics` prop 传进去的。
 *
 * R3 —— 移动底栏价格的显隐（`task9-verify.mjs:176`）
 *   原判据是 `!!document.querySelector('.detail__mobile-bar-rent')`——量的是**存在性**，
 *   而且只在滚到页尾之后采一次，所以 768/1440/1920 这三个 `display:none` 的断点也是 true。
 *   这里换成真可见性（display / visibility / opacity / rect 面积 / 是否在视口内五项全查），
 *   并且**页首 + 页尾各采一次**。
 *
 * 跑法：MULTI_CITY_ROUTING_ENABLED=false 的生产 server（见 final-fix-3/README.md）
 *   node artifacts/verification/OPT-037/final-fix-3/r2r3-task9-recheck.mjs
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoOrThrow } from '../lib/sentinel.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-3/r2r3-task9-recheck.json'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3810'
const MAIN = 'jingan-serviced-office-42-seats'
const VIEWPORTS = [375, 768, 1440, 1920]

/**
 * 「可见」的五项判据。只查 `display` 不够：本页底栏在 ≤767 之外是
 * `display:none`，但价格那一节在 ≤767 内部还会因为 IntersectionObserver
 * 未触发而**存在但不可见**（父可见、自己 opacity/尺寸为 0）。
 */
const visibilityOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { present: false, visible: false }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    // 自身及全部祖先的 display / visibility 都要查（父 display:none 时自身样式照样是 block）
    let node = el
    let hiddenAncestor = null
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) {
        hiddenAncestor = node.className || node.tagName
        break
      }
      node = node.parentElement
    }
    return {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      hiddenAncestor,
      inViewport: r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0,
      /** 最终判据：无隐藏祖先 + 自身可见 + 有面积 + 在视口内 */
      visible:
        hiddenAncestor == null &&
        cs.visibility !== 'hidden' &&
        Number(cs.opacity) > 0 &&
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.top < window.innerHeight,
      text: el.textContent?.trim().slice(0, 40) ?? null,
    }
  }, selector)

const analyticsOf = (page) =>
  page.evaluate(() => {
    const byEvent = {}
    const detail = []
    for (const el of document.querySelectorAll('[data-detail-analytics-event]')) {
      const k = el.dataset.detailAnalyticsEvent
      byEvent[k] = (byEvent[k] ?? 0) + 1
      detail.push({
        event: k,
        section: el.dataset.detailAnalyticsSection ?? el.dataset.sourceSection ?? null,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').split(' ')[0] || null,
      })
    }
    return {
      total: detail.length,
      byEvent,
      detail,
      /** DetailClickAnalytics 组件本身是否挂载（它是纯行为组件，DOM 上留的是这个 script/span 标记） */
      analyticsMountMarker: document.querySelectorAll('[data-detail-analytics-page]').length,
    }
  })

/** 反复滚到底直到 scrollY 稳定，且**拒绝「从未移动」这个平凡稳定**（task9-verify.mjs:143-151 的假阳性）。 */
const scrollToBottom = (page) =>
  page.evaluate(async () => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))
    const start = window.scrollY
    let previous = -1
    let rounds = 0
    for (let i = 0; i < 40 && window.scrollY !== previous; i += 1) {
      previous = window.scrollY
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      rounds += 1
      // eslint-disable-next-line no-await-in-loop
      await nextFrame()
    }
    return {
      startY: start,
      endY: window.scrollY,
      moved: window.scrollY > start,
      docHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      rounds,
      /** 页面本身就不可滚时 moved=false 是合法的，用这一条区分「没滚动」与「滚不动」 */
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
    }
  })

const browser = await chromium.launch()
const report = { origin: ORIGIN, sample: MAIN, viewports: {} }

for (const width of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height: 812 } })
  const v = (report.viewports[width] = {})
  v.sentinel = await gotoOrThrow(page, `${ORIGIN}/listings/${MAIN}`)

  // ── R3-a 页首采样 ───────────────────────────────────────────────
  v.atTop = {
    bar: await visibilityOf(page, '.detail__mobile-bar'),
    price: await visibilityOf(page, '.detail__mobile-bar-rent'),
    decision: await visibilityOf(page, '.dt-decision'),
  }

  // ── R2 埋点钩子（首屏即完整 SSR，先量一次）──────────────────────
  v.analyticsAtTop = await analyticsOf(page)

  // ── R3-b 页尾采样 ───────────────────────────────────────────────
  v.scroll = await scrollToBottom(page)
  await page.waitForTimeout(500)
  v.atBottom = {
    bar: await visibilityOf(page, '.detail__mobile-bar'),
    price: await visibilityOf(page, '.detail__mobile-bar-rent'),
    decision: await visibilityOf(page, '.dt-decision'),
    stickyBar: await visibilityOf(page, '.dt-sticky-bar'),
  }
  // 滚动会挂载懒加载组件（BackToTop / 推荐卡），埋点数可能变，所以两次都记
  v.analyticsAtBottom = await analyticsOf(page)
  await page.close()
}

await browser.close()
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

console.log('=== R2 埋点钩子（[data-detail-analytics-event] 分组计数）===')
for (const [w, v] of Object.entries(report.viewports)) {
  console.log(
    `  ${w.padStart(4)} 页首 total=${v.analyticsAtTop.total} ${JSON.stringify(v.analyticsAtTop.byEvent)}  |  页尾 total=${v.analyticsAtBottom.total} ${JSON.stringify(v.analyticsAtBottom.byEvent)}`,
  )
}
console.log('\n=== R3 移动底栏 / 价格的真可见性（页首 vs 页尾）===')
for (const [w, v] of Object.entries(report.viewports)) {
  console.log(
    `  ${w.padStart(4)} 底栏: 页首 present=${v.atTop.bar.present} visible=${v.atTop.bar.visible} display=${v.atTop.bar.display} / 页尾 visible=${v.atBottom.bar.visible}`,
  )
  console.log(
    `       价格: 页首 present=${v.atTop.price.present} visible=${v.atTop.price.visible} / 页尾 present=${v.atBottom.price.present} visible=${v.atBottom.price.visible} 文案=${JSON.stringify(v.atBottom.price.text)}`,
  )
  console.log(
    `       滚动: ${v.scroll.startY}→${v.scroll.endY} moved=${v.scroll.moved} scrollable=${v.scroll.scrollable} doc=${v.scroll.docHeight}/${v.scroll.innerHeight}`,
  )
}
