/**
 * OPT-037 Task 11b：从全页截图里裁一段出来，供人工/模型逐张目视核对。
 * 用法：node task11b-crop.mjs <png 文件名> <top> <height> [outName]
 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037'
const [file, top, height, outName] = process.argv.slice(2)
const src = `${DIR}/${file}`
const m = await sharp(src).metadata()
const t = Math.max(0, Number(top))
const h = Math.min(Number(height), m.height - t)
const out = `${DIR}/${outName ?? `crop-${file.replace('.png', '')}-${t}-${h}.png`}`
await sharp(src).extract({ left: 0, top: t, width: m.width, height: h }).toFile(out)
console.log(out, `(source ${m.width}x${m.height})`)
