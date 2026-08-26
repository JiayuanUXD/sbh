/**
 * OPT-037 终审第 3 轮 R1：**多城开启态**（`MULTI_CITY_ROUTING_ENABLED=true`）的详情页路由。
 *
 * 为什么要重跑：`task-9-report.md:117-118` 写「开启多城时 legacy 307 → `/shanghai/...`，
 * JSON-LD `url` 与 breadcrumb 全部带城市前缀」，但 `task9-verify.json` 里唯一的
 * `prefixed` 记录四个断点**全都没有城市前缀**——因为 `task9-verify.mjs:10,13-14` 明写
 * 脚本必须在 `MULTI_CITY_ROUTING_ENABLED=` 为空（= 关闭态）下跑，**开启态那一轮从来没有产物**。
 * 报告拿关闭态的数据去支撑开启态的结论。这里把开启态真跑一遍。
 *
 * 关闭态同时跑一遍做对照：两态方向相反才说明测的确实是这个开关。
 *
 * 跑法（两个 server 同时开着，端口避开 3717）：
 *   CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> MULTI_CITY_ROUTING_ENABLED=false \
 *     PORT=3810 pnpm exec next start -p 3810
 *   CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> MULTI_CITY_ROUTING_ENABLED=true \
 *     PORT=3811 pnpm exec next start -p 3811
 *   node artifacts/verification/OPT-037/final-fix-3/r1-multicity.mjs
 *
 * 哨兵：每次导航都过 `lib/sentinel.mjs`（状态码 + 关键选择器），产物里逐条记 `sentinel`。
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked, headStatus } from '../lib/sentinel.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-3/r1-multicity.json'
const ORIGIN_ON = process.env.ORIGIN_ON ?? 'http://localhost:3811'
const ORIGIN_OFF = process.env.ORIGIN_OFF ?? 'http://localhost:3810'
const LISTING = 'jingan-serviced-office-42-seats'
const BUILDING = 'west-nanjing-premium-center'
const VIEWPORTS = [375, 768, 1440, 1920]

const readPage = (page) =>
  page.evaluate(() => {
    const ld = document.querySelector('script[type="application/ld+json"]')
    let jsonLd = null
    try {
      jsonLd = JSON.parse(ld?.textContent ?? 'null')
    } catch {
      jsonLd = null
    }
    const crumbs = Array.from(document.querySelectorAll('.breadcrumb a')).map((a) => a.getAttribute('href'))
    return {
      finalUrl: location.pathname,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
      jsonLdUrl: jsonLd?.url ?? null,
      /**
       * ⚠️ **只能断言 path，不能断言 origin。**
       * `lib/frontend/site-config.ts` 读的是**静态成员表达式** `process.env.NEXT_PUBLIC_SITE_URL`，
       * Next 在 `next build` 时把它**内联成字面量**（实测编译产物里是 `let b="http://localhost:3717"`，
       * 来自工作树 `.env.local`）。所以 `next start` 时再传 `NEXT_PUBLIC_SITE_URL=https://…`
       * 对页面里渲染出来的 canonical / JSON-LD `url` / OG **完全无效**；
       * 它只影响 `lib/runtime/config-guard.ts`（那边把整个 `process.env` 当对象传，是运行时读）。
       */
      jsonLdUrlPath: jsonLd?.url ? new URL(jsonLd.url).pathname : null,
      canonicalPath: (() => {
        const c = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
        return c ? new URL(c, location.origin).pathname : null
      })(),
      jsonLdBreadcrumbItems: Array.isArray(jsonLd?.itemListElement)
        ? jsonLd.itemListElement.map((i) => i.item)
        : null,
      breadcrumbHrefs: crumbs,
      /**
       * 判据：面包屑里每个站内链接都落在 `/shanghai` 命名空间内。
       * **首项是城市首页 `/shanghai` 本身**（不是 `/shanghai/`），所以不能只写
       * `startsWith('/shanghai/')`——第一版就是这么写的，四断点全判 false，
       * 差点又造出一条「与实际相反」的结论。
       */
      breadcrumbAllPrefixed: crumbs
        .filter(Boolean)
        .every((h) => h === '/shanghai' || h.startsWith('/shanghai/')),
      /** 关闭态的对照判据：一个带城市前缀的都不该有 */
      breadcrumbNonePrefixed: crumbs.filter(Boolean).every((h) => !h.startsWith('/shanghai')),
    }
  })

const browser = await chromium.launch()
const report = { origins: { on: ORIGIN_ON, off: ORIGIN_OFF }, modes: {} }

for (const [mode, origin] of [
  ['multiCityOn', ORIGIN_ON],
  ['multiCityOff', ORIGIN_OFF],
]) {
  const m = (report.modes[mode] = { legacyRedirect: {}, viewports: {} })

  // ── 1. legacy 路由的 HTTP 层行为（不开浏览器，`redirect: 'manual'` 直读）──
  for (const [key, path] of [
    ['listing', `/listings/${LISTING}`],
    ['building', `/buildings/${BUILDING}`],
  ]) {
    m.legacyRedirect[key] = { path, ...(await headStatus(origin + path)) }
  }

  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const v = (m.viewports[width] = {})

    // legacy 入口：跟随重定向后落在哪
    const legacySentinel = await gotoChecked(page, `${origin}/listings/${LISTING}`)
    v.legacy = { sentinel: legacySentinel, ...(await readPage(page)) }

    // prefixed 入口
    const prefixedSentinel = await gotoChecked(page, `${origin}/shanghai/listings/${LISTING}`)
    v.prefixed = { sentinel: prefixedSentinel, ...(await readPage(page)) }

    // 楼盘页 prefixed（报告同句也覆盖楼盘）
    const buildingSentinel = await gotoChecked(page, `${origin}/shanghai/buildings/${BUILDING}`)
    v.buildingPrefixed = { sentinel: buildingSentinel, ...(await readPage(page)) }

    await page.close()
  }
}

await browser.close()
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

for (const [mode, m] of Object.entries(report.modes)) {
  console.log(`\n=== ${mode} ===`)
  console.log(`  legacy 房源 → ${m.legacyRedirect.listing.status} ${m.legacyRedirect.listing.location ?? ''}`)
  console.log(`  legacy 楼盘 → ${m.legacyRedirect.building.status} ${m.legacyRedirect.building.location ?? ''}`)
  for (const [w, v] of Object.entries(m.viewports)) {
    console.log(
      `  ${w.padStart(4)}  legacy落点=${v.legacy.finalUrl}\n        prefixed: jsonLdUrlPath=${v.prefixed.jsonLdUrlPath} canonicalPath=${v.prefixed.canonicalPath} robots=${v.prefixed.robots}\n                  面包屑=${JSON.stringify(v.prefixed.breadcrumbHrefs)} 全前缀=${v.prefixed.breadcrumbAllPrefixed} 零前缀=${v.prefixed.breadcrumbNonePrefixed} sentinel=${v.prefixed.sentinel.status}/${v.prefixed.sentinel.ok}\n        楼盘prefixed: jsonLdUrlPath=${v.buildingPrefixed.jsonLdUrlPath} 面包屑=${JSON.stringify(v.buildingPrefixed.breadcrumbHrefs)} 全前缀=${v.buildingPrefixed.breadcrumbAllPrefixed}`,
    )
  }
}
