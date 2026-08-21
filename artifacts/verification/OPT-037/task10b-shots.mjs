/**
 * OPT-037 Task 10b 验收脚本：楼盘详情页「无图替代构图」四断点 + 两态对比。
 *
 * 两态取样点（本地 `postgres` 库实测：buildings_media_items 与 buildings_gallery
 * 均为 0 行 —— 所有真实楼盘都是无图态，这正是本任务的动因）：
 *   - 无图态：`/buildings/west-nanjing-premium-center`（真实库，mediaItems 为空）
 *   - 有图态：`/dev-story/building-detail-demo`（fixture 带 4 条 mediaItems，
 *     是仓库里唯一能产出「楼盘 + 有图」的入口）
 *
 * 用法：node task10b-shots.mjs <origin> <tag>
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.argv[2] ?? 'http://localhost:3717'
const TAG = process.argv[3] ?? 'task10b'
const VIEWPORTS = [[375, 812], [768, 1024], [1440, 900], [1920, 1080]]
const CASES = [
  { name: 'nomedia', url: '/buildings/west-nanjing-premium-center' },
  { name: 'withmedia', url: '/dev-story/building-detail-demo' },
]

const browser = await chromium.launch()
const report = []
for (const { name, url } of CASES) {
  for (const [width, height] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${ORIGIN}${url}`, { waitUntil: 'networkidle' })
    // 触发懒加载（地图/图片）后回顶，保证首屏截图内容完整
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${TAG}-${name}-top-${width}.png` })
    await page.screenshot({ path: `${OUT}/${TAG}-${name}-full-${width}.png`, fullPage: true })
    const measured = await page.evaluate(() => {
      const de = document.documentElement
      const grid = document.querySelector('.dt-nomedia')
      const placeholder = document.querySelector('.detail-gallery--empty')
      const gallery = document.querySelector('.detail-gallery:not(.detail-gallery--empty)')
      const cells = [...document.querySelectorAll('.dt-keyspecs__item')].map((el) => ({
        label: el.querySelector('.dt-keyspecs__label')?.textContent ?? '',
        value: el.querySelector('.dt-keyspecs__value')?.textContent ?? '',
        unit: el.querySelector('.dt-keyspecs__unit')?.textContent ?? null,
      }))
      return {
        noOverflow: de.scrollWidth <= de.clientWidth,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        hasNoMediaGrid: grid != null,
        hasGreyPlaceholder: placeholder != null,
        hasGallery: gallery != null,
        gridBox: grid ? { w: Math.round(grid.getBoundingClientRect().width), h: Math.round(grid.getBoundingClientRect().height) } : null,
        cells,
        zeroValues: cells.filter((c) => c.value.trim() === '0').map((c) => c.label),
      }
    })
    report.push({ case: name, width, ...measured, consoleErrors: errors })
    await page.close()
  }
}
await browser.close()
console.log(JSON.stringify(report, null, 2))
