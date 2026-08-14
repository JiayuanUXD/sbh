'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * 可访问弹层原语
 *
 * 设计依据：specs/frontend-mvp/design.md §14.2；FP-05 §2
 * 守护不变量：
 *   - role="dialog" aria-modal="true" + aria-labelledby；
 *   - 打开时锁焦点在弹层内，关闭时归还焦点到触发器；
 *   - Esc 关闭；
 *   - 背景不可点击、不可滚动；
 *   - overscroll-behavior: contain（已在 styles.css）。
 *
 * 用法：
 *   const [open, setOpen] = useState(false)
 *   <button ref={triggerRef} onClick={() => setOpen(true)}>打开</button>
 *   <Modal open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} title="询价">
 *     ...表单内容...
 *   </Modal>
 */

type Props = {
  open: boolean
  onClose: () => void
  /** 触发器 ref，关闭后焦点归还到此元素 */
  triggerRef?: React.RefObject<HTMLElement | null>
  /** 弹层标题，用于 aria-labelledby */
  title: string
  /** 可选副标题 */
  subtitle?: string
  /** 关闭按钮 aria-label */
  closeLabel?: string
  children: React.ReactNode
  className?: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  triggerRef,
  title,
  subtitle,
  closeLabel = '关闭',
  children,
  className,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = React.useId()

  // Esc 关闭 + 焦点锁定
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null,
        )
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 打开时把焦点移入弹层首个可聚焦元素
    const dialog = dialogRef.current
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      first?.focus()
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  // 关闭时归还焦点到触发器
  useEffect(() => {
    if (open) return
    triggerRef?.current?.focus()
  }, [open, triggerRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal__overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={['modal', className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal__close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
        <h3 id={titleId} className="modal__title">
          {title}
        </h3>
        {subtitle && <p className="modal__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>,
    document.body,
  )
}
