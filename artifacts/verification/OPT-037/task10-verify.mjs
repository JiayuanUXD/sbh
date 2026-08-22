/**
 * OPT-037 Task 10（楼盘详情接线）—— 四断点 + 锚点导航 + 状态走查验证脚本。
 *
 * 为什么脚本随证据一起提交：证据文件自己证明不了自己（Task 8 立的规矩）。
 * 截图只能说明"某一刻长这样"，说不清"量的是哪条边、判据是什么"；这里把每条
 * 判据都写成可复核的数字，落进 task10-verify.json。
 *
 * 跑法（**不要覆盖 DATABASE_URL**，用 .env.local 的默认库 postgres：只有它有
 * west-nanjing 楼内的 wn-* 供给房源与视频种子媒体；端口避开别人的 3717）：
 *   MULTI_CITY_ROUTING_ENABLED= pnpm exec next dev -p 3741
 *   node artifacts/verification/OPT-037/task10-verify.mjs
 *
 * MULTI_CITY_ROUTING_ENABLED 必须为空：置 true 时 `/buildings/<slug>` 会 307 到
 * `/<city>/buildings/<slug>`，legacy 路由那一半就验不到了。
 *
 * 输出：artifacts/verification/OPT-037/task10-verify.json + 同目录 task10-*.png。
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked } from './lib/sentinel.mjs'
import fs from 'node:fs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.env.VERIFY_ORIGIN ?? 'http://localhost:3741'

/** 主力样本：三组供给齐全 + 有坐标 + 有同商圈楼盘 + 参数较全 */
const MAIN = 'west-nanjing-premium-center'
/** 供给三组全空：`#supply` 仍渲染（诚实空态），但内容是「当前暂无公开可选空间」 */
const EMPTY_SUPPLY = 'empty-building'
/** 无同商圈楼盘：`#related` 与周边楼盘条带都不渲染 → 锚点少一项 */
const NO_RELATED = 'changning-hongqiao'
/** 无坐标：`LocationPanel` 整段 null，不得渲染空地图容器 → 锚点少一项 */
const NO_COORD = 'test0814'

const VIEWPORTS = [
  [375, 812],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
]

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = {}
/**
 * ⚠️ 2026-08-22 终审第 3 轮补：本脚本原本只有「两条路由」那一段读了状态码，
 * 其余 6 处 `page.goto` 一律不读——一旦跑错环境（例如 config-guard fail-closed
 * 让房源类路由全线 404），产物里的每个数字都是对着错误页量出来的，而读的人看不出来。
 * 现在每次导航都过共享哨兵（`lib/sentinel.mjs`），逐条记进 `report.sentinels`。
 */
report.sentinels = []
const goChecked = async (page, url, opts) => {
  const s = await gotoChecked(page, url, opts)
  report.sentinels.push(s)
  return s
}

/** 页面级横向溢出：判据是 scrollWidth ≤ clientWidth，不是"看起来没横条"。 */
const overflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    ok: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, position: cs.position, top: cs.top,
    }
  }, selector)

/** 地图懒加载靠 IntersectionObserver，fullPage 截图不产生真实滚动 —— 先手动走一遍。 */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => requestAnimationFrame(() => r()))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((r) => requestAnimationFrame(() => r()))
  })
}

for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const r = (report[w] = {})

  await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  await scrollThrough(page)

  r.overflow = await overflow(page)

  // 骨架落地数值：容器宽 / 核心区两列 / 供给区两列 / 标题栏
  r.skeleton = await page.evaluate(() => {
    const pick = (sel, extra = {}) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      const out = { width: Math.round(el.getBoundingClientRect().width) }
      for (const [k, prop] of Object.entries(extra)) out[k] = cs[prop] ?? cs.getPropertyValue(prop)
      return out
    }
    return {
      container: pick('.dt-container'),
      core: pick('.dt-core', { cols: 'gridTemplateColumns', gap: 'columnGap' }),
      supply: pick('.dt-supply', { cols: 'gridTemplateColumns', gap: 'columnGap' }),
      h1: pick('.dt-titlebar__title', { size: 'fontSize', weight: 'fontWeight', ls: 'letterSpacing' }),
      subtitle: pick('.dt-titlebar__subtitle', { size: 'fontSize' }),
      anchorBar: pick('.dt-anchor-bar', { pos: 'position', top: 'top', height: 'height' }),
      relatedGrid: pick('.dt-related-grid', { cols: 'gridTemplateColumns', gap: 'gap' }),
      specPanel: pick('.dt-building-spec', { cols: 'gridTemplateColumns', pad: 'padding' }),
    }
  })

  // 吸附条：滚到页中时必须仍吸附在 top=44（包含块覆盖全部锚点区块的直接证据）
  r.stickyMid = await page.evaluate(() => {
    window.scrollTo({ top: Math.round(document.documentElement.scrollHeight * 0.5), behavior: 'instant' })
    const el = document.querySelector('.dt-anchor-bar')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { y: Math.round(rect.y), h: Math.round(rect.height), x: Math.round(rect.x), w: Math.round(rect.width) }
  })
  // 页尾：条仍在视口内（包含块 = .dt-page，覆盖到最后一个区块）
  r.stickyBottom = await page.evaluate(async () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
    const el = document.querySelector('.dt-anchor-bar')
    const rect = el.getBoundingClientRect()
    const active = document.querySelector('.dt-anchor-bar__link[aria-current]')
    return {
      barY: Math.round(rect.y),
      barVisible: rect.bottom > 0 && rect.top < window.innerHeight,
      activeLabel: active?.textContent ?? null,
      activeHref: active?.getAttribute('href') ?? null,
      lastAnchorHref: document.querySelector('.dt-anchor-bar__links a:last-child')?.getAttribute('href') ?? null,
    }
  })

  // 移动底栏 / 吸附条 CTA 的断点行为
  r.bars = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).display : 'absent'
    }
    return {
      mobileBar: g('.detail__mobile-bar'),
      anchorTitle: g('.dt-anchor-bar__title'),
      anchorCta: g('.dt-anchor-bar__cta'),
      anchorLinks: g('.dt-anchor-bar__links'),
    }
  })

  // 数字列 tabular-nums + 中文 letter-spacing normal
  r.typography = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      return { fvn: s.fontVariantNumeric, ls: s.letterSpacing, size: s.fontSize, weight: s.fontWeight }
    }
    return {
      specValue: cs('.dt-spec__value'),
      supplyNum: cs('.building-supply-browser__table-num'),
      heroPrice: cs('.hero-summary__price'),
      h2: cs('.dt-h2'),
    }
  })

  // 「不显示 0」：整页文本里不得出现「0 元」「0 套」「0 ㎡」这类把缺失当 0 的串
  r.zeroScan = await page.evaluate(() => {
    const text = document.body.innerText
    return {
      zeroYuan: /(^|[^\d.])0\s*元/.test(text),
      zeroTao: /(^|[^\d.])0\s*套/.test(text),
      zeroSqm: /(^|[^\d.])0\s*㎡/.test(text),
      dashCount: (text.match(/—/g) ?? []).length,
    }
  })

  await page.screenshot({ path: `${OUT}/task10-main-${w}.png`, fullPage: true })
  await page.close()
}

// ── 锚点跳转实测（1440）：逐个点击，落点标题不得被吸附条压住，高亮跟随 ────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  await scrollThrough(page)
  const clicks = []
  const hrefs = await page.$$eval('.dt-anchor-bar__links a', (as) => as.map((a) => a.getAttribute('href')))
  for (const href of hrefs) {
    await page.click(`.dt-anchor-bar__links a[href="${href}"]`)
    await page.waitForTimeout(700)
    clicks.push(
      await page.evaluate((h) => {
        const id = h.slice(1)
        const target = document.getElementById(id)
        const bar = document.querySelector('.dt-anchor-bar')
        const barBottom = bar.getBoundingClientRect().bottom
        const rect = target.getBoundingClientRect()
        // 区块的第一个可见标题（h2/h3），落点判据落在它上沿而不是 section 上沿：
        // section 自己带 padding-top，用 section 上沿会把 padding 算成"呼吸"。
        const heading = target.matches('h1,h2,h3') ? target : target.querySelector('h2, h3')
        const headTop = heading ? heading.getBoundingClientRect().top : rect.top
        const active = document.querySelector('.dt-anchor-bar__link[aria-current]')
        return {
          href: h,
          sectionTop: Math.round(rect.top),
          headingTop: Math.round(headTop),
          barBottom: Math.round(barBottom),
          headingClearOfBar: headTop >= barBottom - 0.5,
          scrollMarginTop: getComputedStyle(target).scrollMarginTop,
          activeHref: active?.getAttribute('href') ?? null,
          highlightFollows: active?.getAttribute('href') === h,
        }
      }, href),
    )
  }
  report.anchorClicks = clicks
  await page.screenshot({ path: `${OUT}/task10-anchor-last-1440.png` })
  await page.close()
}

// ── 高亮跟随滚动（不是只跟随点击）+ 供给分组三态 ─────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  await scrollThrough(page)
  // 逐段下滚，记录「当前 scrollY → 高亮项」的轨迹。判据是它**单调推进**且
  // 与几何一致：任一采样点上，高亮项必须是「已越过自己落点的区块里最靠下的
  // 那个」（AnchorNavBar 的择一规则），而不是数组顺序。
  report.highlightTrace = await page.evaluate(async () => {
    const ids = Array.from(document.querySelectorAll('.dt-anchor-bar__links a'))
      .map((a) => a.getAttribute('href').slice(1))
    const trace = []
    const total = document.documentElement.scrollHeight
    for (let ratio = 0; ratio <= 1.0001; ratio += 0.1) {
      window.scrollTo({ top: Math.round(total * ratio), behavior: 'instant' })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const active = document.querySelector('.dt-anchor-bar__link[aria-current]')
      // 独立复算一遍几何期望值，不复用组件的结论
      const measured = ids
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => ({
          id: el.id,
          top: el.getBoundingClientRect().top,
          passed: el.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0),
        }))
      const crossed = measured.filter((m) => m.passed <= 1)
      const expected = crossed.length > 0
        ? crossed.reduce((a, b) => (b.top > a.top ? b : a)).id
        : measured.reduce((a, b) => (b.top < a.top ? b : a)).id
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      trace.push({
        ratio: Number(ratio.toFixed(1)),
        active: active?.getAttribute('href')?.slice(1) ?? null,
        expected: atBottom && window.scrollY > 0
          ? measured.reduce((a, b) => (b.top > a.top ? b : a)).id
          : expected,
        exactlyOneHighlighted: document.querySelectorAll('.dt-anchor-bar__link[aria-current]').length === 1,
      })
    }
    return trace.map((t) => ({ ...t, matchesGeometry: t.active === t.expected }))
  })

  // 供给分组三态：本 fixture 只有租赁组有有效供给 → 出售/联合办公两组的 tab
  // 整条不渲染（Task 7 的「空组整组不渲染」），这就是「三组各自为空」的
  // 真实样本；「全空」由 empty-building 覆盖（见下方状态走查）。
  report.supplyGroups = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.building-supply-browser__tab')).map((a) => a.textContent),
    tabCount: document.querySelectorAll('.building-supply-browser__tab').length,
    emptyGroupPlaceholders: document.querySelectorAll('.building-supply-browser__tab[data-empty]').length,
  }))
  await page.close()
}

// ── 状态走查 ────────────────────────────────────────────────────────────────
const STATES = [
  ['empty-supply', EMPTY_SUPPLY],
  ['no-related', NO_RELATED],
  ['no-coord', NO_COORD],
]
report.states = {}
for (const [name, slug] of STATES) {
  report.states[name] = {}
  for (const [w, h] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await goChecked(page, `${ORIGIN}/buildings/${slug}`)
    await scrollThrough(page)
    report.states[name][w] = {
      overflow: await overflow(page),
      ...(await page.evaluate(() => ({
        anchors: Array.from(document.querySelectorAll('.dt-anchor-bar__links a')).map((a) => ({
          href: a.getAttribute('href'), label: a.textContent,
        })),
        // 死锚点判据：每个 items 项在 DOM 里都找得到目标
        deadAnchors: Array.from(document.querySelectorAll('.dt-anchor-bar__links a'))
          .filter((a) => !document.getElementById(a.getAttribute('href').slice(1)))
          .map((a) => a.getAttribute('href')),
        // 反向：渲染了却没进导航的区块
        unlinkedSections: ['supply', 'location', 'params', 'related']
          .filter((id) => document.getElementById(id))
          .filter((id) => !document.querySelector(`.dt-anchor-bar__links a[href="#${id}"]`)),
        mapContainers: document.querySelectorAll('.location-panel__map, .amap-map-canvas').length,
        locationSections: document.querySelectorAll('#location').length,
        nearbyStrips: document.querySelectorAll('.nearby-strip').length,
        emptySupplyText: document.body.innerText.includes('当前暂无公开可选空间'),
        sideRailRegistration: Array.from(document.querySelectorAll('button'))
          .some((b) => b.textContent.includes('登记需求')),
      }))),
    }
    if (w === 1440 || w === 375) {
      await page.screenshot({ path: `${OUT}/task10-${name}-${w}.png`, fullPage: true })
    }
    await page.close()
  }
}

// ── 超长标题：改 DOM 不改库（只验版式，不污染数据） ─────────────────────────
report.longTitle = {}
for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  const LONG = '上海市静安区南京西路超甲级智慧办公综合体一期南楼国际商务中心（含配套商业与会议中心）'
  await page.evaluate((t) => {
    document.querySelector('.dt-titlebar__title').textContent = t
    const barTitle = document.querySelector('.dt-anchor-bar__title')
    if (barTitle) barTitle.textContent = t
    document.querySelector('.detail__mobile-bar-title').textContent = t
  }, LONG)
  await page.waitForTimeout(200)
  report.longTitle[w] = {
    overflow: await overflow(page),
    h1: await rectOf(page, '.dt-titlebar__title'),
    barTitle: await page.evaluate(() => {
      const el = document.querySelector('.dt-anchor-bar__title')
      if (!el) return null
      return {
        w: Math.round(el.getBoundingClientRect().width),
        clipped: el.scrollWidth > el.clientWidth,
        display: getComputedStyle(el).display,
      }
    }),
  }
  await page.screenshot({ path: `${OUT}/task10-longtitle-${w}.png` })
  await page.close()
}

// ── 两条路由 + 既有行为存活（多城关闭态）─────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const legacy = await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  report.routes = { legacyStatus: legacy.status, legacySentinel: legacy }
  // BackToTop 是滚动到一定距离后才挂载的客户端组件——不先滚一遍，
  // 「它还在不在」这条会恒为 0，读起来像回归（第一版脚本就是这么误报的）。
  await scrollThrough(page)
  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }))
  await page.waitForTimeout(300)
  report.preserved = await page.evaluate(() => ({
    jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
    jsonLdType: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@type'],
    analyticsHooks: Array.from(document.querySelectorAll('[data-detail-analytics-event]'))
      .reduce((acc, el) => {
        const k = el.dataset.detailAnalyticsEvent
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {}),
    sideRail: document.querySelectorAll('.detail-side-rail').length,
    sideRailCards: document.querySelectorAll('.detail-side-rail__card').length,
    nearbyStrip: document.querySelectorAll('.nearby-strip').length,
    backToTop: document.querySelectorAll('.back-to-top').length,
    correctionModal: Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.includes('信息纠错')).length,
    shareSave: Array.from(document.querySelectorAll('button')).filter((b) => /分享|收藏/.test(b.textContent)).length,
    inquiryBySection: Array.from(document.querySelectorAll('[data-source-section]'))
      .reduce((acc, el) => {
        const k = el.dataset.sourceSection
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {}),
  }))
  const prefixed = await goChecked(page, `${ORIGIN}/shanghai/buildings/${MAIN}`, { waitUntil: 'domcontentloaded' })
  report.routes.prefixedStatus = prefixed.status
  report.routes.prefixedSentinel = prefixed
  await page.close()
}

// ── sticky 包含块契约的直接证据（375 / 1440）──────────────────────────────
// 判据不是「滚到文档最底部时条还在」——那时看到的是站点页脚，早已读完全部
// 锚点区块；`.dt-page` 是包含块，页脚在它之外，sticky 本来就该在那里释放。
// 判据是「最后一个被锚点指向的区块读完时，条仍吸附在 top=44」。
report.stickyContainingBlock = {}
for (const [w, h] of [[375, 812], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await goChecked(page, `${ORIGIN}/buildings/${MAIN}`)
  await scrollThrough(page)
  report.stickyContainingBlock[w] = await page.evaluate(async () => {
    const last = document.querySelector('#related') ?? document.querySelector('#params')
    window.scrollTo({ top: window.scrollY + last.getBoundingClientRect().bottom - window.innerHeight + 20, behavior: 'instant' })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const atLastSectionEnd = document.querySelector('.dt-anchor-bar').getBoundingClientRect()
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const bar = document.querySelector('.dt-anchor-bar').getBoundingClientRect()
    const page_ = document.querySelector('.dt-page').getBoundingClientRect()
    const footer = document.querySelector('footer, .site-footer')?.getBoundingClientRect()
    return {
      atLastSectionEnd: { barTop: Math.round(atLastSectionEnd.top), stuck: Math.round(atLastSectionEnd.top) === 44 },
      atDocumentBottom: {
        barTop: Math.round(bar.top),
        lastSectionBottom: Math.round(last.getBoundingClientRect().bottom),
        dtPageBottom: Math.round(page_.bottom),
        footerHeight: footer ? Math.round(footer.height) : null,
      },
    }
  })
  await page.close()
}

await browser.close()
fs.writeFileSync(`${OUT}/task10-verify.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
