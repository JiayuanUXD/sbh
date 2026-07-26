import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { protectListingReport } from '@/domain/report/report-protect'
import {
  REPORT_CONCLUSIONS,
  REPORT_CONCLUSION_LABELS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
} from '@/domain/report/report-status'

/**
 * 房源举报记录（tasks.md M6.1 / design §3.5 listing_reports / R5）
 *
 * 处理流程：分诊 → 领取 → 核实 → 等待资料 → 提交复核 → 关闭
 * 状态转换由 endpoint 调用 transitionReportStatus 服务完成；
 * protectListingReport 在 beforeChange 兜底校验枚举与转换合法性。
 *
 * 业务不变量（AGENTS.md §5.2）：
 *   - 有效举报暂停只影响统一有效供给谓词（supplyPaused → supply_visibility_hold）
 *   - 不改写审核状态和发布状态
 *   - 恢复和关闭要求权限、原因和审计
 *
 * 权限：
 *   - read：report:read（举报列表 / 详情）
 *   - create：公开（任何人都可举报，支持匿名）
 *   - update / delete：report:manage
 *   - 状态转换业务动作权限（report:triage / report:resolve）由 endpoint 校验
 */
export const ListingReports: CollectionConfig = {
  slug: 'listing-reports',
  labels: {
    singular: '房源举报',
    plural: '房源举报',
  },
  admin: {
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
    {
      name: 'conclusionReason',
      label: '结论原因',
      type: 'textarea',
      admin: {
        description: '关闭举报时必填，记录关闭依据。',
      },
    },
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
}
