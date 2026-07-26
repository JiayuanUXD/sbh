import Link from 'next/link'
import React from 'react'

/**
 * 按钮 / 链接原语
 *
 * 设计依据：specs/frontend-mvp/design.md §6.5、§13
 * 守护不变量：
 *   - 通过 `as` prop 在 <button> 与 <Link> 之间切换；
 *   - 统一 variant / size / loading / disabled / focus 状态；
 *   - 触控目标 ≥ 44×44px（design.md §14.2）；
 *   - 禁止 div onClick，导航一律走 Link。
 */
export type ButtonVariant = 'primary' | 'ghost' | 'ink'
export type ButtonSize = 'sm' | 'md' | 'lg'

type BaseProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  block?: boolean
  className?: string
  children: React.ReactNode
}

type ButtonAsButton = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    as?: 'button'
  }

type ButtonAsLink = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps | 'href'> & {
    as: 'link'
    href: string
  }

export type ButtonProps = ButtonAsButton | ButtonAsLink

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  ink: 'btn--ink',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'btn--sm',
  md: '',
  lg: 'btn--lg',
}

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    block = false,
    className,
    children,
    ...rest
  } = props

  const cls = [
    'btn',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if (props.as === 'link') {
    const { as: _as, href, ...linkRest } = rest as ButtonAsLink
    void _as
    return (
      <Link href={href} className={cls} aria-busy={loading || undefined} {...linkRest}>
        {loading ? <Spinner /> : children}
      </Link>
    )
  }

  const { as: _as, type, disabled, ...buttonRest } = rest as ButtonAsButton
  void _as
  return (
    <button
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...buttonRest}
    >
      {loading ? <Spinner /> : children}
    </button>
  )
}

function Spinner() {
  return (
    <span className="btn__spinner" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
          strokeOpacity="0.3"
        />
        <path
          d="M14 8a6 6 0 0 0-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 8 8"
            to="360 8 8"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </span>
  )
}
