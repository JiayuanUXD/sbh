import Link from 'next/link'
import React from 'react'
import type { MediaViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页供给卡（400×[300+信息]）：楼盘 / 房源 / 核心商圈三条横滑共用。
 *
 * 只消费已格式化好的展示字段（不接收 Payload 文档、不做格式化计算），
 * 由各 Rail 组件按各自的 ViewModel 组装成这套 props。
 */
export default function HomeSupplyCard({ href, image, photoTags, title, whereLine, metaLine, price }: Readonly<{
  href: string
  image: MediaViewModel | null
  photoTags: readonly Readonly<{ text: string; numeric?: boolean }>[]
  title: string
  whereLine: string | null
  metaLine: string | null
  price: Readonly<{ value: string; unit: string }> | null
}>) {
  return (
    <Link href={href} prefetch={false} className="hm-card hm-supply-card">
      <span className="hm-supply-card__media">
        {image ? (
          <img src={image.src} alt={image.alt ?? title} loading="lazy" decoding="async"
            width={image.width ?? 400} height={image.height ?? 300} />
        ) : null}
        <span className="hm-scrim" aria-hidden="true" />
        {photoTags.length > 0 ? (
          <span className="hm-supply-card__tags">
            {photoTags.slice(0, 2).map((tag) => (
              <span key={tag.text} className={tag.numeric ? 'hm-phototag hm-phototag--num' : 'hm-phototag'}>{tag.text}</span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="hm-supply-card__body">
        <span className="hm-supply-card__title">{title}</span>
        {whereLine ? <span className="hm-supply-card__where">{whereLine}</span> : null}
        {metaLine ? <span className="hm-supply-card__meta hm-num">{metaLine}</span> : null}
        {price ? (
          <span className="hm-supply-card__price">
            <span className="hm-supply-card__price-value hm-num">{price.value}</span>
            <span className="hm-supply-card__price-unit">{price.unit}</span>
          </span>
        ) : null}
      </span>
    </Link>
  )
}
