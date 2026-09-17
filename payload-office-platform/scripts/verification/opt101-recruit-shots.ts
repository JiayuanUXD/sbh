/**
 * OPT-101 城市招募页走查证据（一次性脚本，非生产代码）。
 *
 * 取证五件事：① 次要入口段与灰底带之间的间距（1440 / 375）；② 城市路由表单
 * 不再渲染「申请城市」且第一步只剩标题；③ 表单卡下方合规声明消失；
 * ④ `/city-partner` 仍保留城市选择器（那一面唯一的城市入口）；⑤ Hero 段最小高度
 * 480（≤767 为 400）且文案垂直居中。
 *
 * 前置：dev server 跑在 PORT（默认 3717），本地库 hangzhou 为 coming-soon 且
 * `MULTI_CITY_ROUTING_ENABLED=true`。
 * 运行：pnpm exec tsx scripts/verification/opt101-recruit-shots.ts
 * 产出：../artifacts/verification/OPT-101/*.png + probe.json
 */
import { chromium, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = `http://localhost:${process.env.PORT ?? 3717}`
const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', '..', '..', 'artifacts', 'verification', 'OPT-101')

type Probe = Readonly<{
  url: string
  viewport: string
  horizontalOverflow: boolean
  districtGridRendered: boolean
  hero: Readonly<{ height: number; minHeight: string; contentTopInset: number; contentBottomInset: number; hasBackdrop: boolean }> | null
  tailIsNextSiblingOfBand: boolean
  tailPaddingTop: string | null
  gapBandBottomToFirstCardTop: number | null
  citySelect: Readonly<{ disabled: boolean; value: string }> | null
  formLabels: readonly string[]
  stageOneH2: string | null
  stageOneHintP: string | null
  asideNoteInDom: boolean
  disclaimerTextOnPage: boolean
}>

async function probe(page: Page): Promise<Probe> {
  return page.evaluate((): Probe => {
    const band = document.querySelector('section.rc-section--band')
    const tail = document.querySelector('section.rc-section--tail')
    const firstCard = tail?.querySelector('.rc-cta') ?? null
    const form = document.querySelector('.city-partner-form')
    const header = form?.querySelector('header') ?? null
    const city = document.querySelector('#partner-city')
    const hero = document.querySelector('section.rc-section--hero')
    const heroInner = hero?.querySelector('.rc-hero') ?? null
    const heroBox = hero?.getBoundingClientRect() ?? null
    const innerBox = heroInner?.getBoundingClientRect() ?? null
    return {
      url: location.pathname + location.search,
      viewport: `${innerWidth}x${innerHeight}`,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      districtGridRendered: Boolean(document.getElementById('city-featured-regions')),
      hero: hero && heroBox && innerBox
        ? {
            height: Math.round(heroBox.height),
            minHeight: getComputedStyle(hero).minHeight,
            contentTopInset: Math.round(innerBox.top - heroBox.top),
            contentBottomInset: Math.round(heroBox.bottom - innerBox.bottom),
            hasBackdrop: Boolean(hero.querySelector('.city-coming-soon__media')),
          }
        : null,
      tailIsNextSiblingOfBand: Boolean(band && tail && band.nextElementSibling === tail),
      tailPaddingTop: tail ? getComputedStyle(tail).paddingTop : null,
      gapBandBottomToFirstCardTop: band && firstCard
        ? Math.round(firstCard.getBoundingClientRect().top - band.getBoundingClientRect().bottom)
        : null,
      citySelect: city instanceof HTMLSelectElement ? { disabled: city.disabled, value: city.value } : null,
      formLabels: form ? [...form.querySelectorAll('label')].map((l) => (l.textContent ?? '').trim().replace(/\s+/g, ' ')) : [],
      stageOneH2: header?.querySelector('h2')?.textContent ?? null,
      stageOneHintP: header?.querySelector('p')?.textContent ?? null,
      asideNoteInDom: Boolean(document.querySelector('.rc-aside__note')),
      disclaimerTextOnPage: document.body.innerText.includes('提交申请不代表合作确认'),
    }
  })
}

async function shotRegion(page: Page, file: string, selector: string, pad = 24): Promise<void> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`missing ${selector}`)
  await page.screenshot({
    path: path.join(OUT, file),
    fullPage: true,
    clip: { x: 0, y: Math.max(0, box.y - pad), width: page.viewportSize()?.width ?? 1440, height: box.height + pad * 2 },
  })
}

async function shotBandToCta(page: Page, file: string): Promise<void> {
  const band = await page.locator('section.rc-section--band').boundingBox()
  const card = await page.locator('section.rc-section--tail .rc-cta').first().boundingBox()
  if (!band || !card) throw new Error('missing band / cta')
  const top = band.y + band.height - 260
  await page.screenshot({
    path: path.join(OUT, file),
    fullPage: true,
    clip: { x: 0, y: top, width: page.viewportSize()?.width ?? 1440, height: card.y + card.height + 40 - top },
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const probes: Probe[] = []
  try {
    for (const [tag, viewport] of [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
      const page = await ctx.newPage()

      await page.goto(`${BASE}/hangzhou`, { waitUntil: 'networkidle' })
      probes.push(await probe(page))
      await shotRegion(page, `00-hangzhou-hero-${tag}.png`, 'section.rc-section--hero', 0)
      await shotRegion(page, `01-hangzhou-form-${tag}.png`, '.city-partner-form')
      await shotBandToCta(page, `02-hangzhou-band-to-cta-${tag}.png`)

      await page.goto(`${BASE}/city-partner?city=hangzhou`, { waitUntil: 'networkidle' })
      probes.push(await probe(page))
      if (tag === '1440') await shotRegion(page, `03-city-partner-form-${tag}.png`, '.city-partner-form')

      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  writeFileSync(path.join(OUT, 'probe.json'), `${JSON.stringify(probes, null, 2)}\n`)
  console.log(JSON.stringify(probes, null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
