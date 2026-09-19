/**
 * 详情页主图 hover 缩放取证脚本（PR #202 ①）：指针在左右箭头上时图片不得缩回。
 *
 * 判据直接对应根因：箭头是 figure 下与主图按钮平级的覆盖层，所以指针在箭头上时
 * `button.matches(':hover')` 必为 false（旧选择器在此失配），而修复后的触发器挂在 figure 上，
 * `figure.matches(':hover')` 为 true、img 的 transform 保持 scale(1.04)。移出图片区域后回到 none。
 *
 * 用真实鼠标（page.mouse.move）而不是 JS 派发事件：`:hover` 只认真实指针。
 * 每一步等 450ms（> --duration-slow 320ms），读到的是过渡终态。
 *
 * 用法：node artifacts/verification/frontend-polish-2026-09-19/gallery-hover.mjs
 * 产出：shots/gallery-hover-report.json；任一判据不符退出码 1。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gotoOrThrow } from '../OPT-037/lib/sentinel.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', 'payload-office-platform')
const { chromium } = createRequire(path.join(APP, 'package.json'))('@playwright/test')

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3717'
const URL_PATH = '/shanghai/listings/media-rich-listing' // seed 房源，3 张图 → 主图有左右箭头
const OUT = path.join(HERE, 'shots')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const sentinel = await gotoOrThrow(page, ORIGIN + URL_PATH)

const boxes = await page.evaluate(() => {
  const fig = document.querySelector('.detail-gallery__main')
  const [prev, next] = fig.querySelectorAll('.detail-gallery__main-nav-button')
  const center = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const fr = fig.getBoundingClientRect()
  return {
    image: center(fig),
    prev: center(prev),
    next: center(next),
    // 图片区域右侧 80px：仍在视口内、不在 figure 里
    outside: { x: fr.right + 80, y: fr.top + fr.height / 2 },
  }
})

const readState = () => page.evaluate(() => {
  const fig = document.querySelector('.detail-gallery__main')
  const btn = fig.querySelector('.detail-gallery__main-media')
  const img = btn.querySelector('img')
  return { figHover: fig.matches(':hover'), btnHover: btn.matches(':hover'), transform: getComputedStyle(img).transform }
})

const SCALED = 'matrix(1.04, 0, 0, 1.04, 0, 0)'
const EXPECT = {
  image: { figHover: true, btnHover: true, transform: SCALED },
  prev: { figHover: true, btnHover: false, transform: SCALED },
  next: { figHover: true, btnHover: false, transform: SCALED },
  outside: { figHover: false, btnHover: false, transform: 'none' },
}

const steps = []
let failed = false
for (const where of ['image', 'prev', 'next', 'outside']) {
  await page.mouse.move(boxes[where].x, boxes[where].y)
  await page.waitForTimeout(450)
  const state = await readState()
  const expect = EXPECT[where]
  const ok = state.figHover === expect.figHover && state.btnHover === expect.btnHover && state.transform === expect.transform
  if (!ok) failed = true
  steps.push({ where, pointer: boxes[where], ...state, expect, ok })
  console.log(where, ok ? 'OK ' : 'FAIL', JSON.stringify(state))
}
await browser.close()

const report = { url: URL_PATH, sentinel, steps, ok: !failed }
writeFileSync(path.join(OUT, 'gallery-hover-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`report → shots/gallery-hover-report.json (${failed ? 'FAIL' : 'PASS'})`)
process.exit(failed ? 1 : 0)
