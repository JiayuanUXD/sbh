'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Modal } from '@/components/frontend/ui/Modal'
import {
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
  LIMITS,
  type CorrectionCategory,
} from '@/domain/corrections/schema'
import { track } from '@/lib/frontend/analytics'

/**
 * P1 Task 6 信息纠错 Modal
 *
 * 守护不变量：
 *   - 仅收类别（7 类公开枚举）+ 说明（≤500 字），不收手机号/姓名等 PII；
 *   - 提交 POST /api/corrections，同源 + schema + 限流 + 幂等由路由兜底；
 *   - 成功后显示"已收到，我们会核实"，不暴露处理状态（前台不可读取）；
 *   - 重复提交进入不可重复点击状态；
 *   - 限流 -> 提示稍后重试（不清空已填内容）；
 *   - 分析事件：correction_open / correction_submit / correction_success / correction_error，
 *     仅记录类别枚举与目标，不记录说明正文。
 *
 * 仅从 schema 子路径导入（纯 TS，不引入 node:crypto 到客户端 bundle）。
 */

type TargetType = 'listing' | 'building'

type Props = {
  /** 目标类型（房源 / 楼盘） */
  targetType: TargetType
  /** 目标 slug */
  targetSlug: string
  /** 目标摘要（房源标题 / 楼盘名），用于弹层副标题 */
  targetSummary?: string
  /** 触发按钮文案 */
  triggerLabel?: string
  /** 触发按钮 variant */
  triggerVariant?: 'primary' | 'ghost' | 'ink'
  /** 触发按钮附加 className */
  triggerClassName?: string
}

type SubmitStatus = 'idle' | 'submitting' | 'error'

/** 错误码 -> 中文提示（不暴露内部信息） */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: '请求数据格式错误',
  invalid_json: '请求数据格式错误',
  invalid_content_type: '请求数据格式错误',
  body_too_large: '内容过长',
  request_id_required: '请求标识缺失',
  request_id_too_long: '请求标识过长',
  target_type_invalid: '目标类型无效',
  target_slug_required: '目标缺失',
  target_slug_too_long: '目标过长',
  category_invalid: '请选择纠错类别',
  description_required: '请填写问题描述',
  description_too_long: `问题描述不能超过 ${LIMITS.DESCRIPTION_MAX} 字`,
  rate_limited: '提交过于频繁，请稍后重试',
  server_error: '系统暂时不可用，请稍后重试',
  forbidden: '请求不被允许',
}

const DEFAULT_TRIGGER_LABEL = '信息纠错'

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 回退：时间戳 + 随机数（不依赖 Web Crypto）
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export default function CorrectionModal(props: Props) {
  const {
    targetType,
    targetSlug,
    targetSummary,
    triggerLabel = DEFAULT_TRIGGER_LABEL,
    triggerVariant = 'ghost',
    triggerClassName,
  } = props

  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [submitted, setSubmitted] = useState(false)
  const [category, setCategory] = useState<CorrectionCategory | ''>('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const feedbackRef = useRef<HTMLDivElement | null>(null)
  const errorSummaryId = useId()

  // 成功态：焦点移入成功标题，让屏幕阅读器播报"已收到，我们会核实"
  useEffect(() => {
    if (open && submitted) {
      successHeadingRef.current?.focus()
    }
  }, [open, submitted])

  // 错误态：焦点移到首个无效字段或错误摘要
  useEffect(() => {
    if (!open || (errors.length === 0 && !serverError)) return
    const invalidField = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalidField) invalidField.focus()
    else feedbackRef.current?.focus()
  }, [errors, open, serverError])

  function openModal() {
    setErrors([])
    setServerError(null)
    setStatus('idle')
    setSubmitted(false)
    setCategory('')
    setDescription('')
    setOpen(true)
    track('correction_open', {
      target_type: targetType,
      has_target: Boolean(targetSlug),
    })
  }

  function closeModal() {
    setOpen(false)
    // 焦点归还触发器
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function validateClient(): string[] {
    const errs: string[] = []
    if (!category || !(CORRECTION_CATEGORIES as readonly string[]).includes(category)) {
      errs.push('category_invalid')
    }
    const trimmed = description.trim()
    if (!trimmed) errs.push('description_required')
    else if (trimmed.length > LIMITS.DESCRIPTION_MAX) errs.push('description_too_long')
    return errs
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return

    const clientErrors = validateClient()
    setErrors(clientErrors)
    setServerError(null)
    if (clientErrors.length > 0) return

    setStatus('submitting')

    const requestId = generateRequestId()
    const requestBody = {
      requestId,
      targetType,
      targetSlug,
      category,
      description: description.trim(),
    }

    // 分析事件：提交（仅记录类别枚举，不含说明正文）
    track('correction_submit', {
      target_type: targetType,
      category,
    })

    try {
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = (await res.json().catch(() => ({}))) as {
        errors?: string[]
        error?: string
      }

      if (res.ok) {
        setStatus('idle')
        setSubmitted(true)
        track('correction_success', {
          target_type: targetType,
          category,
          idempotent: false,
        })
        return
      }

      // 限流：不清空已填内容
      if (data.error === 'rate_limited') {
        setServerError(ERROR_MESSAGES.rate_limited)
        setStatus('error')
        track('correction_error', {
          target_type: targetType,
          error_code: 'rate_limited',
        })
        return
      }

      // 字段错误
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setErrors(data.errors)
        setServerError(null)
        setStatus('error')
        track('correction_error', {
          target_type: targetType,
          error_code: data.errors[0],
        })
        return
      }

      // 其他服务端错误
      const errorCode = data.error ?? 'server_error'
      setServerError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.server_error)
      setStatus('error')
      track('correction_error', {
        target_type: targetType,
        error_code: errorCode,
      })
    } catch {
      // 网络失败：保留内容，允许重试
      setServerError('网络异常，请检查后重试')
      setStatus('error')
      track('correction_error', {
        target_type: targetType,
        error_code: 'network_error',
      })
    }
  }

  function handleSuccessClose() {
    closeModal()
  }

  const triggerClass = ['btn', `btn--${triggerVariant}`, triggerClassName ?? '']
    .filter(Boolean)
    .join(' ')

  const subtitle = targetSummary ?? '发现信息有误？请告诉我们，我们会核实'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={openModal}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-event-name="correction_open_trigger"
        data-target-type={targetType}
      >
        {triggerLabel}
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        triggerRef={triggerRef}
        title="信息纠错"
        subtitle={subtitle}
        closeLabel="关闭纠错弹层"
      >
        {submitted ? (
          <div className="modal__success" role="status" aria-live="polite">
            <h4 ref={successHeadingRef} tabIndex={-1}>已收到，我们会核实</h4>
            <p className="modal__success-detail">
              感谢你的反馈，我们会在核实后更新信息。本纠错不涉及你的个人信息。
            </p>
            <div className="modal__footer">
              <button type="button" className="btn btn--ghost" onClick={handleSuccessClose}>
                继续浏览
              </button>
            </div>
          </div>
        ) : (
          <form className="modal__form" onSubmit={submit} noValidate>
            <label className="modal__label" htmlFor={`f-correction-category-${errorSummaryId}`}>
              纠错类别
              <span className="modal__required" aria-hidden="true">*</span>
              <select
                id={`f-correction-category-${errorSummaryId}`}
                className="modal__input"
                value={category}
                onChange={(e) => setCategory(e.target.value as CorrectionCategory | '')}
                required
                aria-required="true"
                aria-invalid={errors.includes('category_invalid')}
                aria-describedby={errors.includes('category_invalid') ? errorSummaryId : undefined}
              >
                <option value="" disabled>
                  请选择类别
                </option>
                {CORRECTION_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CORRECTION_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="modal__label" htmlFor={`f-correction-desc-${errorSummaryId}`}>
              问题描述
              <span className="modal__required" aria-hidden="true">*</span>
              <textarea
                id={`f-correction-desc-${errorSummaryId}`}
                className="modal__input modal__textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={LIMITS.DESCRIPTION_MAX}
                required
                placeholder="如：价格应为 8 元/㎡·天，页面显示为 12"
                aria-required="true"
                aria-invalid={
                  errors.includes('description_required') || errors.includes('description_too_long')
                }
                aria-describedby={
                  errors.includes('description_required') || errors.includes('description_too_long')
                    ? errorSummaryId
                    : undefined
                }
              />
            </label>
            <p className="modal__hint" aria-hidden="true">
              {description.length}/{LIMITS.DESCRIPTION_MAX}
            </p>

            {(errors.length > 0 || serverError) && (
              <div id={errorSummaryId} ref={feedbackRef} tabIndex={-1}>
                {errors.length > 0 && (
                  <ul className="modal__error-list" role="alert" aria-live="polite">
                    {errors.map((code) => <li key={code}>{ERROR_MESSAGES[code] ?? code}</li>)}
                  </ul>
                )}
                {serverError && <p className="modal__error" role="alert" aria-live="polite">{serverError}</p>}
              </div>
            )}

            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={status === 'submitting'}
              data-event-name="correction_submit_click"
              data-target-type={targetType}
            >
              {status === 'submitting' ? '提交中…' : '提交纠错'}
            </button>

            <p className="modal__hint">
              纠错不收集你的联系方式，提交后无法查看处理状态，我们会主动核实。
            </p>
          </form>
        )}
      </Modal>
    </>
  )
}
