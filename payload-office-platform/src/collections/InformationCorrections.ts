import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { buildCorrectionCreatedEvent } from '@/domain/corrections/correction-event-publisher'
import { protectInformationCorrection } from '@/domain/corrections/correction-protect'
import {
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
} from '@/domain/corrections/schema'

/**
 * afterChange hook：纠错记录创建后发布领域事件（FPD-P1 Task 6 / R8）。
 *
 * 触发条件：operation=create。不在 update 上触发（update 仅流转 status，
 * 不产生新事件；状态变更的审计由 protect + access 兜底）。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 跨对象副作用使用事务 Outbox
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *
 * 注意：Payload afterChange 不在同一数据库事务内，通过 req.payload.create
 * 写入 Outbox；若写库失败，业务记录已落地，由 Outbox 消费器重试兜底。
 */
const publishCorrectionCreatedEvent: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  const correctionDoc = doc as {
    id: string | number
    targetType?: string | null
    targetSlug?: string | null
    category?: string | null
  }

  const eventResult = buildCorrectionCreatedEvent({
    correctionId: correctionDoc.id,
    targetType: String(correctionDoc.targetType ?? ''),
    targetSlug: String(correctionDoc.targetSlug ?? ''),
    category: String(correctionDoc.category ?? ''),
  })

  if (!eventResult.ok) {
    req.payload.logger?.error?.(
      `[correction] buildCorrectionCreatedEvent failed: ${eventResult.error.message}`,
    )
    return doc
  }

  try {
    await req.payload.create({
      collection: 'domain-events',
      data: {
        eventId: eventResult.data.eventId,
        eventType: eventResult.data.eventType,
        aggregateType: eventResult.data.aggregateType,
        aggregateId: eventResult.data.aggregateId,
        aggregateVersion: eventResult.data.aggregateVersion,
        payload: eventResult.data.payload,
        occurredAt: eventResult.data.occurredAt,
      },
      overrideAccess: true,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    req.payload.logger?.error?.(
      `[correction] publishCorrectionCreatedEvent outbox write failed: ${message}`,
    )
  }

  return doc
}

/** 纠错处理状态（后台流转，前台不可读） */
export const CORRECTION_STATUSES = [
  'new',
  'triaged',
  'resolved',
  'rejected',
] as const
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number]

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  new: '新建',
  triaged: '已分诊',
  resolved: '已解决',
  rejected: '已驳回',
}

/**
 * 公开信息纠错记录（FPD-P1 Task 6）
 *
 * 业务不变量：
 *   - 只追加：记录创建后事实字段不可改（protect hook 兜底）、不可删除（access.delete=false）
 *   - 可审计：status 流转由后台 correction:manage 操作，事实字段审计轨迹完整
 *   - 前台不可读处理状态：read 需 correction:read，公开端点仅 create
 *   - 不收 PII：Modal 仅收类别 + 500 字说明，不收手机号/姓名
 *   - 创建后发布 'correction.created' 领域事件到 Outbox
 *
 * 权限：
 *   - read：correction:read（后台列表 / 详情）
 *   - create：公开（任何人都可提交纠错）
 *   - update：correction:manage（后台流转 status）
 *   - delete：禁止（只追加）
 */
export const InformationCorrections: CollectionConfig = {
  slug: 'information-corrections',
  labels: {
    singular: '信息纠错',
    plural: '信息纠错',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'id',
    defaultColumns: ['targetType', 'targetSlug', 'category', 'status', 'createdAt'],
    description:
      '公开信息纠错记录：只追加，创建后事实不可改、不可删；status 由后台流转。前台不可读取处理状态。',
  },
  access: {
    ...createCollectionAccess({
      read: 'correction:read',
      update: 'correction:manage',
    }),
    // create 公开：任何人都可提交纠错（不收 PII）
    create: () => true,
    // 只追加：禁止删除（审计轨迹）
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectInformationCorrection],
    afterChange: [publishCorrectionCreatedEvent],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'targetType',
          type: 'select',
          required: true,
          options: [
            { label: '房源', value: 'listing' },
            { label: '楼盘', value: 'building' },
          ],
        },
        {
          name: 'targetSlug',
          type: 'text',
          required: true,
          maxLength: 200,
        },
        {
          name: 'category',
          type: 'select',
          required: true,
          options: CORRECTION_CATEGORIES.map((c) => ({
            label: CORRECTION_CATEGORY_LABELS[c],
            value: c,
          })),
        },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      maxLength: 500,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          type: 'select',
          required: true,
          defaultValue: 'new',
          admin: { readOnly: true },
          options: CORRECTION_STATUSES.map((s) => ({
            label: CORRECTION_STATUS_LABELS[s],
            value: s,
          })),
        },
        {
          name: 'requestId',
          type: 'text',
          required: true,
          maxLength: 100,
        },
        {
          name: 'idempotencyKey',
          type: 'text',
          required: true,
          unique: true,
          index: true,
          admin: { readOnly: true },
        },
        {
          name: 'reporterIpHash',
          type: 'text',
          admin: { readOnly: true, description: '提交 IP 哈希（反垃圾），不存原始 IP' },
        },
      ],
    },
  ],
}
