import React from 'react'

/**
 * 标签原语
 *
 * 设计依据：specs/frontend-mvp/design.md §6.5
 * 用途：亮点、类型、状态等小尺寸标签。
 */
export type TagVariant = 'default' | 'copper' | 'forest'
export type TagSize = 'sm' | 'lg'

type Props = {
  variant?: TagVariant
  size?: TagSize
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLSpanElement>

const VARIANT_CLASS: Record<TagVariant, string> = {
  default: '',
  copper: 'tag--copper',
  forest: 'tag--forest',
}

const SIZE_CLASS: Record<TagSize, string> = {
  sm: '',
  lg: 'tag--lg',
}

export function Tag({ variant = 'default', size = 'sm', className, children, ...rest }: Props) {
  const cls = [
    'tag',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  )
}
