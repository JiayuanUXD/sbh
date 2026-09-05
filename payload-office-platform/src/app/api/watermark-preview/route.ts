/**
 * OPT-069 后台水印预览端点。
 *
 * 拿一张固定样张按传入参数实时合成，供「站点设置 → 图片水印」的预览组件调用。
 * 只读、不落库、不碰媒体库——纯粹给运营看效果。
 *
 * 样张用 sharp 现造（明暗对比强的合成图），不依赖任何真实素材：水印最容易翻车的
 * 地方就是「在亮处白字消失、在暗处黑字消失」，样张必须同时含高亮区与近黑区。
 */

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { buildBadgeOverlay, buildTiledOverlay } from '@/domain/media/watermark'
import {
  buildPreviewWatermarkConfig,
  readWatermarkSiteSettings,
} from '@/domain/media/watermark-settings'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { respondWithRouteError } from '@/lib/runtime/admin-route-error'

export const dynamic = 'force-dynamic'

const SAMPLE_WIDTH = 900
const SAMPLE_HEIGHT = 600

/**
 * 预览样张。**必须用数组 join 拼，不能用 `+` 串模板字面量**——这不是风格洁癖，
 * 是一个真实事故的修复。
 *
 * ## 曾经发生过什么
 *
 * 本函数原先写成十来个模板字面量用 `+` 相连，宽高插的是模块级常量
 * `SAMPLE_WIDTH` / `SAMPLE_HEIGHT`。源码完全正确、`tsx` 直接跑也完全正确，
 * 但 `next build` 的常量折叠会把这条 `+` 链压成一个普通字符串字面量，
 * **压的过程中丢片段**：实测产物是
 *
 *     <svg xmlns="..." width="900" height="600<rect width="900" height="600<rect x="0" ...
 *
 * 每个「含插值的模板字面量」的尾部、连同其后不含插值的整段，全被吃掉了
 * （`">`、`<defs>…</defs>`、`" fill="url(#w)"/>`、三个玻璃幕墙 rect）。
 * 于是 `<svg>` 开始标签永远闭合不了，librsvg 报
 * `XML parse error … line 1 column 77 … Couldn't find end of Start Tag svg`，
 * 端点在生产恒 500。
 *
 * `watermark.ts` 里的三个 overlay 构造器同样是 `+` 串模板字面量却**没事**，
 * 因为它们的插值是运行时参数、打包器不折叠——差别只在「插值是不是编译期常量」。
 *
 * ## 为什么单测拦不住
 *
 * vitest / tsx 跑的是源码，源码本来就是对的。这个缺陷**只存在于打包产物里**，
 * 只有跑 `next build` + `next start` 才看得见。回归防线是
 * `tests/e2e/watermark-preview.spec.ts`（CI 的 e2e 走 `next start` 生产 server）
 * 加上下面那道运行时自检。
 */
function sampleSvg(): Buffer {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}">`,
    `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="#e2dccf"/><stop offset="100%" stop-color="#a89f8e"/></linearGradient>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#cfe4f5"/></linearGradient></defs>`,
    `<rect width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}" fill="url(#w)"/>`,
    `<rect x="40" y="40" width="240" height="320" fill="url(#g)"/>`,
    `<rect x="320" y="40" width="240" height="320" fill="url(#g)"/>`,
    `<rect x="600" y="40" width="260" height="320" fill="url(#g)"/>`,
    `<rect x="0" y="400" width="${SAMPLE_WIDTH}" height="200" fill="#3a332c"/>`,
    `<rect x="80" y="420" width="320" height="130" rx="10" fill="#1a1613"/>`,
    `<rect x="480" y="430" width="330" height="120" rx="10" fill="#241f1a"/></svg>`,
  ]
  const svg = parts.join('')

  // 运行时自检：不依赖「我搞懂了打包器为什么会丢片段」这个前提。
  // 只要开始标签里混进了 `<`（上次事故的确切形态）或收尾不对，就在这里带着
  // 可读信息炸掉，而不是把坏字节喂给 sharp 换一句 librsvg 的天书。
  const openTag = svg.slice(0, svg.indexOf('>') + 1)
  if (!openTag.startsWith('<svg ') || openTag.includes('<', 1) || !svg.endsWith('</svg>')) {
    throw new Error(
      `预览样张 SVG 在构建产物里被破坏（开始标签：${openTag.slice(0, 120)}）——` +
        '这是打包器折叠字符串导致的，见本函数头注释',
    )
  }
  return Buffer.from(svg)
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const mode = params.get('mode') === 'badge' ? 'badge' : 'tiled'

  // **鉴权段与渲染段分开 catch**，因为两段的调用方身份不同（见
  // `lib/runtime/admin-route-error.ts` 的 `exposeDetail`）：这一段跑在权限判定之前，
  // 抛错时调用方可能还是匿名的，`getPayload` / `payload.auth` 的异常里带着 DB 主机、
  // 端口、缺哪些环境变量——一个 try 包到底就会把这些送给未经授权的请求。
  // 401/403 是 return 而不是 throw，不受影响。
  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // 与「站点设置」同权限：能改配置的人才能看预览，与 watermark-rebake/route.ts 一致。
    // code review 第 1 轮 Important：本端点此前只查了登录态，注释却写着「与站点设置
    // 同权限」——注释承诺了代码没做到的事。收紧到与重刷端点相同的 site_settings:manage：
    // 本端点只服务那一个 tab，且每次调用都跑一次 sharp 合成，收紧顺带减少算力滥用面。
    const ctx = await getPermissionContext({ user, payload } as RequestContext)
    if (!ctx || !hasOperationPermission(ctx, 'site_settings:manage')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  } catch (error) {
    return respondWithRouteError('watermark-preview', error, {
      exposeDetail: false,
      context: { mode, phase: 'authorize' },
    })
  }

  // 到这里权限已确认，调用方持有 site_settings:manage，可以回真实原因了。
  try {
    // 关键：查询参数必须过 `buildPreviewWatermarkConfig`（内部就是烘焙那套
    // `mergeWatermarkConfig`），**不能自己拼 config**。烘焙路径走的是它的夹取与回落规则；
    // 预览若自己拼一套，两边对「超范围值 / 空文案 / 缺字段」的处理就会分叉——
    // 那样预览显示的是 A、实际烘出来的是 B，而这个 tab 存在的唯一意义就是所见即所得。
    //
    // `siteName` 必须从站点设置读出来当回落文案：字段说明写着「留空则回落为『站点名称』」，
    // 而这里此前传的是 `null`，于是运营清空文案后**预览渲染 `商办荟`（DEFAULT 常量）、
    // 烘焙渲染站点名称**——正是本注释声称已经消除的那种错位。
    //
    // 命名为 watermarkConfig 而非 config：本文件顶部已 import config from '@/payload.config'
    // 给 getPayload 用，同名局部变量会在整个函数体内 TDZ 遮蔽那个 import（用早于声明即报错），
    // 这不是风格选择，是避免一个真实的「块作用域变量用在声明之前」编译错误。
    const settings = await readWatermarkSiteSettings(payload)
    const watermarkConfig = buildPreviewWatermarkConfig(params, settings?.siteName)

    const base = await sharp(sampleSvg()).jpeg({ quality: 88 }).toBuffer()
    const overlay =
      mode === 'badge'
        ? buildBadgeOverlay({ width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, config: watermarkConfig.badge })
        : buildTiledOverlay({ width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, config: watermarkConfig.tiled })

    const composed = await sharp(base).composite([{ input: overlay, blend: 'over' }]).jpeg({ quality: 88 }).toBuffer()
    return new NextResponse(new Uint8Array(composed), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return respondWithRouteError('watermark-preview', error, {
      exposeDetail: true,
      context: { mode, phase: 'render' },
    })
  }
}
