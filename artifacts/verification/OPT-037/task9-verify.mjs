/**
 * OPT-037 Task 9（房源详情接线）—— 四断点 + sticky 交接 + 状态走查验证脚本。
 *
 * 为什么脚本随证据一起提交：证据文件自己证明不了自己（Task 8 立的规矩，见
 * task8-fix-verify.mjs 文件头）。截图只能说明"某一刻长这样"，说不清"量的是哪条
 * 边、判据是什么"；这里把每条判据都写成可复核的数字，落进 task9-verify.json。
 *
 * 跑法（dev server 必须显式连隔离库 sbh_dev_opt035，端口避开别人的 3717）：
 *   DATABASE_URL=postgres://<user>:<pass>@localhost:5432/sbh_dev_opt035 \
 *     MULTI_CITY_ROUTING_ENABLED= pnpm exec next dev -p 3731
 *   node artifacts/verification/OPT-037/task9-verify.mjs
 *
 * MULTI_CITY_ROUTING_ENABLED 必须为空：置 true 时 `/listings/<slug>` 会 307 到
 * `/<city>/listings/<slug>`，legacy 路由那一半就验不到了（两条路由都要过）。
 *
 * ⚠️ **本脚本只覆盖关闭态。** task-9-report.md 曾拿本脚本的产物去支撑「多城**开启**时
 * JSON-LD url 与面包屑全部带城市前缀」这句结论——那一轮根本没有产物，入库的 `prefixed`
 * 记录四断点全都没有城市前缀（因为它是关闭态跑出来的）。开启态的实测在
 * `final-fix-3/r1-multicity.mjs`（两态各跑一遍互为对照）。
 *
 * 输出：artifacts/verification/OPT-037/task9-verify.json + 同目录 task9-*.png。
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import { gotoChecked } from './lib/sentinel.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.env.VERIFY_ORIGIN ?? 'http://localhost:3731'
/** 有图（种子 gallery）+ 有坐标 + 有价格的主力样本 */
const MAIN = 'jingan-serviced-office-42-seats'
/** 价格面议：决策卡不得渲染 0，也不得留空行 */
const NO_PRICE = 'jingan-price-on-request-300sqm'
/** 楼盘无经纬度：周边与交通整段不渲染，且不得留下一段空白 */
const NO_COORD = 'changning-hongqiao-serviced'
const VIEWPORTS = [
  [375, 812],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
]

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = {}

/** 页面级横向溢出：判据是 scrollWidth ≤ clientWidth，不是"看起来没横条"。 */
const overflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
  }))

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, visible: getComputedStyle(el).display !== 'none' }
  }, selector)

for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const r = (report[w] = {})

  // ── 1. 主力房源（legacy 路由）──────────────────────────────────────────
  r.main = { sentinel: await gotoChecked(page, `${ORIGIN}/listings/${MAIN}`), overflowTop: await overflow(page) }

  // 骨架落地数值：容器 1180 / 主栏 776 / 决策栏 372（≤1023 单列）、
  // 标题栏 padding 32/24、h2 24/600。全部从计算样式读，不看截图猜。
  r.main.skeleton = await page.evaluate(() => {
    const core = document.querySelector('.dt-core')
    const titlebar = document.querySelector('.dt-titlebar')
    const h1 = document.querySelector('.dt-titlebar__title')
    const h2 = document.querySelector('.dt-h2')
    const container = document.querySelector('.dt-container')
    const cs = (el) => (el ? getComputedStyle(el) : null)
    return {
      containerWidth: container?.getBoundingClientRect().width ?? null,
      coreColumns: cs(core)?.gridTemplateColumns ?? null,
      coreColumnGap: cs(core)?.columnGap ?? null,
      titlebarPadding: titlebar ? `${cs(titlebar).paddingTop} ${cs(titlebar).paddingBottom}` : null,
      h1: h1 ? `${cs(h1).fontSize}/${cs(h1).fontWeight}/${cs(h1).lineHeight}` : null,
      h1LetterSpacing: cs(h1)?.letterSpacing ?? null,
      h2: h2 ? `${cs(h2).fontSize}/${cs(h2).fontWeight}` : null,
    }
  })

  // 页面顺序（硬要求）：标题栏 → 核心区 → 描述 → 周边与交通 → 所在楼盘 → 推荐。
  // 用文档序而不是肉眼看截图。
  r.main.order = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '.dt-titlebar, .dt-core, #description, #location, #building, #related',
      ),
    ).map((el) => el.id || el.className.split(' ')[0]),
  )

  // 概况面板：必须在 .dt-core 里（通栏第 2 行），不是独立段落。
  r.main.overviewInCore = await page.evaluate(
    () => document.querySelectorAll('.dt-core #overview').length,
  )
  // 缺失值一律 —，不显示 0（正则排除 "10 ㎡" 这类合法数字里的 0）。
  r.main.overviewText = await page.evaluate(() => {
    const panel = document.querySelector('.dt-overview')
    const text = panel?.textContent ?? ''
    return {
      rows: document.querySelectorAll('.dt-overview .dt-spec__row').length,
      dashRows: Array.from(document.querySelectorAll('.dt-overview .dt-spec__value')).filter(
        (el) => el.textContent.trim() === '—',
      ).length,
      hasZeroYuan: /(?<![\d.])0\s*(元|㎡|个|月)(?![\d.])/.test(text),
    }
  })
  // 数字必须 tabular-nums（决策卡主数字 + 规格值）。
  r.main.tabularNums = await page.evaluate(() =>
    ['.dt-decision__price-num', '.dt-spec__value'].map((sel) => {
      const el = document.querySelector(sel)
      return el ? `${sel}:${getComputedStyle(el).fontVariantNumeric}` : `${sel}:missing`
    }),
  )
  await page.screenshot({ path: `${OUT}/task9-main-${w}.png`, fullPage: true })

  // ── 2. sticky 交接（决策卡粘附区间 → 吸附条接管）─────────────────────
  // 判据三条，缺一不可：
  //   a) 首屏：决策卡在视口内，吸附条**不存在于 DOM**（StickyInquiryBar 卸载态）；
  //   b) 决策卡完全离屏后：吸附条挂载，且决策卡的 rect 完全在视口上方（不同屏）；
  //   c) 两者任一时刻都不重叠。
  const stick = {}
  stick.atTop = {
    decision: await rectOf(page, '.dt-decision'),
    bar: await rectOf(page, '.dt-sticky-bar'),
  }
  // 粘附中：滚到画廊中段，决策卡应贴在 top = 44 + 56 + 16 = 116（桌面）。
  await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }))
  await page.waitForTimeout(250)
  stick.midway = {
    decision: await rectOf(page, '.dt-decision'),
    bar: await rectOf(page, '.dt-sticky-bar'),
    stickyTop: await page.evaluate(() => {
      const el = document.querySelector('.dt-decision')
      return el ? getComputedStyle(el).top : null
    }),
  }
  // 释放 + 接管：滚到页尾。用「反复滚到底直到 scrollY 稳定」而不是一次算好的
  // 目标值——懒加载图片落位会把文档撑高，一次性 scrollTo 会停在过时的位置
  // （首版脚本就栽在这里：375 下决策卡只上移了 199px，量出来"还在视口里"）。
  // ⚠️ 终审第 3 轮补：原实现「反复滚到底直到 scrollY 稳定」**接受「从未移动」这个平凡稳定**
  // （页面根本没滚动时首轮就退出，后面所有「滚到页尾」的判据都是空的）。
  // 现在把起点/终点/是否可滚一并记进产物，`moved === false && scrollable === true`
  // 就是脚本失效，不是页面结论。
  r.main.scrollToBottom = await page.evaluate(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const startY = window.scrollY
    let previous = -1
    for (let i = 0; i < 40 && window.scrollY !== previous; i += 1) {
      previous = window.scrollY
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      await nextFrame()
    }
    return {
      startY,
      endY: window.scrollY,
      moved: window.scrollY > startY,
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
      docHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }
  })
  await page.waitForTimeout(400)
  stick.afterRelease = {
    decision: await rectOf(page, '.dt-decision'),
    bar: await rectOf(page, '.dt-sticky-bar'),
    barCount: await page.evaluate(() => document.querySelectorAll('.dt-sticky-bar').length),
    // 决策卡 rect 完全在视口上方 ⇔ bottom ≤ 0
    decisionFullyAbove: await page.evaluate(() => {
      const el = document.querySelector('.dt-decision')
      return el ? el.getBoundingClientRect().bottom <= 0 : null
    }),
  }
  r.main.sticky = stick
  await page.screenshot({ path: `${OUT}/task9-sticky-handoff-${w}.png` })

  // 移动端底栏：≤767 才出现，且不遮挡最后一块内容（与 e2e 同判据）。
  r.main.mobileBar = await page.evaluate(() => {
    const bar = document.querySelector('.detail__mobile-bar')
    const sections = Array.from(document.querySelectorAll('.dt-page > section'))
    const last = sections.at(-1)
    if (!bar || !last) return null
    return {
      display: getComputedStyle(bar).display,
      barTop: bar.getBoundingClientRect().top,
      lastContentBottom: last.getBoundingClientRect().bottom,
      /**
       * ⚠️ 2026-08-22 终审第 3 轮修：原判据是 `!!querySelector(...)`——量的是**存在性**
       * 不是可见性，于是 768/1440/1920（底栏 `display:none`）也全记成 true；
       * 而且只在滚到页尾之后采一次，报告里那句「375 页首 priceVisible=false」
       * 在 JSON 里根本没有对应采样点。
       * 现在查「自身及全部祖先都没有 display:none / visibility:hidden / opacity:0，
       * 且有面积、且在视口内」。**页首 + 页尾两次采样**见
       * `final-fix-3/r2r3-task9-recheck.mjs`（本脚本只在页尾这一处用）。
       */
      priceVisible: (() => {
        const el = document.querySelector('.detail__mobile-bar-rent')
        if (!el) return false
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        }
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight
      })(),
      priceElementPresent: !!document.querySelector('.detail__mobile-bar-rent'),
      regionLabels: Array.from(document.querySelectorAll('[role="region"]')).map((el) =>
        el.getAttribute('aria-label'),
      ),
    }
  })

  // ── 3. 价格面议 ────────────────────────────────────────────────────────
  const noPriceSentinel = await gotoChecked(page, `${ORIGIN}/listings/${NO_PRICE}`)
  r.noPrice = {
    sentinel: noPriceSentinel,
    overflow: await overflow(page),
    priceText: await page.evaluate(
      () => document.querySelector('.dt-decision__price-num')?.textContent ?? null,
    ),
    priceIsNaVariant: await page.evaluate(
      () => !!document.querySelector('.dt-decision__price-num--na'),
    ),
    summaryPresent: await page.evaluate(() => !!document.querySelector('.dt-decision__summary')),
    stickyPriceRendered: await page.evaluate(
      () => !!document.querySelector('.dt-sticky-bar__price'),
    ),
    hasZeroYuan: await page.evaluate(() =>
      /(?<![\d.])0\s*元(?![\d.])/.test(document.querySelector('main')?.textContent ?? ''),
    ),
  }
  await page.screenshot({ path: `${OUT}/task9-noprice-${w}.png`, fullPage: true })

  // ── 4. 无坐标：周边与交通整段不渲染，且不留空白 ────────────────────────
  const noCoordSentinel = await gotoChecked(page, `${ORIGIN}/listings/${NO_COORD}`)
  r.noCoord = {
    sentinel: noCoordSentinel,
    overflow: await overflow(page),
    locationSection: await page.evaluate(() => document.querySelectorAll('#location').length),
    // 描述段底 → 所在楼盘段顶 的间距应恰好是一份 --dt-sec，没有多出的空段
    gapDescriptionToBuilding: await page.evaluate(() => {
      const a = document.querySelector('#description')
      const b = document.querySelector('#building')
      if (!a || !b) return null
      return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom
    }),
    sectionPaddingTop: await page.evaluate(() => {
      const b = document.querySelector('#building')
      return b ? getComputedStyle(b).paddingTop : null
    }),
  }
  await page.screenshot({ path: `${OUT}/task9-nocoord-${w}.png`, fullPage: true })

  // ── 5. prefixed 路由无回归（同一组件，只有 basePath / JSON-LD 不同）──────
  // ⚠️ 2026-08-22 终审第 3 轮修：这里原本写死 `status: 'rendered'`，**从不读 page.goto()
  // 的返回码**——404 也会记成 'rendered'。现在走共享哨兵（`lib/sentinel.mjs`：
  // 状态码 + 该路由族的关键选择器），产物里记的是真状态码。
  const prefixedSentinel = await gotoChecked(page, `${ORIGIN}/shanghai/listings/${MAIN}`)
  r.prefixed = {
    sentinel: prefixedSentinel,
    status: prefixedSentinel.status,
    overflow: await overflow(page),
    breadcrumbHrefs: await page.evaluate(() =>
      Array.from(document.querySelectorAll('.breadcrumb a')).map((a) => a.getAttribute('href')),
    ),
    jsonLdUrl: await page.evaluate(() => {
      const raw = document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}'
      const parsed = JSON.parse(raw)
      return { url: parsed.url ?? null, offersPrice: parsed.offers?.price ?? null }
    }),
    overviewInCore: await page.evaluate(
      () => document.querySelectorAll('.dt-core #overview').length,
    ),
  }
  await page.screenshot({ path: `${OUT}/task9-prefixed-${w}.png`, fullPage: true })

  await page.close()
}

fs.writeFileSync(`${OUT}/task9-verify.json`, JSON.stringify(report, null, 2))
await browser.close()
console.log(JSON.stringify(report, null, 2))
