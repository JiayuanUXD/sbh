/**
 * 最小 PNG 解码器：只够读 Playwright 截出来的 8-bit、非隔行、RGB / RGBA PNG。
 *
 * 为什么自己写：像素取样要在 Node 里完成，仓库 node_modules 没有 pngjs；
 * 上一版取证用的是本机 Python + PIL，Codex 审查（PR #202）指出别的机器复现不了。
 * 只实现取证需要的子集：PLTE / 16-bit / 隔行 一律抛错，不静默降级。
 */
import { inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported color type ${colorType}`)
      if (interlace !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = src[i]
      switch (filter) {
        case 0: break
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: v += paeth(a, b, c); break
        default: throw new Error(`bad filter ${filter} at row ${y}`)
      }
      row[i] = v & 0xff
    }
  }
  return {
    width,
    height,
    channels,
    /** 返回 [r, g, b]。 */
    rgb(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) throw new RangeError(`(${x},${y}) outside ${width}x${height}`)
      const i = y * stride + x * channels
      return [out[i], out[i + 1], out[i + 2]]
    },
  }
}

/** 矩形区域（含边界）按 step 抽样后的 RGB 均值，四舍五入到整数。 */
export function meanRgb(png, { x0, y0, x1, y1, step = 2 }) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const [pr, pg, pb] = png.rgb(x, y)
      r += pr
      g += pg
      b += pb
      n += 1
    }
  }
  if (n === 0) throw new Error('empty sample region')
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}
