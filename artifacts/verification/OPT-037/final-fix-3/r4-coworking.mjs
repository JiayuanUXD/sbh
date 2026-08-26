/**
 * OPT-037 终审第 3 轮 R4：Task 7-fixes 的「联合办公组」态**重拍**，并把每张截图前的
 * `documentElement.scrollWidth === clientWidth` 断言**落成 JSON**。
 *
 * 为什么必须重拍（终审第 2 视角 N1，已复核属实）：
 *   `task7-fix-group-coworking-375.png` 与 `task7-fix-empty-result-375.png`
 *   **md5 完全相同**（`376888c0…`），768 那一对同样字节相同。原因是
 *   `?group=coworking` 打在了 **没有联合办公供给** 的 `west-nanjing-premium-center` 上，
 *   视图层回落到默认组 + 域层按不存在的组过滤 → 渲染成「租赁组 + 筛空」。
 *   于是「某组为空」与「筛到空结果」两态在证据里不可区分。
 *   原文同句「每张截图前都断言 scrollWidth === clientWidth，21/21 通过」**零产物**。
 *
 * 换样本：`huangpu-bund` 是本地夹具里唯一同时有租赁组与联合办公组的楼盘
 *   （`/buildings/huangpu-bund` 页面上真的渲染出两条 tab）。
 *
 * 四态**在同一栋楼上**取，保证两两可区分：
 *   coworking-real  真联合办公组（tab 存在且被选中，表里有行）
 *   lease-default   默认租赁组（对照）
 *   empty-result    同一栋楼筛到空结果（tab 仍在，active 是默认组，正文是「暂无匹配空间」）
 *   coworking-absent  ⚠️ 另一栋**没有**联合办公供给的楼盘上打 `?group=coworking`
 *                    ——这一态就是原证据误当成 coworking 的那一态，单独留档并量它的自相矛盾
 *
 * 跑法：node artifacts/verification/OPT-037/final-fix-3/r4-coworking.mjs
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked } from '../lib/sentinel.mjs'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-3'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3810'
const VIEWPORTS = [375, 768, 1440]

const CASES = [
  ['coworking-real', '/buildings/huangpu-bund?group=coworking'],
  ['lease-default', '/buildings/huangpu-bund'],
  ['empty-result', '/buildings/huangpu-bund?areaMin=0&areaMax=100'],
  ['coworking-absent', '/buildings/west-nanjing-premium-center?group=coworking'],
]

/** 页面级横向溢出：判据是 `documentElement.scrollWidth ≤ clientWidth`，不是「看起来没横条」。 */
const measure = (page) =>
  page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.building-supply-browser__tab')).map((a) => ({
      label: a.textContent.trim().replace(/\s+/g, ' '),
      href: a.getAttribute('href'),
      active: a.dataset.active === 'true',
    }))
    const de = document.documentElement
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflowPx: de.scrollWidth - de.clientWidth,
      noOverflow: de.scrollWidth <= de.clientWidth,
      tabs,
      activeTabLabel: tabs.find((t) => t.active)?.label ?? null,
      activeTabHref: tabs.find((t) => t.active)?.href ?? null,
      tableRows: document.querySelectorAll('.building-supply-browser__table tbody tr').length,
      cardRows: document.querySelectorAll('.building-supply-browser__cards .listing-card').length,
      emptyFiltered: Array.from(document.querySelectorAll('.building-supply-browser__empty')).map((p) =>
        p.textContent.trim(),
      ),
      /**
       * 自相矛盾检测：active tab 的计数 > 0 却渲染「当前筛选下暂无匹配空间」，
       * 且 URL 上没有任何用户可见的筛选 pill 被激活 —— 这就是 coworking-absent 那一态。
       */
      activeTabCount: Number(
        document.querySelector('.building-supply-browser__tab[data-active="true"] .building-supply-browser__tab-count')
          ?.textContent ?? 'NaN',
      ),
      /**
       * ⚠️ 选择器是 `.building-supply-browser__filter[data-active]`（**自身**带属性），
       * 不是后代选择器——`__filter` 就是那个 `<a>` 本身。第一版写成后代选择器，
       * 四个用例全量到空数组，正是「一个永远为空的字段」这类假证据。
       * 「全部」那颗 pill 默认就是 active（href 无 query），所以只记**带 query** 的那些：
       * 它们才是「用户看得见、也点得掉」的筛选。
       */
      activeFilterPills: Array.from(
        document.querySelectorAll('.building-supply-browser__filter[data-active="true"]'),
      ).map((el) => ({ label: el.textContent.trim(), href: el.getAttribute('href') })),
      userVisibleActiveFilters: Array.from(
        document.querySelectorAll('.building-supply-browser__filter[data-active="true"]'),
      )
        .filter((el) => (el.getAttribute('href') ?? '').includes('?'))
        .map((el) => el.textContent.trim()),
    }
  })

const browser = await chromium.launch()
const report = { origin: ORIGIN, cases: {} }

for (const [name, path] of CASES) {
  const c = (report.cases[name] = { path, viewports: {} })
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    // 哨兵：状态码 + 关键选择器。不通过就不拍照，也不写数字。
    const sentinel = await gotoChecked(page, ORIGIN + path)
    const m = sentinel.ok ? await measure(page) : null
    const file = `${DIR}/r4-${name}-${width}.png`
    if (sentinel.ok) await page.screenshot({ path: file, fullPage: true })
    c.viewports[width] = { sentinel, shot: sentinel.ok ? file.split('/').pop() : null, ...(m ?? {}) }
    await page.close()
  }
}

await browser.close()
writeFileSync(`${DIR}/r4-coworking.json`, JSON.stringify(report, null, 2), 'utf8')

for (const [name, c] of Object.entries(report.cases)) {
  console.log(`\n=== ${name}  ${c.path} ===`)
  for (const [w, v] of Object.entries(c.viewports)) {
    console.log(
      `  ${w.padStart(4)} sentinel=${v.sentinel.status}/${v.sentinel.ok}  scrollWidth=${v.scrollWidth}/${v.clientWidth} 无溢出=${v.noOverflow}  activeTab=${JSON.stringify(v.activeTabLabel)} count=${v.activeTabCount} tabs=${v.tabs?.length}  表行=${v.tableRows} 卡片=${v.cardRows} 空态=${JSON.stringify(v.emptyFiltered)} 可见筛选=${JSON.stringify(v.userVisibleActiveFilters)}`,
    )
  }
}
