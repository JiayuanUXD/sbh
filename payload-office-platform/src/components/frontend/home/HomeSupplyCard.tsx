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
export default function HomeSupplyCard({ href, image, photoTags, title, whereLine, metaLine, price, ratio = '4/3' }: Readonly<{
  href: string
  image: MediaViewModel | null
  photoTags: readonly Readonly<{ text: string; numeric?: boolean }>[]
  title: string
  whereLine: string | null
  metaLine: string | null
  price: Readonly<{ value: string; unit: string }> | null
  /**
   * 图片比例。房源卡 4:3、楼盘卡 16:10 —— 这条是全站规则（.agent/frontend.md
   * 「房源卡 4:3、楼盘卡 16:10（封面多为横向街景）」），不是本组件的偏好。
   * 本组件被三条 rail 共用，其中「热门楼盘」放的是楼盘，必须传 '16/10'；
   * 写死 4:3 会让同一批楼盘在首页与列表页/详情页呈现两种裁切，横向街景被
   * 裁掉楼体两侧。默认值给 4:3 是因为三条 rail 里两条是房源。
   */
  ratio?: '4/3' | '16/10'
}>) {
  return (
    <Link href={href} prefetch={false} className="sf-card hm-supply-card">
      <span className={`sf-media ${ratio === '16/10' ? 'sf-media--16x10' : 'sf-media--4x3'}`}>
        {image ? (
          <img
            {...cardCoverProps(image, '(max-width: 767px) 78vw, 360px')}
            alt={image.alt ?? title}
            loading="lazy"
            decoding="async"
            width={image.width ?? 400}
            height={image.height ?? 300}
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
