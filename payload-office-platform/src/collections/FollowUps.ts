import type { CollectionConfig } from 'payload'

import { protectFollowUp } from '@/domain/crm/follow-up-protect'
import {
  FOLLOWUP_METHODS,
  FOLLOWUP_METHOD_LABELS,
  FOLLOWUP_RESULTS,
  FOLLOWUP_RESULT_LABELS,
} from '@/domain/crm/follow-up'

/**
 * 跟进记录（tasks.md M5.5 / design §3.6 follow_ups / R6, R8 / M5 验收门）
 *
 * 追加式不可变：一条记录对应一次跟进动作，一经写入即不可修改、不可物理删除，由
 * access.update/delete=false（挡后台 UI + REST）叠加 protectFollowUp（挡 Local API）
 * 双重兜底。"已推荐"（recommended）必须关联统一有效供给中至少一套房源。24 小时纠错
 * 通过追加一条 correctionOf 指向原记录的修正记录实现，记录本身永不 in-place 改。
 */
export const FollowUps: CollectionConfig = {
  slug: 'follow-ups',
  labels: {
    singular: '跟进记录',
    plural: '跟进记录',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'id',
    defaultColumns: ['lead', 'broker', 'method', 'result', 'createdAt'],
    description: '线索跟进流水：记录创建后不可修改或删除，纠错通过追加修正记录实现。',
  },
  access: {
    /**
     * 登录可读、匿名不可读。原为 `read: () => true`，等于把它挂在公开 REST /
     * GraphQL 端点上——业务员与客户的沟通内容一旦录入就对外可读。
     * 该集合在 C 端零引用（只被 payload.config 后台导航、admin 组件与其它后台
     * 集合的关系字段消费），收紧不影响前台。
     */
    read: ({ req }) => Boolean(req.user),
    // append-only：跟进记录不可修改、不可物理删除（design §3.6）
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectFollowUp],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'lead',
          label: '线索',
          type: 'relationship',
          relationTo: 'leads',
          required: true,
        },
        {
          name: 'broker',
          label: '跟进经纪人',
          type: 'relationship',
          relationTo: 'brokers',
          required: true,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'method',
          label: '跟进方式',
          type: 'select',
          required: true,
          options: FOLLOWUP_METHODS.map((value) => ({
            value,
            label: FOLLOWUP_METHOD_LABELS[value],
          })),
        },
        {
          name: 'result',
          label: '跟进结果',
          type: 'select',
          required: true,
          options: FOLLOWUP_RESULTS.map((value) => ({
            value,
            label: FOLLOWUP_RESULT_LABELS[value],
          })),
        },
      ],
    },
    {
      name: 'content',
      label: '跟进内容',
      type: 'textarea',
      required: true,
      admin: { rows: 6 },
    },
    {
      name: 'relatedListings',
      label: '关联房源',
      type: 'relationship',
      relationTo: 'listings',
      hasMany: true,
      admin: {
        description: '"已推荐"结果必须关联统一有效供给中的至少一套房源。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'nextFollowUpAt',
          label: '下次跟进时间',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
        {
          name: 'correctionOf',
          label: '纠正的原记录',
          type: 'relationship',
          relationTo: 'follow-ups',
          admin: {
            description: '24 小时内纠错时指向被纠正的原跟进记录（追加式，原记录不改）。',
          },
        },
        {
          name: 'version',
          label: '版本号',
          type: 'number',
          defaultValue: 1,
          admin: {
            readOnly: true,
          },
        },
      ],
    },
  ],
}
