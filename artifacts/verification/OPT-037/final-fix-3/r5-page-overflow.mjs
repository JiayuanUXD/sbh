/**
 * OPT-037 终审第 3 轮 R5：页面级横向溢出的**页面级**证据。
 *
 * 为什么补：Task 5 的「375：`body.scrollWidth === clientWidth === 375`」与 Task 7 的
 * 「三断点 `documentElement.scrollWidth` 均 0 溢出」「整页横向可滚 180px」，
 * 唯一来源是 `location-375.png`(295×856) / `supply-375.png`(343×812) /
 * `supply-768.png`(736×1024) —— **元素裁图**。一张 295px 宽的元素裁图在结构上
 * 承载不了任何关于 `documentElement.scrollWidth` 的断言（它连视口都不是）。
 * 这里补一次 fullPage 截图 + 数值落盘，只补审查点名的两处：
 * LocationPanel 所在页（房源详情）与供给区所在页（楼盘详情）。
 *
 * 附带把「谁在顶宽」也量出来（offenders）：只报页面级溢出而不报元凶，
 * 下一个人复现回归时还得从头查一遍。
 *
 * 跑法：node artifacts/verification/OPT-037/final-fix-3/r5-page-overflow.mjs
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoOrThrow } from '../lib/sentinel.mjs'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-3'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3810'
const VIEWPORTS = [375, 768, 1440, 1920]

const CASES = [
  // Task 5：LocationPanel（周边与交通）在房源详情页
  // ⚠️ LocationPanel 的 section **自己**就是 `#location.location-panel`（不是它的后代）。
  // 第一版写成后代选择器 `#location .location-panel`，`panelPresent` 四断点恒 false。
  ['location-panel', '/listings/jingan-serviced-office-42-seats', '#location.location-panel'],
  // Task 7：供给区在楼盘详情页（密度表 / 卡片切换都在这里）
  ['supply', '/buildings/west-nanjing-premium-center', '#supply .building-supply-browser, #supply.building-supply-browser'],
  // Task 7 的 768 曾经整页横滑 180px（Chromium `table-layout:fixed` intrinsic size
  // 绕过 overflow 祖先）——多业务组楼盘也过一遍，密度表列数不同
  ['supply-multigroup', '/buildings/huangpu-bund', '#supply .building-supply-browser, #supply.building-supply-browser'],
]

const measure = (page, panelSel) =>
  page.evaluate((sel) => {
    const de = document.documentElement
    const body = document.body
    /** 谁在顶宽：所有 rect 右边界超出 documentElement.clientWidth 的元素 */
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().split(' ').slice(0, 2).join(' '),
          left: Math.round(r.left),
          right: Math.round(r.right),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: getComputedStyle(el).overflowX,
        })
      }
    }
    const panel = document.querySelector(sel)
    const pr = panel?.getBoundingClientRect() ?? null
    return {
      documentScrollWidth: de.scrollWidth,
      documentClientWidth: de.clientWidth,
      documentOverflowPx: de.scrollWidth - de.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyOverflowX: getComputedStyle(body).overflowX,
      /** 判据：页面级不可横滑 —— 与「元素裁图里看不到横条」完全是两回事 */
      pageHasHorizontalScroll: de.scrollWidth > de.clientWidth,
      panelPresent: panel != null,
      panelRect: pr ? { x: Math.round(pr.x), w: Math.round(pr.width) } : null,
      /** 面板自己**允许**内部横滑（密度表就是这么设计的），所以单独记，不与页面级混为一谈 */
      panelInnerScroll: panel
        ? { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, overflowX: getComputedStyle(panel).overflowX }
        : null,
      offenders: offenders.slice(0, 12),
      offenderCount: offenders.length,
    }
  }, panelSel)

const browser = await chromium.launch()
const report = { origin: ORIGIN, cases: {} }

for (const [name, path, panelSel] of CASES) {
  const c = (report.cases[name] = { path, panelSelector: panelSel, viewports: {} })
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const sentinel = await gotoOrThrow(page, ORIGIN + path)
    // 先滚一遍：懒加载图片 / 客户端切表格↔卡片都会改变页宽，只量首屏会漏
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(300)
    const m = await measure(page, panelSel)
    const shot = `r5-${name}-${width}.png`
    // **fullPage**：这正是原证据缺的那一半
    await page.screenshot({ path: `${DIR}/${shot}`, fullPage: true })
    c.viewports[width] = { sentinel, shot, ...m }
    await page.close()
  }
}

await browser.close()
writeFileSync(`${DIR}/r5-page-overflow.json`, JSON.stringify(report, null, 2), 'utf8')

for (const [name, c] of Object.entries(report.cases)) {
  console.log(`\n=== ${name}  ${c.path} ===`)
  for (const [w, v] of Object.entries(c.viewports)) {
    console.log(
      `  ${w.padStart(4)} doc=${v.documentScrollWidth}/${v.documentClientWidth} 溢出=${v.documentOverflowPx}px body=${v.bodyScrollWidth}/${v.bodyClientWidth} 可横滑=${v.pageHasHorizontalScroll} offenders=${v.offenderCount} 面板=${v.panelPresent} 面板内横滑=${v.panelInnerScroll ? v.panelInnerScroll.scrollWidth - v.panelInnerScroll.clientWidth : 'n/a'}px(${v.panelInnerScroll?.overflowX})`,
    )
    if (v.offenderCount > 0) console.log(`        offenders: ${JSON.stringify(v.offenders)}`)
  }
}
