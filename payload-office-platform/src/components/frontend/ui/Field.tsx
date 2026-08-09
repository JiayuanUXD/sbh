import React from 'react'

/**
 * 表单字段原语
 *
 * 设计依据：specs/frontend-mvp/design.md §14.2；web-design-guidelines
 * 守护不变量：
 *   - <label> 与控件通过 htmlFor 关联，单一命中目标；
 *   - 输入框带 autocomplete / name / inputmode / spellcheck；
 *   - 错误信息用 aria-describedby + role="alert" 关联，可读 announce；
 *   - placeholder 以「…」结尾并显示示例。
 */

type FieldProps = {
  label: string
  /** 必须传 id 才能正确关联 label 与控件 */
  id: string
  /** 错误文案；存在时输入框加 aria-invalid */
  error?: string | null
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function mergeFieldAriaDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const uniqueIds = [...new Set(ids.flatMap((id) => id?.split(/\s+/).filter(Boolean) ?? []))]
  return uniqueIds.length > 0 ? uniqueIds.join(' ') : undefined
}

function getAriaDescribedBy(props: unknown): string | undefined {
  if (typeof props !== 'object' || props === null || !('aria-describedby' in props)) return undefined
  const describedBy = props['aria-describedby']
  return typeof describedBy === 'string' ? describedBy : undefined
}

export function Field({ label, id, error, hint, required, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const childDescribedBy = React.isValidElement(children)
    ? getAriaDescribedBy(children.props)
    : undefined
  const describedBy = mergeFieldAriaDescribedBy(childDescribedBy, hintId, errorId)
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="field__label">
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedBy,
            'aria-required': required || undefined,
          })
        : children}
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={['filter-bar__input', invalid ? 'filter-bar__input--invalid' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
})

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={['filter-bar__select', invalid ? 'filter-bar__select--invalid' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </select>
  )
})

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={['filter-bar__input', 'filter-bar__textarea', invalid ? 'filter-bar__input--invalid' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
})
