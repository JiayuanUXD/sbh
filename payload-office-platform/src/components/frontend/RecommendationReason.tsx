import React from 'react'
import type { ReasonCode } from '@/domain/recommendation/detail-recommendations'

/**
 * 推荐理由标签组件（P2 Task 5）
 *
 * 在推荐房源卡片下方展示最多两个可读理由标签。
 * 不变量：
 *   - 只消费 reasonCodes，不读取任何用户身份信息
 *   - 最多展示 2 个理由
 */

const REASON_LABELS: Record<ReasonCode, string> = {
  'same-business-area': '同商圈',
  'same-listing-type': '同类型',
  'same-price-unit': '同单位',
  'similar-area': '面积相近',
  'similar-price': '价格相近',
}

type Props = Readonly<{
  reasonCodes: readonly ReasonCode[]
  /** 最多展示几个理由标签，默认 2 */
  maxDisplay?: number
}>

export default function RecommendationReason({ reasonCodes, maxDisplay = 2 }: Props) {
  const displayCodes = reasonCodes.slice(0, maxDisplay)
  if (displayCodes.length === 0) return null

  return (
    <span className="recommendation-reasons" aria-label="推荐理由">
      {displayCodes.map((code) => (
        <span key={code} className="recommendation-reason-tag">
          {REASON_LABELS[code] ?? code}
        </span>
      ))}
    </span>
  )
}
