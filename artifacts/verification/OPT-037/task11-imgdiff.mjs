/**
 * OPT-037 Task 11：`task11-before-*.png` 与 `task11-after-*.png` 的逐像素比对。
 *
 * 判据：同名两张图逐像素比 RGB，任一通道差 > 8 记一个差异像素
 * （阈值 8 是为了不把 PNG 编码/抗锯齿的 ±1 噪声算成差异）。
 *
 * ⚠️ 2026-08-22 终审第 3 轮修：原实现按 `Math.min(高度)` 裁齐后再比，**页高不同时
 * 只比公共部分，差异率被稀释**——极端情况下「改后整页少了一大段」会比出 0 差异像素。
 * 现在同时给出两个口径，并让默认打印的百分比用**并集**分母：
 *   - `diffCommon`：公共区域内的差异像素（与旧口径可比，保留是为了不打断历史数字）
 *   - `diffUnion` ：公共区域差异 + **两图高度差那一段全部记为差异**
 *     （那一段在一侧根本不存在，「不存在」不是「相同」）
 * 高度不等本身就说明布局变了，所以 `heightDelta ≠ 0` 时额外打一行醒目提示。
 *
 * 另一条不要忘的旁证（写进 task-11b 报告，这里再记一次）：同一基线上
 * `building-nomedia-768` 在 Task 11 量到 6465、11b 量到 6181，高德 POI 抖动 284px。
 * **「页高相等 ⇒ 布局未变」在带 POI 面板的页面上本身就不稳**，比像素之前先看
 * `task11-*.json` 里的 sentinel / POI 面板对照。
 *
 * 用法：node task11-imgdiff.mjs
 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'
import fs from 'node:fs'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037'
const files = fs.readdirSync(DIR).filter((f) => f.startsWith('task11-before-') && f.endsWith('.png'))
for (const f of files) {
  const a = `${DIR}/${f}`
  const b = `${DIR}/${f.replace('task11-before-', 'task11-after-')}`
  const ma = await sharp(a).metadata()
  const mb = await sharp(b).metadata()
  const w = Math.min(ma.width, mb.width)
  const h = Math.min(ma.height, mb.height)
  const hMax = Math.max(ma.height, mb.height)
  const wMax = Math.max(ma.width, mb.width)
  const ra = await sharp(a).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const rb = await sharp(b).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const ch = ra.length / (w * h)
  let diff = 0
  let firstY = -1
  for (let i = 0; i < ra.length; i += ch) {
    if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) {
      diff += 1
      if (firstY < 0) firstY = Math.floor((i / ch) / w)
    }
  }
  // 只在一侧存在的像素：一律记为差异，不能因为「裁掉了」就当成相同
  const onlyOneSide = wMax * hMax - w * h
  const union = diff + onlyOneSide
  const heightDelta = mb.height - ma.height
  console.log(
    `${f.replace('task11-before-', '').padEnd(34)} h:${ma.height}->${mb.height}  diffCommon:${diff}  diffUnion:${union}  pctUnion:${(100 * union / (wMax * hMax)).toFixed(3)}  firstDiffY:${firstY}`,
  )
  if (heightDelta !== 0) {
    console.log(
      `${''.padEnd(34)}  ⚠️ 页高不等（Δ${heightDelta}px，${onlyOneSide} 个像素只在一侧存在）——公共区域的 diffCommon 天然被稀释，以 diffUnion 为准`,
    )
  }
}
