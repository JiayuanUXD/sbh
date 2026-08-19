'use client'

import React, { useEffect, useMemo, useRef } from 'react'
import { Message, Tag, Typography } from '@arco-design/web-react'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import { useFormProcessing, useFormSubmitted } from '@payloadcms/ui'

import {
  deriveListingSelfVisibility,
  type SelfVisibilityCheck,
} from '@/domain/review/listing-self-visibility'
import { locateFormField } from './locate-form-field'

const { Text } = Typography

/**
 * 房源编辑页「前台可见性」卡片 - 客户端展示（OPT-030 §4 第一/二层）
 *
 *   第一层：逐条展示自身条件（发布/审核/冻结/举报），点击定位到
 *           对应 Tab 与字段，而不只是报错。
 *   第二层：保存成功但自身条件仍不满足时 Toast 主因，避免「保存成功」
 *           被误读为「已上线」。
 *
 * 状态类字段直接读表单 value（含未保存的编辑），表单未同步时回落文档基线；
 * 举报暂停由服务端父组件查好传入（跨表单状态，编辑页内改不了）。
 * 口径来自 deriveListingSelfVisibility（domain 纯函数，与统一有效供给
 * 查询层谓词一致），本组件不自拼判断。
 */

type Props = {
  /** 房源 ID；新建未保存为 null。 */
  listingId: string | null
  /** 是否被有效举报暂停供给（服务端查 listing-reports）。 */
  reportPaused: boolean
}

export default function ListingVisibilityCardClient({ listingId, reportPaused }: Props) {
  const { data } = useDocumentInfo()
  const { value: publicationStatus } = useField<unknown>({ path: 'publicationStatus' })
  const { value: reviewStatus } = useField<unknown>({ path: 'reviewStatus' })
  const { value: supplyVisibilityHold } = useField<unknown>({ path: 'supplyVisibilityHold' })

  const doc = (data ?? {}) as Record<string, unknown>

  const result = useMemo(
    () =>
      deriveListingSelfVisibility({
        // 表单值优先（未保存的编辑即时反映）；表单尚未同步时回落文档基线。
        publicationStatus: publicationStatus ?? doc.publicationStatus,
        reviewStatus: reviewStatus ?? doc.reviewStatus,
        supplyVisibilityHold: supplyVisibilityHold ?? doc.supplyVisibilityHold,
        reportPaused,
      }),
    [
      doc.publicationStatus,
      doc.reviewStatus,
      doc.supplyVisibilityHold,
      publicationStatus,
      reportPaused,
      reviewStatus,
      supplyVisibilityHold,
    ],
  )

  // ── 第二层：保存成功仍不可见 -> Toast 主因 ──
  // 成功保存的形态是 processing true->false 且 submitted 回落 false
  // （校验失败/请求失败时 submitted 停在 true，见 @payloadcms/ui Form）。
  const processing = useFormProcessing()
  const submitted = useFormSubmitted()
  const wasProcessingRef = useRef(false)
  const resultRef = useRef(result)

  // 判定结果只在保存完成的那一帧被读取，不参与渲染；用 effect 同步而不是
  // 渲染期写 ref（渲染期访问 ref 违反 react-hooks 规则，且并发渲染下不安全）。
  // 本 effect 声明在下方 Toast effect 之前，同一次提交里先同步再读取。
  useEffect(() => {
    resultRef.current = result
  }, [result])

  useEffect(() => {
    if (processing) {
      wasProcessingRef.current = true
      return
    }
    if (wasProcessingRef.current && !submitted) {
      wasProcessingRef.current = false
      const blocker = resultRef.current.primaryBlocker
      if (blocker) {
        Message.info(`已保存。前台仍不可见：${blocker.label}${blocker.hint ? `——${blocker.hint}` : ''}`)
      }
    }
  }, [processing, submitted])

  const handleCheckClick = (check: SelfVisibilityCheck) => {
    if (check.ok) return
    if (check.key === 'reportPaused' && listingId !== null) {
      // 举报是独立集合，不在本表单内；直达该房源的举报列表。
      window.open(
        `/admin/collections/listing-reports?where[targetListing][equals]=${encodeURIComponent(listingId)}`,
        '_blank',
      )
      return
    }
    if (check.locateTab !== null) {
      locateFormField(check.locateTab, check.locateFieldLabel, 'warning')
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-100, #e5e5e5)',
        borderRadius: 6,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: 600 }}>前台可见性：</Text>
        {result.selfVisible ? (
          <Tag color="green">自身条件已齐</Tag>
        ) : (
          <Tag color="red">暂不可见</Tag>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          仅校验房源自身条件；商户 / 楼盘 / 服务城市等关联条件未包含在内
        </Text>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 20px',
          marginTop: 12,
        }}
      >
        {result.checks.map((check) => (
          <button
            key={check.key}
            type="button"
            disabled={check.ok}
            aria-label={
              check.ok
                ? `${check.label}：已满足`
                : `${check.label}：未满足。点击定位到修复位置`
            }
            onClick={() => handleCheckClick(check)}
            style={{
              fontSize: 13,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: check.ok ? 'default' : 'pointer',
              color: check.ok
                ? 'var(--theme-success-600, #00b42a)'
                : 'var(--theme-error-500, #f53f3f)',
              textDecoration: check.ok ? 'none' : 'underline dotted',
              textDecorationColor: 'currentColor',
              textUnderlineOffset: 3,
            }}
          >
            {check.ok ? '✓' : '✗'} {check.label}
          </button>
        ))}
      </div>

      {result.primaryBlocker && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          主要原因：{result.primaryBlocker.label}——{result.primaryBlocker.hint}
          （点击上方对应条目可定位到修复位置）
        </Text>
      )}
    </div>
  )
}
