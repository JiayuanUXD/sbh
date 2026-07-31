'use client'

import { useState } from 'react'

type DetailVideoProps = Readonly<{
  src: string
  alt: string
}>

/**
 * 延迟加载的详情页原生视频。仅在用户切到「视频」分类后才由 DetailGallery 挂载，
 * 使用 `preload="none"` 且不设置 `autoplay`，确保视频不进入首屏关键链路、不自动播放。
 * 视频 URL 只来自已脱敏的公开 Media DTO，由父组件 normalize 后传入。
 */
export default function DetailVideo({ src, alt }: DetailVideoProps) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <span className="detail-gallery__fallback" role="img" aria-label="媒体加载失败">媒体加载失败</span>
  }

  return (
    <video controls preload="none" aria-label={alt} onError={() => setFailed(true)}>
      <source src={src} />
      抱歉，你的浏览器不支持视频播放。
    </video>
  )
}
