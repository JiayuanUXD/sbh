// OPT-038 终审修复 · 截图像素对比（随证据提交）
//
// 用途：证明本轮**唯一**的渲染变更（终审 I2：表单卡 ≤640 的 padding 40 → 16）
// 只落在 ≤640 那一档，768 / 1440 / 1920 三档逐像素零差异。
//
// ⚠️ 前提是两侧截图都来自真的渲染出来的页面：`final-fix-probe.mjs` 第一步就真读了
// HTTP 状态码，同轮还记录了 `.city-partner-form` 的盒模型（非空）。没有这两条时
// 「diffPixels: 0」可能只是两张 404 页比出来的（OPT-037 出过）。
//
// 跑法（cwd = payload-office-platform）：
//   node ../artifacts/verification/OPT-038/final-fix-shot-diff.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test')

const DIR = process.env.FINALFIX_OUT ?? dirname(fileURLToPath(import.meta.url))
const BEFORE = join(DIR, 'final-fix-shots-before')
const AFTER = join(DIR, 'final-fix-shots-after')

const browser = await chromium.launch()
const page = await browser.newPage()
const out = []

for (const f of readdirSync(BEFORE)) {
  const a = join(BEFORE, f)
  const b = join(AFTER, f)
  if (!existsSync(b)) {
    out.push({ file: f, err: 'after 缺这一张' })
    continue
  }
  const toData = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64')
  const r = await page.evaluate(
    async ([x, y]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const i = new Image()
          i.onload = () => res(i)
          i.onerror = rej
          i.src = src
        })
      const [ia, ib] = await Promise.all([load(x), load(y)])
      const mk = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        return c.getContext('2d').getImageData(0, 0, img.width, img.height).data
      }
      // 尺寸不同本身就是渲染差异（fullPage 高度随内容变）。这里不按 min 裁齐比——
      // 裁齐会**稀释差异率**；只在一侧存在的像素按「差异」计（.agent/testing.md）。
      const w = Math.min(ia.width, ib.width)
      const h = Math.min(ia.height, ib.height)
      const d1 = mk(ia)
      const d2 = mk(ib)
      let diff = 0
      let maxd = 0
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          const i1 = (row * ia.width + col) * 4
          const i2 = (row * ib.width + col) * 4
          const dd =
            Math.abs(d1[i1] - d2[i2]) +
            Math.abs(d1[i1 + 1] - d2[i2 + 1]) +
            Math.abs(d1[i1 + 2] - d2[i2 + 2])
          if (dd > 0) {
            diff += 1
            if (dd > maxd) maxd = dd
          }
        }
      }
      const onlyOneSide = ia.width * ia.height + ib.width * ib.height - 2 * w * h
      return {
        beforeSize: `${ia.width}x${ia.height}`,
        afterSize: `${ib.width}x${ib.height}`,
        sameSize: ia.width === ib.width && ia.height === ib.height,
        overlapDiffPixels: diff,
        overlapTotal: w * h,
        maxChannelDelta: maxd,
        // 只在一侧存在的像素（页高变化带来的），按「差异」计，不做裁齐稀释
        onlyOneSidePixels: onlyOneSide,
      }
    },
    [toData(a), toData(b)],
  )
  out.push({ file: f, ...r })
}

await browser.close()
writeFileSync(join(DIR, 'final-fix-shot-diff.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
