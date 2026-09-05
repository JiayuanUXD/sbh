'use client'

/**
 * OPT-069：「站点设置 → 图片水印」的只读预览。
 *
 * 读表单里的当前值（`useFormFields`），拼成预览端点的查询串，展示两张样张。
 * 纯展示，不写任何数据——运营调参数时能立刻看到效果，而不是盲调。
 */

import React from 'react'
import { useFormFields } from '@payloadcms/ui'

function useValue(path: string): unknown {
  return useFormFields(([fields]) => fields?.[path]?.value)
}

/** 收紧预览端点权限后（code review 第 1 轮 Important），无权限/会话过期会拿到 403——
 * 不加处理浏览器只会显示一个破图图标，运营看不出发生了什么。加载失败就换成一句
 * 中文提示，不做更细的错误分类（404 与 403 都按「预览不可用」处理即可）。 */
function ImageOrFallback({
  src,
  alt,
}: {
  src: string
  alt: string
}): React.JSX.Element {
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return (
      <p style={{ width: 420, maxWidth: '100%', fontSize: 13, opacity: 0.7 }}>
        预览需要「站点设置」管理权限
      </p>
    )
  }
  return <img src={src} alt={alt} style={{ width: 420, maxWidth: '100%' }} onError={() => setFailed(true)} />
}

export default function WatermarkPreview(): React.JSX.Element {
  const tiledText = useValue('watermark.tiled.text')
  const tiledDensity = useValue('watermark.tiled.density')
  const tiledOpacity = useValue('watermark.tiled.opacity')
  const tiledAngle = useValue('watermark.tiled.angle')
  const badgeText = useValue('watermark.badge.text')
  const badgePosition = useValue('watermark.badge.position')
  const badgeOpacity = useValue('watermark.badge.opacity')

  const tiledUrl = `/api/watermark-preview?${new URLSearchParams({
    mode: 'tiled',
    text: String(tiledText ?? ''),
    density: String(tiledDensity ?? ''),
    opacity: String(tiledOpacity ?? ''),
    angle: String(tiledAngle ?? ''),
  })}`

  const badgeUrl = `/api/watermark-preview?${new URLSearchParams({
    mode: 'badge',
    text: String(badgeText ?? ''),
    position: String(badgePosition ?? ''),
    opacity: String(badgeOpacity ?? ''),
  })}`

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={{ marginBottom: 4 }}>效果预览</h4>
      <p style={{ marginTop: 0, opacity: 0.7, fontSize: 13 }}>
        样张含高亮玻璃幕墙与近黑家具——水印在这两端都要读得出来。改完参数保存后刷新本页更新预览。
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <figure style={{ margin: 0 }}>
          <ImageOrFallback src={tiledUrl} alt="详情大图满铺水印预览" />
          <figcaption style={{ fontSize: 12, opacity: 0.7 }}>详情大图（满铺）</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          <ImageOrFallback src={badgeUrl} alt="卡片角标水印预览" />
          <figcaption style={{ fontSize: 12, opacity: 0.7 }}>卡片缩略图（角标）</figcaption>
        </figure>
      </div>
    </div>
  )
}
