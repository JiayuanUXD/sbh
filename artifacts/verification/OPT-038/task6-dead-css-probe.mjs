// OPT-038 Task 6 死规则探针（随证据提交）
//
// 判据是**两道都要过**，缺一不可（前一批的正反例）：
//   A. 带边界的全仓 grep —— 单靠它会误删 SDK 注入的类（`.amap-layer` grep 0 命中但运行时命中）；
//      也会误留字符串前缀撞车（`page-detail__summary` 撞 `.detail__summary`）。
//   B. 生产 server 上的运行时 `querySelectorAll` 扫描 —— 单靠它会误删模板串拼接出来的类
//      （`.city-switcher__status--live` 运行时 0 命中但 grep 命中）。
// 本脚本负责 B，并**附对照选择器**证明扫描本身有效（对照必须 > 0，否则整轮作废）。
//
// 跑法（cwd = payload-office-platform，@playwright/test 在那里的 node_modules）：
//   node ../artifacts/verification/OPT-038/task6-dead-css-probe.mjs
// 环境变量：TASK6_BASE（默认 http://127.0.0.1:3921）、TASK6_OUT（默认脚本同目录）、
//          TASK6_TAG（before / after，决定输出文件名与截图子目录）
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test')

const BASE = process.env.TASK6_BASE ?? 'http://127.0.0.1:3921'
const OUT = process.env.TASK6_OUT ?? dirname(fileURLToPath(import.meta.url))
const TAG = process.env.TASK6_TAG ?? 'before'
const SHOTS = join(OUT, `task6-shots-${TAG}`)

/** 预热清单：**真读 HTTP 状态码**，任一不符即抛。
 *  两侧都是 404 页也能比出「DOM 完全一致」，所以这一步不能省。 */
const WARMUP = [
  ['/', 200],
  ['/listings', 200],
  ['/buildings', 200],
  ['/city-partner', 200],
  ['/hangzhou', 200],
  ['/hangzhou/listings', 200],
  ['/hangzhou/buildings', 200],
]

/** 被扫的路由：`/city-partner` + `ComingSoonCityView` 挂着的城市路由。
 *  `/hangzhou/sale` 本地 404（预期），不列入。 */
const ROUTES = ['/city-partner', '/hangzhou', '/hangzhou/listings', '/hangzhou/buildings']

/** 摘除候选：styles.css 里 `.city-coming-soon*` / `.city-partner-page*` 的**每一个**类名。
 *  逐类名列全，不按标题边界整块处理。 */
const CANDIDATES = [
  'city-coming-soon__hero',
  'city-coming-soon__hero-grid',
  'city-coming-soon__intro',
  'city-coming-soon__eyebrow',
  'city-coming-soon__title',
  'city-coming-soon__lead',
  'city-coming-soon__benefits',
  'city-coming-soon__benefit-card',
  'city-coming-soon__benefit-icon',
  'city-coming-soon__benefit-content',
  'city-coming-soon__tenant-note',
  'city-coming-soon__form-card',
  'city-coming-soon__regions-section',
  'city-coming-soon__section-header',
  'city-coming-soon__district-grid',
  'city-coming-soon__district-card',
  'city-coming-soon__district-header',
  'city-coming-soon__district-name',
  'city-coming-soon__district-status',
  'city-coming-soon__district-sub',
  'city-coming-soon__stats',
  'city-coming-soon__stat-item',
  'city-coming-soon__stat-number',
  'city-coming-soon__stat-label',
  'city-coming-soon__dual-actions',
  'city-coming-soon__action-panel',
  'city-coming-soon__action-panel--tenant',
  'city-coming-soon__action-panel--landlord',
  'city-coming-soon__action-badge',
  'city-coming-soon__action-btn-wrap',
  'city-coming-soon__quick-links',
  'city-partner-page',
  'city-partner-page__intro',
  'city-partner-page__copy',
  'city-partner-page__eyebrow',
  'city-partner-page__lead',
  'city-partner-page__note',
]

/** 对照组：必须 > 0，否则说明扫描根本没扫到东西（选错路由 / 页面没渲染 / 选择器写法错），
 *  此时上面那一串 0 全是假的「死规则」证据。 */
const CONTROLS = [
  'city-coming-soon', // 城市路由根节点（`/city-partner` 上应为 0）
  'city-coming-soon__media', // 城市 profile 有 hero.media 时才有，允许 0，仅记录
  'city-coming-soon__embedded-form', // 城市路由的表单 className
  'city-partner-form', // 两个消费面都有
  'city-partner-form__step',
  'city-partner-form__consent',
  'rc-page',
  'rc-container',
  'rc-core',
  'rc-aside',
]

const BREAKPOINTS = [375, 768, 1440, 1920]
const SHOT_SURFACES = [
  { key: 'city-partner', path: '/city-partner' },
  { key: 'hangzhou', path: '/hangzhou' },
]

const report = { base: BASE, tag: TAG, warmup: [], scan: [], controlOk: null, shots: [] }

async function warmup() {
  for (const [path, expected] of WARMUP) {
    const res = await fetch(BASE + path, { redirect: 'manual' })
    report.warmup.push({ path, status: res.status, expected })
    if (res.status !== expected) {
      throw new Error(`预热失败：${path} → HTTP ${res.status}（期望 ${expected}）。环境不对，后面的一切都不算数`)
    }
  }
}

function countAll(names) {
  const out = {}
  for (const n of names) out[n] = document.querySelectorAll(`.${CSS.escape(n)}`).length
  return out
}

async function main() {
  await warmup()
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  let controlTotal = 0
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    const candidates = await page.evaluate(countAll, CANDIDATES)
    const controls = await page.evaluate(countAll, CONTROLS)
    controlTotal += Object.values(controls).reduce((a, b) => a + b, 0)
    report.scan.push({ route, candidates, controls })
  }
  report.controlOk = controlTotal > 0
  if (!report.controlOk) throw new Error('对照选择器全为 0：扫描本身无效，候选的 0 不构成证据')

  // 四断点截图（删 CSS 前后各一次，用于像素对比）。**改视口后必须 reload 再测/再拍**：
  // 不 reload 时 100vw 出血层保持旧视口宽（工作项 §5.5.2）。
  for (const s of SHOT_SURFACES) {
    for (const w of BREAKPOINTS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
      await page.reload({ waitUntil: 'networkidle' })
      const file = join(SHOTS, `${s.key}-${w}.png`)
      await page.screenshot({ path: file, fullPage: true })
      const box = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }))
      report.shots.push({ surface: s.key, width: w, file, ...box })
    }
  }

  await browser.close()
  writeFileSync(join(OUT, `task6-dead-css-probe-${TAG}.json`), JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ controlOk: report.controlOk, shots: report.shots.length }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
