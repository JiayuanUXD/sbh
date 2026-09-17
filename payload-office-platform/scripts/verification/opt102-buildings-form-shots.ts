/**
 * OPT-102 楼盘编辑页两 tab 走查证据（一次性脚本，非生产代码）。
 *
 * 取证：① 两个 tab 的标签与分节标题；② 每个 row 的列基（基本信息 33.333%、其余 25%、SEO 100%）；
 * ③ group 去框并与组外同轴；④ 版本号是只读展示态；⑤ 1440 / 375 两档整页截图。
 *
 * ⚠️ Payload 的 RenderFields 外面套着 RenderIfInViewport：**没滚进视口的字段不渲染**
 * （group 的 .render-fields 在折下时是空的）。截图与探针前必须把整页滚一遍，否则会把
 * 懒加载误判成「组内字段没渲染」——本次走查先踩了一次。
 *
 * 前置：dev server 跑在 PORT（默认 3717），本地库已 seed（e2e-adm 夹具账号），楼盘 id=1 存在。
 * 运行：pnpm exec tsx scripts/verification/opt102-buildings-form-shots.ts
 * 产出：../artifacts/verification/OPT-102/*.png + probe.json
 */
import { chromium, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = `http://localhost:${process.env.PORT ?? 3717}`
const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', '..', '..', 'artifacts', 'verification', 'OPT-102')
const BUILDING_ID = process.env.BUILDING_ID ?? '1'

type Probe = Readonly<{
  viewport: string
  tab: string
  tabs: readonly string[]
  sections: readonly string[]
  rows: readonly (readonly string[])[]
  groups: readonly { title: string | null; children: number | null; border: string; marginLeft: string }[]
  readonly: readonly string[]
  richTextEditors: number
  dataSourceRendered: boolean
}>

async function scrollWholePage(page: Page): Promise<void> {
  // 用字符串而不是函数体：tsx（esbuild keepNames）会给函数体里的 `const fn = () => …`
  // 包一层 `__name(...)`，序列化进浏览器后 `__name` 未定义直接 ReferenceError。
  await page.evaluate(
    `(async () => {
      const el = document.scrollingElement
      for (let y = 0; y <= el.scrollHeight; y += 400) { el.scrollTop = y; await new Promise((r) => setTimeout(r, 100)) }
      el.scrollTop = 0
      await new Promise((r) => setTimeout(r, 300))
    })()`,
  )
}

async function switchTab(page: Page, index: number): Promise<void> {
  await page.locator('.tabs-field__tab-button').nth(index).click()
  await page.waitForTimeout(600)
  await scrollWholePage(page)
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate((): Probe => {
    const active = document.querySelector('.tabs-field__tab-button--active')?.textContent?.trim() ?? ''
    return {
      viewport: `${innerWidth}x${innerHeight}`,
      tab: active,
      tabs: [...document.querySelectorAll('.tabs-field__tab-button')].map((b) => b.textContent?.trim() ?? ''),
      sections: [...document.querySelectorAll('.tabs-field__tab .listing-form-section__title')].map((h) => h.textContent?.trim() ?? ''),
      rows: [...document.querySelectorAll('.tabs-field__tab .row__fields')].map((r) =>
        [...r.children].map((c) => `${c.querySelector('label')?.textContent?.trim() ?? c.className.split(' ')[0]}:${getComputedStyle(c).flexBasis}`),
      ),
      groups: [...document.querySelectorAll('.tabs-field__tab .group-field')].map((g) => ({
        title: g.querySelector('.group-field__title')?.textContent?.trim() ?? null,
        children: g.querySelector('.render-fields')?.children.length ?? null,
        border: getComputedStyle(g).borderTopWidth,
        marginLeft: getComputedStyle(g).marginLeft,
      })),
      readonly: [...document.querySelectorAll('.tabs-field__tab .listing-readonly')].map((n) => (n.textContent ?? '').trim().replace(/\s+/g, ' ')),
      richTextEditors: document.querySelectorAll('[contenteditable="true"]').length,
      dataSourceRendered: Boolean(document.querySelector('[id="field-dataSource"]')),
    }
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const probes: Probe[] = []
  try {
    for (const [tag, viewport] of [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
      const login = await ctx.request.post(`${BASE}/api/users/login`, { data: { email: 'e2e-adm@example.com', password: 'Test1234!' } })
      if (login.status() !== 200) throw new Error(`login failed HTTP ${login.status()}`)
      const page = await ctx.newPage()
      await page.goto(`${BASE}/admin/collections/buildings/${BUILDING_ID}`, { waitUntil: 'networkidle' })
      await page.locator('.tabs-field__tab-button').first().waitFor()

      await switchTab(page, 0)
      probes.push(await probe(page))
      await page.screenshot({ path: path.join(OUT, `01-buildings-tab-basic-${tag}.png`), fullPage: true })

      await switchTab(page, 1)
      probes.push(await probe(page))
      await page.screenshot({ path: path.join(OUT, `02-buildings-tab-display-${tag}.png`), fullPage: true })

      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  writeFileSync(path.join(OUT, 'probe.json'), `${JSON.stringify(probes, null, 2)}\n`)
  console.log(JSON.stringify(probes.map((p) => ({ viewport: p.viewport, tab: p.tab, tabs: p.tabs, sections: p.sections, rowCount: p.rows.length, groups: p.groups, readonly: p.readonly })), null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
