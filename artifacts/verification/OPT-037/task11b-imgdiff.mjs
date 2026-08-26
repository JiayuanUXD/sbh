/**
 * OPT-037 Task 11b：`task11b-before-*.png` 与 `task11b-after-*.png` 的逐像素比对。
 *
 * 判据同 Task 11：按较小尺寸对齐后逐像素比 RGB，任一通道差 > 8 记一个差异像素
 * （阈值 8 避开 PNG 编码/抗锯齿的 ±1 噪声）。额外打印**差异行区间**
 * （firstDiffY / lastDiffY），用来把差异定位到具体版块——本批的预期是
 * 「差异只从卡片带那一段开始」。
 *
 * 已知的两个假差异源（Task 11 报告 §6.3，仍然成立）：
 *   1. `/listings/<slug>` 的高德地图 canvas 每次加载平移量不同；
 *   2. `getNearbyPois` 是进程内缓存 + 实时高德调用，冷启动可能少抓到一类 POI。
 * 所以房源详情页的判据看**页高是否相等** + 差异是否只落在地图矩形内。
 *
 * 用法：node task11b-imgdiff.mjs
 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'
import fs from 'node:fs'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037'
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.startsWith('task11b-before-') && f.endsWith('.png'))
  .sort()
for (const f of files) {
  const a = `${DIR}/${f}`
  const b = `${DIR}/${f.replace('task11b-before-', 'task11b-after-')}`
  const ma = await sharp(a).metadata()
  const mb = await sharp(b).metadata()
  const w = Math.min(ma.width, mb.width)
  const h = Math.min(ma.height, mb.height)
  const ra = await sharp(a).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const rb = await sharp(b).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const ch = ra.length / (w * h)
  let diff = 0
  let firstY = -1
  let lastY = -1
  for (let i = 0; i < ra.length; i += ch) {
    if (
      Math.abs(ra[i] - rb[i]) > 8 ||
      Math.abs(ra[i + 1] - rb[i + 1]) > 8 ||
      Math.abs(ra[i + 2] - rb[i + 2]) > 8
    ) {
      diff += 1
      const y = Math.floor(i / ch / w)
      if (firstY < 0) firstY = y
      lastY = y
    }
  }
  console.log(
    `${f.replace('task11b-before-', '').padEnd(30)} h:${ma.height}->${mb.height}  diffPx:${diff}  pct:${((100 * diff) / (w * h)).toFixed(3)}  diffY:${firstY}..${lastY}`,
  )
}
