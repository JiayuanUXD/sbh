import Link from 'next/link'
import React from 'react'
import { formatArea } from '@/lib/frontend/format'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import { Media, Tag } from '@/components/frontend/ui'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'

/**
 * 楼盘列表卡片（找写字楼页）
 *
 * 复用 listing-card 的 CSS 类名，保持与房源卡片一致的布局结构：
 *   媒体区（等级角标）→ 标题 → 位置行 → 标签 → 底部在租面积
 *
 * 守护不变量：
 *   - 只消费 BuildingSummaryViewModel DTO；
 *   - 卡片整体可点击，链接到 /buildings/[slug]；
 *   - 在租面积缺失时不渲染该字段。
 */
type Props = Readonly<{
  building: BuildingSummaryViewModel
  /** 视图模式：grid 竖卡 / list 横卡 */
  view?: 'grid' | 'list'
}>

/** 标签分类着色：地铁类→forest，等级/品质类→copper */
function tagVariantFor(text: string): 'default' | 'forest' | 'copper' {
  if (/地铁|交通|直达|枢纽/.test(text)) return 'forest'
  if (/甲级|超甲|创意|品质/.test(text)) return 'copper'
  return 'default'
}

export default function BuildingListCard({ building, view = 'grid' }: Props) {
  const { coverImage, name, slug, grade, district, nearestMetro, leasableArea } = building
  const fallbackAlt = `${name} 楼盘`

  // 位置行：行政区 · 近XX地铁
  const locationParts: string[] = []
  if (district?.name) locationParts.push(district.name)
  if (nearestMetro?.name) locationParts.push(`近${nearestMetro.name}`)
  const locationLine = locationParts.join(' · ')

  // 标签：等级 + 近地铁
  const tags: string[] = []
  const gradeLabel = getBuildingGradeLabel(grade)
  if (gradeLabel) tags.push(gradeLabel)
  if (nearestMetro?.name) tags.push('近地铁')

  const viewClass = view === 'list' ? ' listing-card--list' : ' listing-card--grid'
  const leasableText = leasableArea != null ? formatArea(leasableArea) : null

  return (
    <Link
      href={`/buildings/${slug}`}
      className={`listing-card${viewClass} building-card`}
      aria-label={`${name}楼盘`}
    >
      <div className="listing-card__media">
        <Media
          media={coverImage}
          ratio="4/3"
          fallbackAlt={fallbackAlt}
        />
        {gradeLabel && <span className="listing-card__type-badge">{gradeLabel}</span>}
      </div>
      <div className="listing-card__body">
        <h3 className="listing-card__title">{name}</h3>
        {locationLine && (
          <span className="listing-card__location" title={locationLine}>
            {locationLine}
          </span>
        )}
        {tags.length > 0 && (
          <div className="listing-card__tags">
            {tags.map((text, i) => (
              <Tag key={`${i}-${text}`} variant={tagVariantFor(text)}>
                {text}
              </Tag>
            ))}
          </div>
        )}
        <div className="listing-card__meta">
          {leasableText ? (
            <>
              <span className="price price--md tabular">在租 {leasableText}</span>
            </>
          ) : (
            <span className="price price--md tabular">暂无在租</span>
          )}
        </div>
      </div>
    </Link>
  )
}
