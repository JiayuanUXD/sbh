// OPT-038 Task 6 截图像素对比（随证据提交）
//
// 用途：「清理不得改变任何渲染输出」的证明。删 CSS 前后各跑一次
// `task6-dead-css-probe.mjs`（TASK6_TAG=before / after），本脚本逐张比像素。
//
// ⚠️ 前提是两侧的截图都来自**真的渲染出来的页面**：探针第一步就是真读 HTTP 状态码，
// 且同轮记录了对照选择器计数（`.rc-page` / `.city-partner-form` 等 > 0）。
// 没有这两条时「diffPixels: 0」可能只是两张 404 页比出来的（前一批出过）。
//
// 跑法（cwd = payload-office-platform）：
//   node ../artifacts/verification/OPT-038/task6-shot-diff.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test')

const DIR = process.env.TASK6_OUT ?? dirname(fileURLToPath(import.meta.url))
const BEFORE = join(DIR, 'task6-shots-before')
const AFTER = join(DIR, 'task6-shots-after')

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
      // 尺寸不同就已经是渲染差异（fullPage 截图的高度随内容变），直接标出来
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { wa: ia.width, ha: ia.height, wb: ib.width, hb: ib.height, diffPixels: -1 }
      }
      const mk = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        return c.getContext('2d').getImageData(0, 0, img.width, img.height).data
      }
      const d1 = mk(ia)
      const d2 = mk(ib)
      let diff = 0
      let maxd = 0
      for (let i = 0; i < d1.length; i += 4) {
        const dd =
          Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2])
        if (dd > 0) {
          diff++
          if (dd > maxd) maxd = dd
        }
      }
      return { w: ia.width, h: ia.height, diffPixels: diff, total: ia.width * ia.height, maxChannelDelta: maxd }
    },
    [toData(a), toData(b)],
  )
  out.push({ file: f, ...r })
}

await browser.close()
writeFileSync(join(DIR, 'task6-shot-diff.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
