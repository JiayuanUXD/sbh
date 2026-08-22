/**
 * OPT-037 Task 11b：把「卡片带以下的差异」归因清楚。
 *
 * 全页逐像素比对（task11b-imgdiff.mjs）在楼盘页给出 8–34% 的差异率，但那个数字
 * 是**误导性的**：摘掉两张卡后整条带矮了一截，带以下的所有内容整体上移，
 * 于是同一 y 坐标上比的是不同的东西。真正要回答的是「带以下的内容有没有变」。
 *
 * 做法：把两张图**按底部对齐**再比最后 N 行——若带以下只是整体平移，
 * 底部对齐后应当基本归零。
 *
 * 实测结论（见 task11b-residual.txt）：底部对齐后残差降到 0.3–3%，且分布成
 * 一条条只有几像素高的细横条，每条正好压在**一行文字**或**一条 1px 分隔线**上。
 * 原因是带高差不是整像素（截图按整数行栅格化），带以下的内容整体落在不同的
 * 亚像素相位：字形边缘的抗锯齿灰度差几个色阶，而 `border-top` 那种 1px 细线
 * 会整行错开一格——所以「单行最大差异像素」会顶到整幅宽（1440/1440），
 * 这是细线错行的指纹，不是内容变化。已裁图逐处目视核对（task11b-crop-*）：
 * 文字内容、排布、行数、分隔线数量完全一致。
 *
 * 用法：node task11b-residual.mjs
 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037'
const CASES = [
  ['building-nomedia', 1440], ['building-nomedia', 1920],
  ['building-nomedia', 768], ['building-nomedia', 375],
  ['building-withmedia', 1440], ['building-withmedia', 1920],
  ['building-withmedia', 768], ['building-withmedia', 375],
]

for (const [name, w] of CASES) {
  const A = `${DIR}/task11b-before-${name}-${w}.png`
  const B = `${DIR}/task11b-after-${name}-${w}.png`
  const ma = await sharp(A).metadata()
  const mb = await sharp(B).metadata()
  const h = Math.min(2000, mb.height - 2700)
  const ra = await sharp(A).extract({ left: 0, top: ma.height - h, width: w, height: h }).raw().toBuffer()
  const rb = await sharp(B).extract({ left: 0, top: mb.height - h, width: w, height: h }).raw().toBuffer()
  const ch = ra.length / (w * h)
  let d = 0
  let maxRow = 0
  for (let y = 0; y < h; y++) {
    let c = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) c++
    }
    d += c
    if (c > maxRow) maxRow = c
  }
  console.log(
    `${name}-${w}`.padEnd(26) +
      `页高 ${ma.height}->${mb.height} (Δ${mb.height - ma.height})  底部对齐末 ${h} 行残差 ${d} (${((100 * d) / (w * h)).toFixed(3)}%)  单行最大差异像素 ${maxRow}/${w}`,
  )
}
