/**
 * 从 src/app/icon.svg 生成 favicon.ico 与 apple-icon.png。
 *
 * 为什么需要这个脚本：Next 的 icon 文件约定只做「有什么文件就注入什么 link」，
 * 不做格式转换。三份资产必须手工保持同源，否则改了 SVG、.ico 还是旧图。
 *
 * 用法：pnpm icons:build
 *
 * 两个不显然的点：
 * 1. 小尺寸先在 1024 光栅化再 Lanczos 下采样，比让 librsvg 直接按 16px 画清楚得多
 *    （直接画会丢掉楼层横缝的灰阶，塔楼边缘发毛）。
 * 2. apple-icon 去掉圆角：iOS 会自己套遮罩，留透明圆角会在桌面图标上露黑边。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app')
const svg = readFileSync(join(appDir, 'icon.svg'))

const ICO_SIZES = [16, 32, 48]
const APPLE_SIZE = 180
const SUPERSAMPLE = 1024

/** PNG-in-ICO 容器：ICONDIR(6) + n×ICONDIRENTRY(16) + 各 PNG 负载。 */
function packIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + entries.length * 16
  const dir = entries.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // 0 表示 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2) // 调色板色数
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)])
}

const master = await sharp(svg, { density: 600 })
  .resize(SUPERSAMPLE, SUPERSAMPLE)
  .png()
  .toBuffer()

const icoEntries = []
for (const size of ICO_SIZES) {
  icoEntries.push({
    size,
    png: await sharp(master).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer(),
  })
}
writeFileSync(join(appDir, 'favicon.ico'), packIco(icoEntries))

// iOS 主屏图标：方角 + 不透明，圆角交给系统遮罩。
// 只认底板那一条 rect 的 rx（`width="512" height="512" rx=`），不做「第一个 rx」这种
// 位置假设——将来 SVG 里多一个圆角矩形就会悄悄改错对象。改不到就直接炸，别出错图。
const squareSvgText = svg.toString('utf8').replace(/(width="512" height="512" rx=")[\d.]+"/, '$10"')
if (squareSvgText === svg.toString('utf8')) {
  throw new Error('没在 icon.svg 里找到底板 rect 的 rx，apple-icon 去圆角失败；检查底板那行的写法')
}
const squareSvg = Buffer.from(squareSvgText, 'utf8')
// sharp 一条 pipeline 只认最后一次 resize，所以超采样必须断成两段 buffer。
const appleMaster = await sharp(squareSvg, { density: 600 }).resize(SUPERSAMPLE, SUPERSAMPLE).png().toBuffer()
const apple = await sharp(appleMaster)
  .resize(APPLE_SIZE, APPLE_SIZE, { kernel: 'lanczos3' })
  .flatten({ background: '#0071e3' })
  .png({ compressionLevel: 9 })
  .toBuffer()
writeFileSync(join(appDir, 'apple-icon.png'), apple)

console.log(`favicon.ico (${ICO_SIZES.join('/')}) + apple-icon.png (${APPLE_SIZE}) 已生成`)
