/**
 * OPT-037 Task 11：`task11-before-*.png` 与 `task11-after-*.png` 的逐像素比对。
 *
 * 判据：同名两张图按较小尺寸对齐后逐像素比 RGB，任一通道差 > 8 记一个差异像素
 * （阈值 8 是为了不把 PNG 编码/抗锯齿的 ±1 噪声算成差异）。同时打印两图高度，
 * 高度不等本身就说明布局变了。
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
  console.log(
    `${f.replace('task11-before-', '').padEnd(34)} h:${ma.height}->${mb.height}  diffPx:${diff}  pct:${(100 * diff / (w * h)).toFixed(3)}  firstDiffY:${firstY}`,
  )
}
