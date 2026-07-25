import React from 'react'

/**
 * 状态展示原语：EmptyState、ErrorState、Skeleton
 *
 * 设计依据：specs/frontend-mvp/design.md §13
 * 守护不变量：
 *   - 失败不显示为 0 套，无结果不混入无关房源；
 *   - 错误状态提供下一步动作；
 *   - Skeleton 满足 prefers-reduced-motion（已在 styles.css 处理）。
 */

type EmptyStateProps = {
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ title = '暂无结果', description, action, className }: EmptyStateProps) {
  return (
    <div className={['empty-state', className ?? ''].filter(Boolean).join(' ')}>
      <p className="empty-state__title">{title}</p>
      {description && <p className="empty-state__desc">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}

type ErrorStateProps = {
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function ErrorState({
  title = '加载失败',
  description = '请稍后重试，或联系客服。',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div className={['error-state', className ?? ''].filter(Boolean).join(' ')} role="alert">
      <p className="error-state__title">{title}</p>
      <p>{description}</p>
      {action && <div className="error-state__action">{action}</div>}
    </div>
  )
}

type SkeletonProps = {
  /** 宽度，如 '100%'、'280px' */
  width?: string
  /** 高度，如 '180px'、'1rem' */
  height?: string
  /** 圆角，默认 var(--radius-md) */
  radius?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '180px', radius, className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', className ?? ''].filter(Boolean).join(' ')}
      style={{
        width,
        height,
        borderRadius: radius ?? 'var(--radius-md)',
        display: 'block',
      }}
      aria-hidden="true"
    />
  )
}

/** 卡片骨架：媒体 + 标题 + 摘要 */
export function ListingCardSkeleton() {
  return (
    <div className="listing-card" aria-hidden="true">
      <Skeleton height="180px" radius="0" />
      <div className="listing-card__body">
        <Skeleton width="60%" height="18px" />
        <Skeleton width="100%" height="20px" />
        <Skeleton width="80%" height="14px" />
        <div className="listing-card__tags" style={{ marginTop: 8 }}>
          <Skeleton width="60px" height="20px" radius="999px" />
          <Skeleton width="48px" height="20px" radius="999px" />
        </div>
      </div>
    </div>
  )
}
