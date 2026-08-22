/**
 * OPT-037 Task 10b 边界态验收脚本。
 *
 * 1. 字段全空楼盘（`test0814`，本地库里 grade/竣工/楼层/车位/规模全 null）——
 *    六格必须全部渲染 —，**不是 0、不是空白、不是整格消失**。
 * 2. 无公开供给楼盘（`empty-building`）——无图构图与「当前暂无公开可选空间」
 *    并存，两段互不影响。
 * 3. 房源详情页的同一构图（`/dev-story/opt037#detail-gallery-no-media`）——
 *    375 下修复前「可入驻 2026年9月1日」被压成四行竖排，这里复核每格值只占
 *    一行（长日期允许两行，见 task-10b-report.md）。
 *    该预览页**仅开发环境可见**（生产 404，见页面头部注释），所以它走第二个
 *    origin 参数（默认 dev server 3717），前两项走生产 server。
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked } from './lib/sentinel.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.argv[2] ?? 'http://localhost:3743'
const DEV_ORIGIN = process.argv[3] ?? 'http://localhost:3717'
const browser = await chromium.launch()
const report = {}

for (const slug of ['test0814', 'empty-building']) {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const sentinel = await gotoChecked(page, `${ORIGIN}/buildings/${slug}`)
    await page.screenshot({ path: `${OUT}/task10b-${slug}-${width}.png`, fullPage: true })
    report[`${slug}-${width}`] = {
      sentinel,
      status: sentinel.status,
      cells: await page.$$eval('.dt-keyspecs__item', (els) => els.map((el) => ({
        label: el.querySelector('.dt-keyspecs__label')?.textContent,
        value: el.querySelector('.dt-keyspecs__value')?.textContent,
      }))),
      meta: await page.$$eval('.dt-nomedia__meta-item', (els) => els.map((el) => el.textContent)),
      greyPlaceholder: await page.$$eval('.detail-gallery--empty', (els) => els.length),
      noOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    }
    await page.close()
  }
}

for (const width of [375, 768]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  // ⚠️ 2026-08-22 终审第 3 轮补：这一段原本不记状态码，而 `/dev-story/opt037`
  // **在 `next start` 下恒 404**（页面显式 notFound()），只有 `next dev` 才 200。
  // 不记状态码时，跑错 origin 就会静默产出一份空结论（本批已因此出过一次
  // 「四档 0 差异像素」的假结论）。哨兵不通过直接抛，不往下量。
  const devSentinel = await gotoChecked(page, `${DEV_ORIGIN}/dev-story/opt037#detail-gallery-no-media`)
  if (!devSentinel.ok) {
    throw new Error(`[sentinel] dev-story 页未渲染：${JSON.stringify(devSentinel)}（该路由只在 next dev 下 200）`)
  }
  report[`listing-nomedia-${width}-sentinel`] = devSentinel
  const section = await page.$('#detail-gallery-no-media')
  await section.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await section.screenshot({ path: `${OUT}/task10b-listing-nomedia-${width}.png` })
  report[`listing-nomedia-${width}`] = await page.$$eval('.dt-keyspecs__value', (els) =>
    els.map((el) => ({ text: el.textContent, height: Math.round(el.getBoundingClientRect().height) })),
  )
  await page.close()
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
