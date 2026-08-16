import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { buildReportClosedEvent } from '@/domain/report/report-event-publisher'
import { protectListingReport } from '@/domain/report/report-protect'
import {
  isReportConclusion,
  REPORT_CONCLUSIONS,
  REPORT_CONCLUSION_LABELS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  type ReportConclusion,
} from '@/domain/report/report-status'

/**
 * afterChange hook：举报关闭后发布领域事件（M6.2 / R8）。
 *
 * 触发条件：operation=update 且 status 从非 closed → closed。
 * 不在 create / 非 closed 转换上触发，避免重复发布事件。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 跨对象副作用使用事务 Outbox
 *   - 高风险操作的业务写入、事件和审计位于同一事务
 *
 * 注意：Payload afterChange 不在同一数据库事务内（Hook 文档），
 * 通过 req.payload.create 写入 Outbox；若写库失败，业务记录已落地，
 * 由 Outbox 消费器的重试机制兜底（M6.3 已实现 attemptCount + 死信标记）。
 *
 * 事件映射：
 *   - conclusion=sustained / partial → 'report.sustained'
 *   - conclusion=dismissed           → 'report.dismissed'
 *
 * actorId 来源：req.user.id（关闭操作必须登录）；overrideAccess 时
 * req.user 可能为空，此时 actorId='system'（如脚本回填）。
 */
const publishReportClosedEvent: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  // 仅在状态变化为 closed 时发布事件
  const prevStatus = (previousDoc as { status?: string | null })?.status
  const nextStatus = (doc as { status?: string | null }).status
  if (nextStatus !== 'closed' || prevStatus === 'closed') return doc

  // 构造事件入参快照
  const reportDoc = doc as {
    id: string | number
    targetListing?: number | string | { id: string | number } | null
    status?: string | null
    statusVersion?: number | null
    conclusion?: string | null
    conclusionReason?: string | null
    supplyPaused?: boolean | null
    evidence?: Array<unknown> | null
  }

  // 解析 targetListing ID（兼容 number / string / 对象）
  const targetListing = reportDoc.targetListing
  let targetListingId: string | number = ''
  if (typeof targetListing === 'string' || typeof targetListing === 'number') {
    targetListingId = targetListing
  } else if (targetListing && typeof targetListing === 'object' && 'id' in targetListing) {
    targetListingId = targetListing.id
  }

  // 收窄 conclusion 类型（string → ReportConclusion | null）
  const conclusionRaw = reportDoc.conclusion
  const conclusion: ReportConclusion | null = isReportConclusion(conclusionRaw)
    ? conclusionRaw
    : null

  const actorId = req.user?.id ?? 'system'

  const eventResult = buildReportClosedEvent({
    report: {
      id: reportDoc.id,
      targetListingId,
      status: reportDoc.status ?? '',
      statusVersion: typeof reportDoc.statusVersion === 'number' ? reportDoc.statusVersion : 1,
      conclusion,
      conclusionReason: reportDoc.conclusionReason ?? null,
      supplyPaused: Boolean(reportDoc.supplyPaused),
      evidence: reportDoc.evidence,
    },
    actorId,
    supplyPaused: Boolean(reportDoc.supplyPaused),
  })

  if (!eventResult.ok) {
    // 事件生成失败：记录日志，不阻断业务（业务记录已落地）
    req.payload.logger?.error?.(
      `[report] buildReportClosedEvent failed: ${eventResult.error.message}`,
    )
    return doc
  }

  // 写入 Outbox（domain-events collection）
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
    // Outbox 写入失败：记录日志，不阻断业务（M6.3 消费器重试兜底）
    const message = e instanceof Error ? e.message : String(e)
    req.payload.logger?.error?.(`[report] publishReportClosedEvent outbox write failed: ${message}`)
  }

  return doc
}

/**
 * 房源举报记录（tasks.md M6.1-M6.2 / design §3.5 listing_reports / R5）
 *
 * 处理流程：分诊 → 领取 → 核实 → 等待资料 → 提交复核 → 关闭
 * 状态转换由 endpoint 调用 transitionReportStatus 服务完成；
 * protectListingReport 在 beforeChange 兜底校验枚举与转换合法性，
 * 并在 status 转到 closed 时自动推导 supplyPaused（M6.2 新增）。
 * publishReportClosedEvent 在 afterChange 发布领域事件到 Outbox（M6.2 新增）。
 *
 * 业务不变量（AGENTS.md §5.2, §10）：
 *   - 有效举报暂停只影响统一有效供给谓词（supplyPaused → 举报谓词排除）
 *   - 不改写审核状态和发布状态
 *   - 恢复和关闭要求权限、原因和审计
 *   - 跨对象副作用使用事务 Outbox
 *
 * 权限：
 *   - read：report:read（举报列表 / 详情）
 *   - create：公开（任何人都可举报，支持匿名）
 *   - update / delete：report:manage
 *   - 状态转换业务动作权限（report:triage / report:resolve）由 endpoint 校验
 *   - 修改供给暂停字段（supplyPaused / supplyPausedAt / supplyResumedAt）
 *     由 protectListingReport 兜底校验 report:resolve 权限（M6.2 新增）
 */
export const ListingReports: CollectionConfig = {
  slug: 'listing-reports',
  labels: {
    singular: '房源举报',
    plural: '房源举报',
  },
  admin: {
    group: false,
    useAsTitle: 'reason',
    defaultColumns: ['reason', 'targetListing', 'status', 'assignee', 'supplyPaused', 'createdAt'],
    description:
      '房源举报处理流：分诊 → 领取 → 核实 → 等待资料 → 提交复核 → 关闭。有效举报暂停供给可见性，不改写审核和发布状态。',
  },
  access: {
    ...createCollectionAccess({
      read: 'report:read',
      update: 'report:manage',
      delete: 'report:manage',
    }),
    // create 公开：任何人都可举报（匿名举报可空 reporterName / reporterPhone）
    create: () => true,
  },
  hooks: {
    beforeChange: [protectListingReport],
    afterChange: [publishReportClosedEvent],
  },
  fields: [
    {
      name: 'targetListing',
      label: '被举报房源',
      type: 'relationship',
      relationTo: 'listings',
      required: true,
      admin: {
        description: '举报指向的房源。',
      },
    },
    {
      name: 'reason',
      label: '举报原因',
      type: 'select',
      required: true,
      options: REPORT_REASONS.map((value) => ({
        value,
        label: REPORT_REASON_LABELS[value],
      })),
      admin: {
        description: '举报原因码，决定处理优先级和供给影响判定。',
      },
    },
    {
      name: 'reasonDetail',
      label: '原因详情',
      type: 'textarea',
      admin: {
        description: '举报人补充的具体问题描述（可选）。',
      },
    },
    {
      name: 'evidence',
      label: '证据材料',
      type: 'array',
      maxRows: 5,
      admin: {
        description: '最多 5 张截图或图片证据。',
      },
      fields: [
        {
          name: 'image',
          label: '图片',
          type: 'upload',
          relationTo: 'media',
          required: true,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'reporterName',
          label: '举报人姓名',
          type: 'text',
          admin: {
            description: '匿名举报可留空。',
          },
        },
        {
          name: 'reporterPhone',
          label: '举报人电话',
          type: 'text',
          admin: {
            description: '匿名举报可留空；非匿名时用于回访。',
          },
        },
        {
          name: 'reporterIpHash',
          label: '举报人 IP 哈希',
          type: 'text',
          admin: {
            readOnly: true,
            description: '存储 IP 哈希用于反垃圾，不存原始 IP。',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          label: '处理状态',
          type: 'select',
          options: REPORT_STATUSES.map((value) => ({
            value,
            label: REPORT_STATUS_LABELS[value],
          })),
          admin: {
            readOnly: true,
            description: '由状态转换服务推导，不接受外部直接指定。',
          },
        },
        {
          name: 'statusVersion',
          label: '状态版本号',
          type: 'number',
          defaultValue: 1,
          admin: {
            readOnly: true,
            description: '每次状态变更 +1，用于乐观锁和审计。',
          },
        },
        {
          name: 'assignee',
          label: '负责人',
          type: 'relationship',
          relationTo: 'users',
          admin: {
            description: '分诊或领取后指派的处理人。',
          },
        },
        {
          name: 'conclusion',
          label: '结论',
          type: 'select',
          options: REPORT_CONCLUSIONS.map((value) => ({
            value,
            label: REPORT_CONCLUSION_LABELS[value],
          })),
          admin: {
            description: '仅在关闭时填写：举报成立 / 不成立 / 部分成立。',
          },
        },
      ],
    },
    {
      name: 'conclusionReason',
      label: '结论原因',
      type: 'textarea',
      admin: {
        description: '关闭举报时必填，记录关闭依据。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'supplyPaused',
          label: '供给已暂停',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            readOnly: true,
            description: '有效举报成立时为 true，影响统一有效供给谓词。',
          },
        },
        {
          name: 'supplyPausedAt',
          label: '供给暂停时间',
          type: 'date',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'supplyResumedAt',
          label: '供给恢复时间',
          type: 'date',
          admin: {
            readOnly: true,
          },
        },
      ],
    },
  ],
}
