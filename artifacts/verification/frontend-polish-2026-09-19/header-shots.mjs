/**
 * 顶栏搜索框 + 页脚底栏取证脚本（PR #202 ③）。
 *
 * 产出（写进 `shots/`）：
 *   - `<tag>-<case>.png`：1440 视口、DPR 2，裁头部右半（x 640–1440，高 64）；页脚底栏整条。
 *   - `<tag>-report.json`：每个 case 的哨兵结果、搜索框计算样式、井内像素均值与对比度。
 *
 * 每次导航都过 OPT-037 的共享渲染哨兵（状态码 + 路由族关键选择器），哨兵不过直接抛，
 * 不会把 404 / 软 404 当成页面拍下来——Codex 审查（PR #202）要求的就是这一点。
 *
 * 像素取样不写死坐标：取 `.header-search__input` 的盒子，用 canvas measureText 量出占位文字
 * 的实际渲染宽度，采**文字右端到输入框右缘之间的空白带**（中线上下 8px），转换成截图像素
 * （× DPR，减去裁剪原点）。空白带不足 8px 直接抛错，不采。第一版按「右缘往左 34px」取，
 * 压到了「址」字的笔画上，均值偏暗 6–7 个色阶——这就是为什么要按文字宽度算。
 * 对比度用页面当时的 `--ink-2` / `--ink-3` / `--ink` 计算值，不在脚本里抄 token。
 *
 * 用法（dev server 已在 3717 起好）：
 *   node artifacts/verification/frontend-polish-2026-09-19/header-shots.mjs after
 *   # 「before」在 origin/master 的工作树上跑同一条命令、tag 传 before
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gotoOrThrow } from '../OPT-037/lib/sentinel.mjs'
import { decodePng, meanRgb } from './lib/png.mjs'
import { contrastRatio, parseCssColor } from './lib/contrast.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', 'payload-office-platform')
const { chromium } = createRequire(path.join(APP, 'package.json'))('@playwright/test')

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3717'
const tag = process.argv[2]
if (!tag) throw new Error('usage: node header-shots.mjs <tag>')
const OUT = path.join(HERE, 'shots')
mkdirSync(OUT, { recursive: true })

const DPR = 2
const CLIP = { x: 640, y: 0, width: 800, height: 64 }

const CASES = [
  // 首页：搜索框只在 hero 搜索被头部盖住后才出现，此时头部已是玻璃态压在 hero 上
  { name: 'home-scrolled', url: '/shanghai', scrollTo: 520 },
  { name: 'listings', url: '/shanghai/listings' },
  { name: 'listings-hover', url: '/shanghai/listings', hover: true },
  { name: 'listings-focus', url: '/shanghai/listings', focus: true },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR })
const report = { tag, origin: ORIGIN, viewport: '1440x900@2x', clip: CLIP, cases: [] }

for (const c of CASES) {
  const sentinel = await gotoOrThrow(page, ORIGIN + c.url)
  if (c.scrollTo) {
    await page.evaluate((y) => window.scrollTo(0, y), c.scrollTo)
    await page.waitForTimeout(600)
  }
  const form = page.locator('.header-search__form')
  await form.waitFor({ state: 'visible' })
  if (c.hover) await form.hover()
  if (c.focus) await page.locator('.header-search__input').focus()
  await page.waitForTimeout(400) // 超过 --duration-fast，读到的是过渡终态

  const measured = await page.evaluate(() => {
    const f = document.querySelector('.header-search__form')
    const input = document.querySelector('.header-search__input')
    const cs = getComputedStyle(f)
    const root = getComputedStyle(document.documentElement)
    const rect = input.getBoundingClientRect()
    const ics = getComputedStyle(input)
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = `${ics.fontWeight} ${ics.fontSize} ${ics.fontFamily}`
    const placeholderWidth = ctx.measureText(input.placeholder).width
    return {
      placeholderWidth,
      form: { background: cs.backgroundColor, border: cs.borderColor, boxShadow: cs.boxShadow },
      placeholderColor: getComputedStyle(input, '::placeholder').color,
      tokens: { ink: root.getPropertyValue('--ink').trim(), ink2: root.getPropertyValue('--ink-2').trim(), ink3: root.getPropertyValue('--ink-3').trim() },
      inputRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      headerTransparent: document.querySelector('.site-header').classList.contains('site-header--transparent'),
    }
  })

  const file = path.join(OUT, `${tag}-${c.name}.png`)
  const buf = await page.screenshot({ path: file, clip: CLIP })

  // 井内取样：占位文字右端 +6px 到输入框右缘 −4px 的空白带 × 中线上下 8px（CSS px），
  // 换算到裁剪后的截图像素。输入框是 LTR、无左 padding，文字从 rect.left 起排。
  const r = measured.inputRect
  const textEnd = r.left + measured.placeholderWidth
  const gapLeft = textEnd + 6
  const gapRight = r.right - 4
  if (gapRight - gapLeft < 8) throw new Error(`[${c.name}] 占位文字右侧空白只有 ${(gapRight - gapLeft).toFixed(1)}px，取样会压到字上`)
  const region = {
    x0: Math.round((gapLeft - CLIP.x) * DPR),
    x1: Math.round((gapRight - CLIP.x) * DPR),
    y0: Math.round(((r.top + r.bottom) / 2 - 8 - CLIP.y) * DPR),
    y1: Math.round(((r.top + r.bottom) / 2 + 8 - CLIP.y) * DPR),
  }
  const well = meanRgb(decodePng(buf), region)
  const ink = parseCssColor(measured.tokens.ink)
  const placeholder = parseCssColor(measured.placeholderColor)
  const contrast = {
    placeholder: Number(contrastRatio(placeholder, well).toFixed(2)),
    ink2: Number(contrastRatio(parseCssColor(measured.tokens.ink2), well).toFixed(2)),
    ink3: Number(contrastRatio(parseCssColor(measured.tokens.ink3), well).toFixed(2)),
    typedText: Number(contrastRatio(ink, well).toFixed(2)),
  }
  const entry = { case: c.name, url: c.url, sentinel, ...measured, sampleRegionPx: region, wellMeanRgb: well, contrast, file: path.basename(file) }
  report.cases.push(entry)
  console.log(c.name, JSON.stringify({ sentinel: sentinel.ok, bg: measured.form.background, well, contrast }))
}

// 页脚底栏：整条截下来 + innerText 落报告
{
  const sentinel = await gotoOrThrow(page, ORIGIN + '/shanghai/listings')
  const bar = page.locator('.site-footer__bar-inner')
  await bar.scrollIntoViewIfNeeded()
  const text = await bar.innerText()
  const file = path.join(OUT, `${tag}-footer-bar.png`)
  await bar.screenshot({ path: file })
  report.footerBar = { sentinel, innerText: text, file: path.basename(file) }
  console.log('footer-bar', JSON.stringify(text))
}

await browser.close()
writeFileSync(path.join(OUT, `${tag}-report.json`), JSON.stringify(report, null, 2) + '\n')
console.log(`report → shots/${tag}-report.json`)
