import Link from 'next/link'
import React from 'react'
import type { MediaViewModel } from '@/domain/public-catalog/contracts'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'
import { cardCoverProps } from '@/lib/frontend/media-srcset'

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
    <Link href={href} prefetch={false} className="sf-card hm-supply-card">
      {/* 比例不再是 prop（OPT-082）：全站统一 16:10 之后这个 prop 只剩一个取值，
          留着就是一个「可以传错」的开关——三条 rail 里任何一条传成 4/3，就又回到
          「同一批房源在首页与列表页两种裁切」那个刚修掉的毛病。 */}
      <span className="sf-media sf-media--16x10">
        {image ? (
          <img
            {...cardCoverProps(image, '(max-width: 767px) 78vw, 360px')}
            alt={image.alt ?? title}
            loading="lazy"
            decoding="async"
            width={image.width ?? 400}
            // 兜底值跟着比例走：原先 300 是 4:3 的配对值，统一到 16:10 后应为 250。
            // 容器有 aspect-ratio，不会真的 CLS，但留着一个对不上的比例迟早误导人。
            height={image.height ?? 250}
          />
        ) : (
          <CardMediaPlaceholder />
        )}
        <span className="sf-scrim" aria-hidden="true" />
        {photoTags.length > 0 ? (
          <span className="hm-supply-card__tags">
            {photoTags.slice(0, 2).map((tag) => (
              <span key={tag.text} className={tag.numeric ? 'sf-phototag sf-phototag--num' : 'sf-phototag'}>{tag.text}</span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="hm-supply-card__body">
        <span className="hm-supply-card__title">{title}</span>
        {whereLine ? <span className="hm-supply-card__where">{whereLine}</span> : null}
        {metaLine ? <span className="hm-supply-card__meta sf-num">{metaLine}</span> : null}
        {price ? (
          <span className="hm-supply-card__price">
            <span className="hm-supply-card__price-value sf-num">{price.value}</span>
            <span className="hm-supply-card__price-unit">{price.unit}</span>
          </span>
        ) : null}
      </span>
    </Link>
  )
}
