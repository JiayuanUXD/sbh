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

export const dynamic = 'force-dynamic'

const SAMPLE_WIDTH = 900
const SAMPLE_HEIGHT = 600

function sampleSvg(): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}">` +
      `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#e2dccf"/><stop offset="100%" stop-color="#a89f8e"/></linearGradient>` +
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#cfe4f5"/></linearGradient></defs>` +
      `<rect width="${SAMPLE_WIDTH}" height="${SAMPLE_HEIGHT}" fill="url(#w)"/>` +
      `<rect x="40" y="40" width="240" height="320" fill="url(#g)"/>` +
      `<rect x="320" y="40" width="240" height="320" fill="url(#g)"/>` +
      `<rect x="600" y="40" width="260" height="320" fill="url(#g)"/>` +
      `<rect x="0" y="400" width="${SAMPLE_WIDTH}" height="200" fill="#3a332c"/>` +
      `<rect x="80" y="420" width="320" height="130" rx="10" fill="#1a1613"/>` +
      `<rect x="480" y="430" width="330" height="120" rx="10" fill="#241f1a"/></svg>`,
  )
}

export async function GET(request: Request): Promise<Response> {
  const payload = await getPayload({ config })
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

  const params = new URL(request.url).searchParams
  const mode = params.get('mode') === 'badge' ? 'badge' : 'tiled'

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
}
