import type { CollectionConfig } from 'payload'

import { protectListingReview } from '@/domain/review/listing-review-protect'
import { REVIEW_DECISIONS, REVIEW_DECISION_LABELS } from '@/domain/review/review-status'
import {
  REVIEW_TASK_STATUSES,
  REVIEW_TASK_STATUS_LABELS,
} from '@/domain/review/review-transition'

/**
 * 房源审核记录（tasks.md M4.4 / design.md §3.5、§4.3）
 *
 * 事件溯源、append-only：每个审核动作（提交/撤回/通过/驳回/重新提交）都新建一条
 * 不可变记录，房源当前审核态由最新记录推导。记录一经创建即不可修改、不可物理删除，
 * 由 access.update/delete=false（挡后台 UI + REST）叠加 protectListingReview（挡 Local API）
 * 双重兜底。task_status（待处理→处理中→已完成/已取消）随记录推进，单条记录永不 in-place 改。
 *
 * snapshot_hash 与 task_status 均由服务端从动作单一推导，绝不信任外部传入。
 */
export const ListingReviews: CollectionConfig = {
  slug: 'listing-reviews',
  labels: {
    singular: '审核记录',
    plural: '房源审核',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['listing', 'decision', 'taskStatus', 'submittedBy', 'createdAt'],
    description: '房源审核事件流：提交/撤回/通过/驳回。记录创建后不可修改或删除。',
  },
  access: {
    read: () => true,
    // append-only：审核记录不可修改、不可物理删除（design §3.5）
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectListingReview],
  },
  fields: [
    {
      name: 'listing',
      label: '房源',
      type: 'relationship',
      relationTo: 'listings',
      required: true,
    },
    {
      name: 'decision',
      label: '审核动作',
      type: 'select',
      required: true,
      options: REVIEW_DECISIONS.map((value) => ({
        value,
        label: REVIEW_DECISION_LABELS[value],
      })),
    },
    {
      name: 'taskStatus',
      label: '处理状态',
      type: 'select',
      options: REVIEW_TASK_STATUSES.map((value) => ({
        value,
        label: REVIEW_TASK_STATUS_LABELS[value],
      })),
      admin: {
        readOnly: true,
        description: '由审核动作单一推导，不可外部指定。',
      },
    },
    {
      name: 'reason',
      label: '原因',
      type: 'textarea',
      admin: {
        description: '驳回、下架必填；其余动作可选。',
      },
    },
    {
      name: 'snapshot',
      label: '提交快照',
      type: 'json',
      admin: {
        readOnly: true,
        description: '提交时冻结的房源核心字段快照（不可变）。',
      },
    },
    {
      name: 'snapshotHash',
      label: '快照哈希',
      type: 'text',
      admin: {
        readOnly: true,
        description: '服务端对快照重算的 SHA-256，用于校验一致性。',
      },
    },
    {
      name: 'submittedBy',
      label: '提交人',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'reviewedBy',
      label: '审核人',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'submittedAt',
      label: '提交时间',
      type: 'date',
    },
    {
      name: 'reviewedAt',
      label: '审核时间',
      type: 'date',
    },
    {
      name: 'listingVersion',
      label: '房源版本',
      type: 'number',
      admin: {
        readOnly: true,
        description: '提交时锁定的房源工作版本号。',
      },
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '记录自身版本（append-only，恒为 1）。',
      },
    },
  ],
}
