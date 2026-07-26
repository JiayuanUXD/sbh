import React from 'react'

/**
 * 价格展示原语
 *
 * 设计依据：specs/frontend-mvp/design.md §6.3、§7.2
 * 守护不变量：
 *   - 金额数字使用 IBM Plex Sans + tabular-nums；
 *   - 单位与数值同屏；
 *   - 不展示跨币种/跨单位统一区间（design.md §7.4）；
 *   - 缺失价格回退到「待面议」。
 */

export type PriceViewModel = {
  /** 可读文本，如「6.5 元/㎡·天」或「18,000 元/月」 */
  text: string
  /** 可选数值（用于排序场景，不在 UI 直接展示） */
  value?: number | null
  /** 币种代码（仅用于排序分组） */
  currency?: string | null
  /** 单位代码（仅用于排序分组） */
  unit?: string | null
}

type Props = {
  price: PriceViewModel | null | undefined
  /** 字号档：sm=14, md=18, lg=26 */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'price--sm',
  md: 'price--md',
  lg: 'price--lg',
}

export function Price({ price, size = 'md', className }: Props) {
  const text = price?.text ?? '待面议'
  const cls = ['price', 'tabular', SIZE_CLASS[size], className ?? '']
    .filter(Boolean)
    .join(' ')
  return <span className={cls}>{text}</span>
}
