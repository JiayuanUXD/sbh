import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getLeadMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@/domain/crm/lead-stage'
import { OWNERSHIP_STATUSES, OWNERSHIP_STATUS_LABELS } from '@/domain/crm/ownership'

export const Leads: CollectionConfig = {
  slug: 'leads',
  labels: {
    singular: '线索',
    plural: '咨询线索',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'company', 'budget', 'status', 'createdAt'],
  },
  trash: true,
  hooks: {
    // 字段脱敏（tasks.md M1.4）：缺 phone:full 权限 → 返回 138****1111
    // 业务不变量：经纪人只能看自己负责线索的完整手机号（M5 进一步收窄）
    afterRead: createFieldMaskHooks(getLeadMaskRules()),
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '客户信息',
          description: '记录联系人、公司以及当前跟进状态。',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'name', label: '姓名', type: 'text', required: true },
                {
                  name: 'phone',
                  label: '联系电话',
                  type: 'text',
                  required: true,
                  admin: { placeholder: '例如：138 0000 0000' },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'company', label: '公司', type: 'text' },
                {
                  name: 'status',
                  label: '跟进状态',
                  type: 'select',
                  defaultValue: 'new',
                  options: [
                    { label: '新线索', value: 'new' },
                    { label: '已联系', value: 'contacted' },
                    { label: '已看房', value: 'visited' },
                    { label: '已成交', value: 'won' },
                    { label: '无效', value: 'lost' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'source',
                  label: '线索来源',
                  type: 'select',
                  defaultValue: 'frontend-form',
                  options: [
                    { label: '前台表单', value: 'frontend-form' },
                    { label: '电话', value: 'phone' },
                    { label: '导入', value: 'import' },
                    { label: '其他', value: 'other' },
                  ],
                },
                {
                  name: 'owner',
                  label: '负责经纪人',
                  type: 'relationship',
                  relationTo: 'brokers',
                  admin: {
                    description: '经纪人停用前须先转派名下未完成线索',
                  },
                },
              ],
            },
          ],
        },
        {
          label: '租赁需求',
          description: '记录客户关注的区域、预算、面积和房源。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'district',
                  label: '意向区域',
                  type: 'relationship',
                  relationTo: 'locations',
                  // M2.2：意向区域取行政层级（城市/行政区/商圈），仅启用节点进候选
                  filterOptions: () =>
                    activeLocationFilter(['city', 'district', 'business_area']),
                },
                { name: 'budget', label: '预算', type: 'text' },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'area', label: '需求面积', type: 'text' },
                { name: 'moveInTime', label: '入驻时间', type: 'text' },
              ],
            },
            {
              name: 'interestedListing',
              label: '意向房源',
              type: 'relationship',
              relationTo: 'listings',
            },
          ],
        },
        {
          label: '归属与阶段',
          description: '客户档案关联、线索阶段、归属状态与团队/城市归属（M5 / design §3.6）。',
          fields: [
            {
              name: 'customer',
              label: '客户档案',
              type: 'relationship',
              relationTo: 'customers',
              admin: {
                description: '按手机号查重后关联的客户档案（一个客户可关联多条线索）。',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'stage',
                  label: '线索阶段',
                  type: 'select',
                  options: LEAD_STAGES.map((value) => ({
                    value,
                    label: LEAD_STAGE_LABELS[value],
                  })),
                  admin: {
                    description: '由阶段状态机服务端流转，无法确定映射时进入人工复核。',
                  },
                },
                {
                  name: 'ownershipStatus',
                  label: '归属状态',
                  type: 'select',
                  options: OWNERSHIP_STATUSES.map((value) => ({
                    value,
                    label: OWNERSHIP_STATUS_LABELS[value],
                  })),
                  admin: {
                    readOnly: true,
                    description: '由分配/认领/转派/进入公海/回收动作单一推导。',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'team',
                  label: '归属团队',
                  type: 'relationship',
                  relationTo: 'teams',
                },
                {
                  name: 'city',
                  label: '归属城市',
                  type: 'relationship',
                  relationTo: 'locations',
                  filterOptions: () => activeLocationFilter(['city']),
                },
              ],
            },
          ],
        },
        {
          label: '结构化需求',
          description: '面积/预算/席位/入驻等结构化字段，供匹配与统一有效供给推荐。',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'areaMin', label: '面积下限(㎡)', type: 'number' },
                { name: 'areaMax', label: '面积上限(㎡)', type: 'number' },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'budgetMin', label: '预算下限', type: 'number' },
                { name: 'budgetMax', label: '预算上限', type: 'number' },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'currency',
                  label: '币种',
                  type: 'select',
                  defaultValue: 'CNY',
                  options: [
                    { label: '人民币', value: 'CNY' },
                    { label: '美元', value: 'USD' },
                    { label: '港币', value: 'HKD' },
                  ],
                },
                {
                  name: 'billingPeriod',
                  label: '计价周期',
                  type: 'select',
                  options: [
                    { label: '每月', value: 'month' },
                    { label: '每日每平米', value: 'day_sqm' },
                    { label: '每年', value: 'year' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'seatCount', label: '席位数', type: 'number' },
                { name: 'leaseMonths', label: '租期(月)', type: 'number' },
              ],
            },
            {
              name: 'moveInDate',
              label: '期望入驻日期',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayOnly' } },
            },
            {
              name: 'specialRequirements',
              label: '特殊需求',
              type: 'textarea',
            },
          ],
        },
        {
          label: 'SLA 与快照',
          description: '有效创建时间、跟进时刻与分配/认领时快照的运行时策略（不回写）。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'effectiveCreatedAt',
                  label: '有效创建时间',
                  type: 'date',
                  admin: {
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                    description: '查重合并后保留的有效创建时刻，SLA 与分析以此为准。',
                  },
                },
                {
                  name: 'effectiveSourceChannel',
                  label: '有效来源渠道',
                  type: 'text',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              name: 'sourceChannel',
              label: '来源渠道',
              type: 'text',
              admin: {
                description: '原始来源渠道（与 source 并存，后者为旧枚举兼容字段）。',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'firstValidFollowUpAt',
                  label: '首次有效跟进时间',
                  type: 'date',
                  admin: {
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
                {
                  name: 'lastValidFollowUpAt',
                  label: '最后有效跟进时间',
                  type: 'date',
                  admin: {
                    readOnly: true,
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
              ],
            },
            {
              name: 'nextFollowUpAt',
              label: '下次跟进时间',
              type: 'date',
              admin: {
                readOnly: true,
                date: { pickerAppearance: 'dayAndTime' },
                description: '由跟进服务写入，供 SLA 与待办排序。',
              },
            },
            {
              name: 'runtimePolicyVersion',
              label: '运行时策略版本',
              type: 'text',
              admin: {
                readOnly: true,
                description: '分配/认领成功时快照，参数调整不回写既有线索。',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'firstFollowUpSlaSeconds',
                  label: '首次跟进 SLA(秒)',
                  type: 'number',
                  admin: { readOnly: true },
                },
                {
                  name: 'publicPoolRecycleSeconds',
                  label: '公海回收阈值(秒)',
                  type: 'number',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'claimProtectionSeconds',
                  label: '认领保护期(秒)',
                  type: 'number',
                  admin: { readOnly: true },
                },
                {
                  name: 'dailyClaimLimit',
                  label: '每日认领上限',
                  type: 'number',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              name: 'activeLeadCap',
              label: '活跃线索上限',
              type: 'number',
              admin: { readOnly: true },
            },
            {
              name: 'version',
              label: '版本号',
              type: 'number',
              defaultValue: 1,
              admin: {
                readOnly: true,
                description: '乐观锁版本号，阶段流转/归属变更时递增（服务端维护）。',
              },
            },
          ],
        },
        {
          label: '跟进记录',
          description: '补充沟通纪要、看房反馈和下一步安排。',
          fields: [
            {
              name: 'notes',
              label: '跟进记录',
              type: 'textarea',
              admin: { rows: 12 },
            },
          ],
        },
      ],
    },
  ],
}
