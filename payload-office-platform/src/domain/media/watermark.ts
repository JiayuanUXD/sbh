/**
 * OPT-069 水印渲染：纯函数层。
 *
 * 只负责「给定画布尺寸与配置 → 产出一张 overlay SVG」，不碰 sharp、不碰存储。
 * 烘焙（composite / resize / 覆盖写）在 `src/plugins/watermark.ts`。
 *
 * ## 三个不可改的实现决定
 *
 * 1. **不用 sharp 的 `composite({ tile: true })`**：改为生成整幅尺寸的 overlay，
 *    若干 <text> 统一 rotate。平铺模式要自己保证图案在接缝处对齐，而整幅 overlay
 *    没有接缝；几十个 text 元素的渲染成本可忽略。
 * 2. **字号由图宽推导**而非固定像素：母版可能是 1200 也可能是 6000，固定字号会让
 *    观感完全不同。按 `图宽 / 列数 / 文字宽度系数` 推导，任何尺寸下都是同样的版式。
 * 3. **描边不能省**（`paint-order="stroke"`）：设计阶段实测，纯白半透明字在落地窗
 *    那类高亮区会完全消失，纯黑字在近黑家具上同理。白字 + 黑描边两端都读得出来。
 */

import { createHash } from 'crypto'

/**
 * 渲染逻辑版本。**任何会改变渲染结果的改动都必须 +1**，不只是几何算法：字号推导、
 * 间距系数、描边、元素结构、乃至换一个默认字体栈——凡是同一份配置烘出来的像素会变的，
 * 都算。否则存量图的 `watermark.version` 与新逻辑烘出来的完全一致，重刷任务把它们判成
 * 「已是当前版本」跳过，新旧两种效果永久共存，且没有任何报错。
 *
 * `1` → `2`：6a6fbd5 在版本 `1` 下改了字体栈（`WATERMARK_FONT_FAMILY`），
 * 那次没有跟着 +1，这里补上。字体栈现在也进哈希（见 `computeWatermarkVersion`），
 * 以后换字体会自动改变版本，不再依赖人记得改这个常量。
 */
export const WATERMARK_RENDERER_VERSION = '2'

/**
 * 字体栈。生产是 Linux 容器，`Microsoft YaHei` 只在本地存在——
 * 容器缺中文字体时 librsvg 渲染成方框且**不报错**，见 spec §7.3。
 * 该风险由 Dockerfile 装 `WATERMARK_FONT_PACKAGE` 承担，不在本文件解决；
 * `WenQuanYi Zen Hei` 是那个 Debian 包注册的字体族名（非本文件猜测——
 * 见 Dockerfile 同一 RUN 行的注释），后面几项是本地 Windows/macOS 开发时的兜底，
 * 容器里并不存在。
 *
 * **别以为「不点名栈首就会渲染成方框」**——实测（容器等价的 fontconfig 环境）推翻了它：
 * 只改这串 family、其余入参全同，两次渲染逐字节相同。fontconfig 做的是最佳匹配，
 * 系统里只要有覆盖该码点的字体就会被选中，是否在 family 列表里点名无关。
 * 当前镜像只装一个 CJK 字体，fontconfig 无从选择，所以**栈的顺序不是失效点**；
 * 一旦镜像里多了第二个 CJK 字体，栈首才会重新成为决定因素（候选间要排序，点名的会赢）。
 * 真正必须锁住的两条是「Dockerfile 装了 CJK 字体包」与「该包与常量一致」，
 * 见 `tests/media-watermark-font-guard.test.ts`。
 *
 * 本常量仍进 `computeWatermarkVersion` 的哈希：多字体场景下它确实影响像素，
 * 而哈希多包一个不变的字符串没有任何代价。
 */
export const WATERMARK_FONT_FAMILY =
  'WenQuanYi Zen Hei, Noto Sans CJK SC, Microsoft YaHei, SimHei, sans-serif'

/**
 * 生产容器实际安装的 CJK 字体包（Dockerfile 的 `apt-get install` 那一行）。
 *
 * **真正决定水印像素的是它，不是上面那串 family 名**（见上：只改 family 字符串，
 * 渲染结果逐字节不变）。所以它必须进版本哈希：把 Dockerfile 从 `fonts-wqy-zenhei`
 * 换成 `fonts-noto-cjk`（两者字形差异很大）会让所有图的像素改变，而
 * `computeWatermarkVersion` 的输入若一个字节没动 → 哈希不变 → 之后每一轮重刷都判
 * 「已是当前版本」跳过 → 新旧两种字形永久共存，且没有任何报错。这正是本功能刻意
 * 不用人工版本号要摆脱的那种依赖。
 *
 * 与 Dockerfile 的一致性由 `tests/media-watermark-font-guard.test.ts` 钉住：
 * 那边一改、这边不改，测试就红；改了这边，哈希自动变，存量图下一轮重刷自动重烘。
 */
export const WATERMARK_FONT_PACKAGE = 'fonts-wqy-zenhei'

export type TiledWatermarkConfig = {
  text: string
  /** 横向列数，2–6。越大越密。 */
  density: number
  /** 0–1 */
  opacity: number
  /** 度，负值逆时针 */
  angle: number
}

export type BadgeWatermarkConfig = {
  text: string
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  opacity: number
}

export type WatermarkConfig = {
  enabled: boolean
  tiled: TiledWatermarkConfig
  badge: BadgeWatermarkConfig
}

/**
 * 缺省配置。OPT-053 立的三层兜底里的最后一层——`SiteSettings` 的水印 tab
 * 尚未写入、或迁移还没跑时，用这一份。
 *
 * OPT-069：`enabled` 缺省 `false`，整个水印功能 opt-in。本仓库合并即全量上线，
 * `media.usage` 的迁移会把约 1.7 万条存量媒体（含 logo、文章封面、landing hero）
 * 按默认值全部回填成 `listing-photo`，而重新分类的脚本只能在合并**之后**跑。
 * 缺省开启意味着这段窗口里运营新传的品牌素材会被水印烘进像素——水印永久改写图片，
 * 理应由运营在回填跑完、看过预览之后主动打开。
 */
export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: false,
  tiled: { text: '商办荟', density: 3, opacity: 0.38, angle: -30 },
  badge: { text: '商办荟', position: 'bottom-right', opacity: 0.95 },
}

/** 相邻两条文字之间留的横向余量倍数。1 = 紧贴，1.55 = 留半个身位。 */
const TILE_GAP_RATIO = 1.55
/** 行距相对字号的倍数。 */
const TILE_LINE_RATIO = 4.2
/** 角标字号占图宽的比例。 */
const BADGE_FONT_RATIO = 0.03

const CJK = /[㐀-䶿一-鿿豈-﫿]/

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 文字宽度估算。librsvg 不回传实际排版宽度，而我们需要它来决定平铺间距与
 * 角标底板宽度，故按字符类别估算：CJK 全角 1em、空格 0.3em、其余 0.62em
 * （粗体拉丁大写的经验值）。估偏一点只影响留白，不影响正确性。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0
  for (const char of text) {
    if (CJK.test(char)) units += 1
    else if (char === ' ') units += 0.3
    else units += 0.62
  }
  return units * fontSize
}

/** 保留最多 4 位小数，避免浮点尾巴污染 SVG 与快照。 */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** 创建空的 overlay SVG 外壳（仅宽高，无内容）。尺寸必须净化，防止 NaN/Infinity 污染。 */
function emptyOverlay(width: number, height: number): Buffer {
  // 非有限值或非正数一律转换为 1，确保 SVG 属性合法
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}"></svg>`)
}

export function buildTiledOverlay({
  width,
  height,
  config,
}: {
  width: number
  height: number
  config: TiledWatermarkConfig
}): Buffer {
  // 输入守卫：文案为空、尺寸无效或密度无效时返回空 overlay
  const trimmedText = config.text.trim()
  if (
    !trimmedText ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(config.density) ||
    config.density <= 0
  ) {
    return emptyOverlay(width, height)
  }

  const text = escapeXml(config.text)
  const unitWidth = estimateTextWidth(config.text, 1)
  // 图宽切成 density 列，每列容纳一条文字 + 余量
  const fontSize = Math.max(8, Math.round(width / config.density / (unitWidth * TILE_GAP_RATIO)))
  const stepX = Math.max(1, Math.round(estimateTextWidth(config.text, fontSize) * TILE_GAP_RATIO))
  const stepY = Math.max(1, Math.round(fontSize * TILE_LINE_RATIO))
  const strokeWidth = Math.max(1, round(fontSize * 0.04))
  const fillOpacity = round(config.opacity)
  const strokeOpacity = round(config.opacity * 0.5)

  const cells: string[] = []
  let row = 0
  // 网格铺到画布的 3 倍范围：旋转后四角仍在覆盖内
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      // 奇数行横向错开半格，避免形成整齐的竖直通道
      const offsetX = (row % 2) * (stepX / 2)
      cells.push(
        `<text x="${round(x + offsetX)}" y="${round(y)}" font-size="${fontSize}"` +
          ` font-family="${WATERMARK_FONT_FAMILY}" font-weight="700"` +
          ` fill="#fff" fill-opacity="${fillOpacity}"` +
          ` stroke="#000" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"` +
          ` paint-order="stroke">${text}</text>`,
      )
    }
    row++
  }

  const rotation = `rotate(${config.angle} ${round(width / 2)} ${round(height / 2)})`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<g transform="${rotation}">${cells.join('')}</g></svg>`,
  )
}

export function buildBadgeOverlay({
  width,
  height,
  config,
}: {
  width: number
  height: number
  config: BadgeWatermarkConfig
}): Buffer {
  // 输入守卫：文案为空或尺寸无效时返回空 overlay
  const trimmedText = config.text.trim()
  if (
    !trimmedText ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return emptyOverlay(width, height)
  }

  const text = escapeXml(config.text)
  const fontSize = Math.max(8, Math.round(width * BADGE_FONT_RATIO))
  const padX = Math.round(fontSize * 0.85)
  const padY = Math.round(fontSize * 0.55)
  const boxWidth = Math.round(estimateTextWidth(config.text, fontSize)) + padX * 2
  const boxHeight = fontSize + padY * 2
  const margin = Math.round(width * 0.025)

  const alignRight = config.position === 'bottom-right' || config.position === 'top-right'
  const alignBottom = config.position === 'bottom-right' || config.position === 'bottom-left'
  const x = alignRight ? width - boxWidth - margin : margin
  const y = alignBottom ? height - boxHeight - margin : margin

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"` +
      ` rx="${Math.round(boxHeight * 0.28)}" fill="#000" fill-opacity="0.45"/>` +
      `<text x="${x + padX}" y="${round(y + padY + fontSize * 0.82)}" font-size="${fontSize}"` +
      ` font-family="${WATERMARK_FONT_FAMILY}" font-weight="700"` +
      ` fill="#fff" fill-opacity="${round(config.opacity)}">${text}</text></svg>`,
  )
}

/**
 * sharp 能**原地改写**的图片格式白名单。
 *
 * 刻意不用 `mimeType.startsWith('image/')`：
 *
 * - **gif / 动态 webp**：`composite()` 不带 `{ animated: true }` 只读第一帧，
 *   烘下去会把动图静默改写成静止图。webp 静态与动态共用 `image/webp`，MIME 层
 *   分不开，那一层由烘焙函数按 `metadata().pages` 兜底；gif 恒为多帧容器，直接拒。
 * - **svg**：sharp 写不出 SVG，吐的是 PNG 字节——母版会被静默改成另一种格式，
 *   而 `media.filename` 仍是 `.svg`。
 *
 * 且此判据必须与「谁能拿到 `watermark.version`」严格一致：这里拒掉的图永远写不上
 * version，重刷任务若认得比这里宽，会每轮重新选中它、每轮再失败一次，永远如此。
 * 所以 `bakeAfterUpload` / `selectRebakeTargets` / 回刷脚本三处共用本函数，不各写一份。
 */
const BAKEABLE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function isBakeableImage(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== 'string') return false
  // mimeType 由上传方给出，不保证规范化：切掉 `; charset=` 之类参数再比。
  const essence = mimeType.split(';')[0].trim().toLowerCase()
  return BAKEABLE_MIME_TYPES.has(essence)
}

/**
 * 配置的内容哈希，写进 `media.watermark.version`。
 *
 * 刻意**不用人工维护的版本号**：人会忘记改，届时重刷任务会静默跳过该跑的图，
 * 而这种错误没有任何报错、只表现为「点了重刷但有些图没变」。
 *
 * **字体也进哈希**，两项都进：
 *
 *   - `WATERMARK_FONT_PACKAGE`（容器实际装的字体包）——**真正决定像素的是它**。换包
 *     等于换字形，若哈希不动，之后每一轮重刷都判「已是当前版本」跳过，新旧字形永久共存；
 *   - `WATERMARK_FONT_FAMILY`（SVG 里那串 family 名）——单字体环境下它不影响渲染结果
 *     （实测逐字节相同，fontconfig 走最佳匹配），但镜像里一旦有第二个 CJK 字体它就会
 *     决定选谁。多包一个字符串没有代价。
 *
 * 不哈希字体的后果不是理论问题：缺中文字体的环境里打开开关，图会被烘成方框
 * （librsvg 不报错）却照样盖上一个 version；事后把字体装好，每一轮重刷都把它们判成
 * skip，方框永久留在生产图片里，只能靠改代码解。
 *
 * 第二个参数只是**测试注入点**（与 `createWriter` 同一手法：没有它就写不出
 * 「换字体 → 版本变」这两条断言）。生产不传，走当前两个常量。
 */
export function computeWatermarkVersion(
  config: WatermarkConfig,
  fonts: { fontFamily?: string; fontPackage?: string } = {},
): string {
  const payload = JSON.stringify({
    renderer: WATERMARK_RENDERER_VERSION,
    font: fonts.fontFamily ?? WATERMARK_FONT_FAMILY,
    fontPackage: fonts.fontPackage ?? WATERMARK_FONT_PACKAGE,
    tiled: config.tiled,
    badge: config.badge,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/**
 * 合并储存配置与缺省值，避免 null 覆盖。
 *
 * 后续任务（应用于房源/楼盘上传）都需要这个入口，确保「首次部署配置为空」
 * 与「运营已设置」两种情况下文案回落行为一致。
 *
 * @param stored — 从 `SiteSettings.watermark` 读出的配置，可能有 null / undefined 字段
 * @param fallbackText — 缺省文案（通常是站点名称），为空时用 DEFAULT_WATERMARK_CONFIG 的文案
 */
export function mergeWatermarkConfig(stored: unknown, fallbackText?: string | null): WatermarkConfig {
  const storedObj = stored != null && typeof stored === 'object' ? (stored as Record<string, any>) : {}

  // 处理文案回落逻辑：支持指定每组各自的默认文案
  const resolveFallbackText = (text: unknown, defaultText: string): string => {
    const trimmedText = typeof text === 'string' ? text.trim() : ''
    if (trimmedText) return trimmedText
    const trimmedFallback = typeof fallbackText === 'string' ? fallbackText.trim() : ''
    return trimmedFallback || defaultText
  }

  // 辅助函数：带范围夹取的数字合并
  const mergeNumber = (
    value: unknown,
    defaultValue: number,
    min?: number,
    max?: number,
  ): number => {
    if (!Number.isFinite(value)) return defaultValue
    let result = value as number
    if (min !== undefined) result = Math.max(result, min)
    if (max !== undefined) result = Math.min(result, max)
    return result
  }

  // 合并 tiled 配置
  const tiledStored = storedObj.tiled
  const tiledConfig: TiledWatermarkConfig = {
    text: resolveFallbackText(tiledStored?.text, DEFAULT_WATERMARK_CONFIG.tiled.text),
    density: mergeNumber(tiledStored?.density, DEFAULT_WATERMARK_CONFIG.tiled.density, 2, 6),
    opacity: mergeNumber(tiledStored?.opacity, DEFAULT_WATERMARK_CONFIG.tiled.opacity, 0.01, 1),
    angle: mergeNumber(tiledStored?.angle, DEFAULT_WATERMARK_CONFIG.tiled.angle, -90, 90),
  }

  // 合并 badge 配置
  const badgeStored = storedObj.badge
  const badgeConfig: BadgeWatermarkConfig = {
    text: resolveFallbackText(badgeStored?.text, DEFAULT_WATERMARK_CONFIG.badge.text),
    position: ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(badgeStored?.position)
      ? badgeStored.position
      : DEFAULT_WATERMARK_CONFIG.badge.position,
    opacity: mergeNumber(badgeStored?.opacity, DEFAULT_WATERMARK_CONFIG.badge.opacity, 0.01, 1),
  }

  return {
    // 只认布尔值，其余（null / undefined / 非布尔）一律回落常量。
    // 不能写 `storedObj.enabled !== false`：站点设置的水印 group 从没保存过时
    // `enabled` 是 null，`null !== false` 得到 true，缺省关闭的开关会被绕过，
    // 水印在首次部署时就是开着的。
    enabled: typeof storedObj.enabled === 'boolean' ? storedObj.enabled : DEFAULT_WATERMARK_CONFIG.enabled,
    tiled: tiledConfig,
    badge: badgeConfig,
  }
}
