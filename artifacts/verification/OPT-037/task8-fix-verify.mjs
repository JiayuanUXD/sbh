/**
 * OPT-037 Task 8 审查修正 —— 三断点验证脚本。
 *
 * 为什么脚本必须随证据一起提交（本次新立的规矩）：证据文件自己证明不了自己。
 * 上一轮 `task8-verify.json` 里的 `nearbyActive` 在 375/768 是 `#anchor-demo-spec`，
 * 而报告写的是「实测落到 nearby」——两句话都对，但对的是**两件不同的事**：
 * 那个键量的是「把 nearby 顶到 y=120（吸附线下方 20px）时高亮是谁」，
 * 答案本来就该是上一个区块；报告引用的 `atPageBottom` 来自另一支**没进仓、
 * 只在 1440 跑过、输出只打到 stdout** 的脚本。没有脚本就没人能复核。
 *
 * 跑法（dev server 必须显式连隔离库 sbh_dev_opt035，端口避开别人的 3717）：
 *   DATABASE_URL=postgres://<user>:<pass>@localhost:5432/sbh_dev_opt035 \
 *     pnpm exec next dev -p <free-port>
 *   node artifacts/verification/OPT-037/task8-fix-verify.mjs
 *
 * 输出：artifacts/verification/OPT-037/task8-fix-verify.json + 同目录截图。
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked } from './lib/sentinel.mjs'
import fs from 'node:fs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const URL = 'http://localhost:3717/dev-story/opt037'
const SCOPES = ['a', 'b', 'c']
const A_IDS = [
  'anchor-demo-a-supply',
  'anchor-demo-a-location',
  'anchor-demo-a-spec',
  'anchor-demo-a-nearby',
]

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = {}

const activeOf = (scope) => `[data-anchor-demo="${scope}"] .dt-anchor-bar a[aria-current]`

for (const [w, h] of [
  [1440, 900],
  [768, 1024],
  [375, 812],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  // ⚠️ 2026-08-22 终审第 3 轮补：原来不读状态码。本脚本量的是 dev-story 演示页，
  // 而 `/dev-story/opt037` 在 `next start` 下恒 404（页面显式 notFound()）——
  // 不记状态码时，一次跑错环境就会把整份产物变成「对着 404 页量出来的数字」。
  const sentinel = await gotoChecked(page, URL)
  const r = (report[w] = { sentinel })

  // ── 1. 页面级横向溢出（进入时） ──────────────────────────────────────
  r.overflowTop = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  // ── 2. 全幅（审查 Issue 1）：外层横贯视口、内层容器居中 ───────────────
  // 判据是「外层左边界 = 0 且宽 = documentElement.clientWidth」——不是「宽度
  // 看起来挺大」。同时量内层，确认它就是 .dt-container 的 min(1180, 100%-32)，
  // 没有被套进定宽父级二次内缩。
  await page.locator('#anchor-nav-bar').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  r.fullBleed = await page.evaluate((scopes) => {
    const clientWidth = document.documentElement.clientWidth
    const expectInner = Math.min(1180, clientWidth - 32)
    return scopes.map((s) => {
      const bar = document.querySelector(`[data-anchor-demo="${s}"] .dt-bar`)
      if (!bar) return { scope: s, present: false }
      const inner = bar.querySelector('.dt-bar__inner')
      const b = bar.getBoundingClientRect()
      const i = inner.getBoundingClientRect()
      return {
        scope: s,
        present: true,
        display: getComputedStyle(bar).display,
        barX: Math.round(b.x),
        barW: Math.round(b.width),
        clientWidth,
        isFullBleed: Math.round(b.x) === 0 && Math.round(b.width) === clientWidth,
        innerW: Math.round(i.width),
        expectInner,
        innerOk: Math.round(i.width) === expectInner,
      }
    })
  }, SCOPES)

  // ── 3. 吸附态几何 + 截图 ─────────────────────────────────────────────
  await page.evaluate(() => {
    const sec = document.getElementById('anchor-demo-a-location')
    window.scrollTo(0, sec.getBoundingClientRect().top + window.scrollY - 40)
  })
  await page.waitForTimeout(300)
  r.stuck = await page.evaluate(() => {
    const bar = document.querySelector('[data-anchor-demo="a"] .dt-bar')
    const b = bar.getBoundingClientRect()
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
      position: getComputedStyle(bar).position,
      headerH: Math.round(document.querySelector('.site-header').getBoundingClientRect().height),
    }
  })
  await page.screenshot({ path: `${OUT}/task8-fix-stuck-${w}.png` })

  // ── 4. 逐个点击锚点：落点 + 呼吸 + elementFromPoint 不吞点击 ──────────
  r.clicks = []
  for (const id of A_IDS) {
    const link = page.locator(`[data-anchor-demo="a"] a[href="#${id}"]`).first()
    if ((await link.count()) === 0) {
      r.clicks.push({ id, skipped: 'link absent' })
      continue
    }
    await link.click()
    await page.waitForTimeout(700) // 平滑滚动
    r.clicks.push({
      id,
      ...(await page.evaluate((targetId) => {
        const sec = document.getElementById(targetId)
        const heading = sec.querySelector('h3')
        const bar = document.querySelector('[data-anchor-demo="a"] .dt-bar')
        const secR = sec.getBoundingClientRect()
        const hR = heading.getBoundingClientRect()
        const bR = bar.getBoundingClientRect()
        const under = document.elementFromPoint(
          Math.round(window.innerWidth / 2),
          Math.round(bR.bottom + 2),
        )
        const inBar = document.elementFromPoint(
          Math.round(window.innerWidth / 2),
          Math.round(bR.top + bR.height / 2),
        )
        const active = document.querySelector('[data-anchor-demo="a"] a[aria-current]')
        return {
          secTop: Math.round(secR.top),
          headingTop: Math.round(hR.top),
          barBottom: Math.round(bR.bottom),
          // 审查 Issue 7：落点与条底边之间必须留呼吸，不能恰好 0
          breathing: Math.round(secR.top - bR.bottom),
          headingClear: hR.top >= bR.bottom - 0.5,
          underBarTag: under ? `${under.tagName}.${under.className}`.slice(0, 60) : null,
          underBarInsideBar: under ? !!under.closest('.dt-anchor-bar') : null,
          barHitIsBar: inBar ? !!inBar.closest('.dt-anchor-bar') : null,
          activeHref: active ? active.getAttribute('href') : null,
          pageOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, id)),
    })
    await page.screenshot({ path: `${OUT}/task8-fix-click-${id}-${w}.png` })
  }

  // ── 5. 高亮跟随（连续滚动采样） ──────────────────────────────────────
  r.spy = []
  const base = await page.evaluate(
    () =>
      document.getElementById('anchor-demo-a-supply').getBoundingClientRect().top + window.scrollY,
  )
  for (const delta of [-200, 0, 300, 500, 900, 1400, 1800]) {
    await page.evaluate((y) => window.scrollTo(0, y), base + delta - 100)
    await page.waitForTimeout(250)
    r.spy.push({
      delta,
      active: await page.evaluate(
        (sel) => document.querySelector(sel)?.getAttribute('href') ?? null,
        activeOf('a'),
      ),
    })
  }

  // ── 6. 边界 3（审查 Issue 4）：滚过包含块末尾后高亮不得跳回第一项 ──────
  // 滚到 scope c（远在 scope a 的包含块之后）。此时 a 的 bar 早已脱附、
  // 被推出视口，`getBoundingClientRect().bottom` 是大负数。未夹下限时
  // `crossed` 会全空 → 走 highest → 高亮跳回第一项 supply。
  await page.evaluate(() => {
    const el = document.querySelector('[data-anchor-demo="c"]')
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40)
  })
  await page.waitForTimeout(350)
  r.pastContainingBlock = await page.evaluate((sel) => {
    const bar = document.querySelector('[data-anchor-demo="a"] .dt-bar')
    const a = document.querySelector(sel)
    return {
      rawBarBottom: Math.round(bar.getBoundingClientRect().bottom),
      barIsOffscreen: bar.getBoundingClientRect().bottom < 0,
      active: a ? a.getAttribute('href') : null,
      firstItem: '#anchor-demo-a-supply',
      lastItem: '#anchor-demo-a-nearby',
    }
  }, activeOf('a'))

  // ── 7. 边界 2（审查 Issue 3）：真·页面底部 ───────────────────────────
  // 7a. 自然状态：页尾还有 scope b/c 与站点页脚，先如实记录残差与结论。
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(400)
  r.bottomNatural = await page.evaluate((sel) => {
    const doc = document.documentElement
    const bar = document.querySelector('[data-anchor-demo="a"] .dt-bar')
    const last = document.getElementById('anchor-demo-a-nearby').getBoundingClientRect()
    const a = document.querySelector(sel)
    return {
      // 「滚到底」的残差：innerHeight + scrollY 与 scrollHeight 差多少 px。
      // 这个数直接回答「容差 2px 到底够不够」——审查怀疑是它导致兜底不触发。
      residual: +(doc.scrollHeight - (window.innerHeight + window.scrollY)).toFixed(3),
      lastTop: Math.round(last.top),
      line: Math.round(bar.getBoundingClientRect().bottom),
      active: a ? a.getAttribute('href') : null,
    }
  }, activeOf('a'))

  // 7b. 隔离出边界 2 的真实触发条件：「最后一个锚点区块很矮，且页面到它就结束」。
  // 预览页里 scope a 之后还挂着 scope b/c 与站点页脚（375 下页脚本身就比视口高），
  // 所以自然状态下页面滚到底时 scope a 早已整体滚过——那是边界 3 的场景，不是
  // 边界 2。把 scope a 之后的东西全部 display:none，页面尾部就变成生产楼盘页
  // 「最后一个区块 + 很短的页脚」的形态，三个断点都能真正走到兜底分支。
  // 这是对 DOM 的临时改动，做完立即还原；改了什么全写在这里，可复核。
  await page.evaluate(() => {
    document.querySelector('.site-footer').style.display = 'none'
    for (const s of ['b', 'c'])
      document.querySelector(`[data-anchor-demo="${s}"]`).style.display = 'none'
  })
  await page.waitForTimeout(200)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(450)
  r.bottomIsolated = await page.evaluate((sel) => {
    const doc = document.documentElement
    const bar = document.querySelector('[data-anchor-demo="a"] .dt-bar')
    const bR = bar.getBoundingClientRect()
    const last = document.getElementById('anchor-demo-a-nearby').getBoundingClientRect()
    const a = document.querySelector(sel)
    return {
      residual: +(doc.scrollHeight - (window.innerHeight + window.scrollY)).toFixed(3),
      barStillStuck: Math.round(bR.y),
      line: Math.round(bR.bottom),
      lastTop: Math.round(last.top),
      // 主规则要的是「越线」；这里必须是 false，否则根本没走到兜底
      lastCrossedLine: last.top <= bR.bottom + 1,
      active: a ? a.getAttribute('href') : null,
      expected: '#anchor-demo-a-nearby',
    }
  }, activeOf('a'))
  await page.screenshot({ path: `${OUT}/task8-fix-bottom-fallback-${w}.png` })
  await page.evaluate(() => {
    document.querySelector('.site-footer').style.display = ''
    for (const s of ['b', 'c'])
      document.querySelector(`[data-anchor-demo="${s}"]`).style.display = ''
  })

  // ── 8. 三态 + ≤767 空条（审查 Issue 2） ──────────────────────────────
  await page.locator('[data-anchor-demo="b"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  r.variants = await page.evaluate((scopes) =>
    scopes.map((s) => {
      const b = document.querySelector(`[data-anchor-demo="${s}"] .dt-anchor-bar`)
      const cs = getComputedStyle(b)
      const links = b.querySelector('.dt-anchor-bar__links')
      const title = b.querySelector('.dt-anchor-bar__title')
      const cta = b.querySelector('.dt-anchor-bar__cta')
      const btn = b.querySelector('.dt-anchor-bar__cta .btn')
      const visible = cs.display !== 'none'
      return {
        scope: s,
        title: title?.textContent ?? null,
        links: [...b.querySelectorAll('.dt-anchor-bar__link')].map((a) => a.getAttribute('href')),
        hasLinksGroup: !!links,
        hasNoLinksFlag: b.classList.contains('dt-anchor-bar--no-links'),
        barVisible: visible,
        // 占位高度：整条被收掉时必须是 0，不能留一条纯空白的 56px 遮挡条
        occupiedHeight: Math.round(b.getBoundingClientRect().height),
        titleVisible: title ? getComputedStyle(title).display !== 'none' : null,
        ctaVisible: cta ? getComputedStyle(cta).display !== 'none' : null,
        // 「本条最终有没有可见内容」——这才是硬约束该落的地方
        hasVisibleContent:
          visible &&
          (!!links ||
            (title && getComputedStyle(title).display !== 'none') ||
            (cta && getComputedStyle(cta).display !== 'none')),
        ctaBtnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
        linkH: (() => {
          const a = b.querySelector('.dt-anchor-bar__link')
          return a ? Math.round(a.getBoundingClientRect().height) : null
        })(),
        linksScrollable: links
          ? { scrollWidth: links.scrollWidth, clientWidth: links.clientWidth }
          : null,
        position: cs.position,
      }
    }),
  SCOPES)
  await page.screenshot({ path: `${OUT}/task8-fix-variants-${w}.png` })

  // 只剩 1 项那条单独拍一张：≤767 应当整条不存在（下方内容顶上来）
  await page.locator('[data-anchor-demo="c"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/task8-fix-one-item-${w}.png` })

  // ── 9. 页面级横向溢出（离开时） ──────────────────────────────────────
  r.overflowBottom = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  // ── 10. 锚点组横滚（只在 375 这一轮补测 320） ────────────────────────
  // `.dt-page` 破掉 `.site-main` 的 24px 内边距后，375 下容器从 295 变回稿子
  // 要求的 343，四个锚点 336px 反而**放得下了**——横滚加固还在，但 375 已经
  // 触发不到它。再窄一档（320，仍是真实在售机型宽度）才真正溢出，用它证明
  // 「溢出由锚点组自己消化」这条不变量没有随宽度变化失效。
  // 注意 `pageOverflow` 在 320 下是 5 而不是 0：那 5px 来自 Task 6 的
  // `.dt-keyspecs`（实测 `right` 超出容器 5px），**不是锚点条**，而且先于本次
  // 改动存在——同一页在 320 下不出血时页面级溢出是 29px，出血后反而降到 5px。
  // 320 也不在本批要求的三个断点内。这里如实记录，不顺手改别的任务的组件。
  if (w === 375) {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.locator('[data-anchor-demo="a"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    r.narrow320 = await page.evaluate(() => {
      const g = document.querySelector('[data-anchor-demo="a"] .dt-anchor-bar__links')
      const before = g.scrollLeft
      g.scrollLeft = 999
      const after = g.scrollLeft
      return {
        scrollWidth: g.scrollWidth,
        clientWidth: g.clientWidth,
        overflows: g.scrollWidth > g.clientWidth,
        scrollLeftBefore: before,
        scrollLeftAfter: after,
        pageOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    await page.screenshot({ path: `${OUT}/task8-fix-links-scroll-320.png` })
    await page.setViewportSize({ width: 375, height: 812 })
  }

  await page.close()
}

await browser.close()
fs.writeFileSync(`${OUT}/task8-fix-verify.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
