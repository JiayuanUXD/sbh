/**
 * 四断点截图逐像素比对（改前 before2/ vs 改后 after2/）。
 *
 * 判据：同名两张图按较小尺寸对齐后逐像素比 RGB，任一通道差 > 8 记一个差异像素
 * （阈值 8 用来吃掉 PNG 编码/抗锯齿的 ±1 噪声）。同时打印两图尺寸——**高度不等
 * 本身就说明布局变了**，不能只看差异像素数。
 *
 * 已知会真差异的一类：楼盘/房源详情页的「周边与交通」清单来自高德 Web 服务实时
 * 调用（`domain/location-services/cache.ts`，失败不写缓存），两次采样可能拿到不同
 * 的 POI 条数 → 页面高度变化。这类页面要结合 html-diff.sh 的结果一起读。
 *
 * 用法：node imgdiff.mjs [beforeDir] [afterDir]
 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'
import fs from 'node:fs'

const ROOT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const A = process.argv[2] ?? 'before2'
const B = process.argv[3] ?? 'after2'
const files = fs.readdirSync(`${ROOT}/${A}`).filter((f) => f.endsWith('.png')).sort()
let worst = 0
const rows = []
for (const f of files) {
  const pa = `${ROOT}/${A}/${f}`
  const pb = `${ROOT}/${B}/${f}`
  if (!fs.existsSync(pb)) { rows.push(`${f}: MISSING in ${B}`); continue }
  const ma = await sharp(pa).metadata()
  const mb = await sharp(pb).metadata()
  const w = Math.min(ma.width, mb.width)
  const h = Math.min(ma.height, mb.height)
  const ra = await sharp(pa).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const rb = await sharp(pb).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const ch = ra.length / (w * h)
  let diff = 0
  let firstY = -1
  for (let i = 0; i < ra.length; i += ch) {
    if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) {
      diff += 1
      if (firstY < 0) firstY = Math.floor((i / ch) / w)
    }
  }
  const sizeNote = (ma.width === mb.width && ma.height === mb.height)
    ? `${ma.width}x${ma.height}`
    : `SIZE ${ma.width}x${ma.height} -> ${mb.width}x${mb.height}`
  const pct = ((diff / (w * h)) * 100).toFixed(4)
  if (diff > worst) worst = diff
  rows.push(`${diff === 0 && ma.height === mb.height ? 'OK   ' : 'DIFF '} ${f.padEnd(30)} ${sizeNote.padEnd(28)} diffPx=${diff} (${pct}%) firstY=${firstY}`)
}
console.log(rows.join('\n'))
console.log('\nworst diffPx =', worst)
