import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getLeadMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@/domain/crm/lead-stage'
import { OWNERSHIP_STATUSES, OWNERSHIP_STATUS_LABELS } from '@/domain/crm/ownership'
import { leadReadAccess } from '@/domain/crm/lead-read-access'
import { fillEntrustLeadName } from '@/domain/inquiry/entrust-name-fallback'
import {
  SOURCE_SECTIONS,
  SOURCE_SECTION_LABELS,
  SUPPLY_GROUPS,
  SUPPLY_GROUP_LABELS,
} from '@/domain/inquiry/schema'

/**
 * F5 前台咨询表单来源页面类型（FP-05 §2 入口）
 *
 * - home：首页"获取选址方案" / 收束咨询模块
 * - search：房源列表无结果"提交需求"
 * - listing：房源详情"询价 / 预约看房"
 * - building：楼盘详情"咨询该楼盘"
 * - content：内容页文末 CTA
 * - entrust：委托找房落地页零门槛留电（只采集手机号）
 */
export const INQUIRY_SOURCE_PAGE_TYPES = [
  'home',
  'search',
  'listing',
  'building',
  'content',
  'entrust',
] as const
export type InquirySourcePageType = (typeof INQUIRY_SOURCE_PAGE_TYPES)[number]

/** 入口页面类型中文标签（用于后台展示） */
export const INQUIRY_SOURCE_PAGE_TYPE_LABELS: Record<InquirySourcePageType, string> = {
  home: '首页',
  search: '搜索页',
  listing: '房源详情页',
  building: '楼盘详情页',
  content: '内容页',
  entrust: '委托找房页',
}

/**
 * F5 询盘目标对象类型（FP-05 §2 入口必须携带目标房源/楼盘）
 *
 * - listing：带 listingSlug 的具体房源咨询
 * - building：带 buildingSlug 的楼盘咨询
 * - none：通用选址需求（房源失效转通用或无目标入口）
 */
export const INQUIRY_TARGET_TYPES = ['listing', 'building', 'none'] as const
export type InquiryTargetType = (typeof INQUIRY_TARGET_TYPES)[number]

/** 目标对象类型中文标签（用于后台展示） */
export const INQUIRY_TARGET_TYPE_LABELS: Record<InquiryTargetType, string> = {
  listing: '房源',
  building: '楼盘',
  none: '无目标',
}

export const Leads: CollectionConfig = {
  slug: 'leads',
  labels: {
    singular: '线索',
    plural: '咨询线索',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: [
      'name',
      'phone',
      'company',
      'stage',
      'ownershipStatus',
      'sourcePageType',
      'targetType',
      'createdAt',
    ],
    components: {
      edit: {
        beforeDocumentControls: [
          '/components/admin/LeadOwnershipHistoryLink',
        ],
      },
    },
  },
  access: {
    read: leadReadAccess,
  },
  trash: true,
  hooks: {
    // 委托找房零门槛渠道：无姓名线索填兜底姓名，早于必填校验。
    beforeValidate: [fillEntrustLeadName],
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
          description: '客户档案关联、线索阶段、归属状态与团队/城市归属。',
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
                  typescriptSchema: [({ jsonSchema }) => ({
                    anyOf: [jsonSchema, { type: 'string' }],
                  })],
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
              // 时间类快照默认展开：跟进时常用参考
              type: 'collapsible',
              label: '时间与渠道快照（只读）',
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
              ],
            },
            {
              // 策略参数快照低频查看：默认折叠
              type: 'collapsible',
              label: '分配策略快照（只读，低频）',
              admin: { initCollapsed: true },
              fields: [
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
                  },
                },
              ],
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
        {
          label: '前台询盘上下文',
          description: '咨询表单自动采集的来源与目标信息，后台只读。',
          fields: [
            {
              // 排查“线索从哪来”时才需要：默认折叠
              type: 'collapsible',
              label: '入口与目标（只读）',
              admin: { initCollapsed: true },
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'idempotencyKey',
                      label: '防重标识',
                      type: 'text',
                      unique: true,
                      index: true,
                      admin: {
                        readOnly: true,
                        description: '系统自动生成的防重标识，重复提交只会创建一条线索。',
                      },
                    },
                    {
                      name: 'sourcePageType',
                      label: '入口页面类型',
                      type: 'select',
                      options: INQUIRY_SOURCE_PAGE_TYPES.map((value) => ({
                        value,
                        label: INQUIRY_SOURCE_PAGE_TYPE_LABELS[value],
                      })),
                      admin: {
                        readOnly: true,
                        description: '前台入口页面类型：home / search / listing / building / content。',
                      },
                    },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'sourcePath',
                      label: '入口路径',
                      type: 'text',
                      admin: {
                        readOnly: true,
                        description: '前台入口相对路径（白名单化，不含查询参数中的个人信息）。',
                      },
                    },
                    {
                      name: 'sourceUrl',
                      label: '入口 URL',
                      type: 'text',
                      admin: {
                        readOnly: true,
                        description: '前台入口完整 URL（仅服务端日志记录，不展示给经纪人）。',
                      },
                    },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'targetType',
                      label: '目标对象类型',
                      type: 'select',
                      options: INQUIRY_TARGET_TYPES.map((value) => ({
                        value,
                        label: INQUIRY_TARGET_TYPE_LABELS[value],
                      })),
                      admin: {
                        readOnly: true,
                        description: 'listing / building / none（通用需求）。',
                      },
                    },
                    {
                      name: 'targetListingSlug',
                      label: '目标房源 slug',
                      type: 'text',
                      admin: {
                        readOnly: true,
                        description: '前台传入的房源 slug；校验有效后写入。',
                      },
                    },
                  ],
                },
                {
                  name: 'targetBuildingSlug',
                  label: '目标楼盘 slug',
                  type: 'text',
                  admin: {
                    readOnly: true,
                    description: '前台传入的楼盘 slug。',
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'sourceSection',
                      label: '详情页入口区块',
                      type: 'select',
                      options: SOURCE_SECTIONS.map((value) => ({
                        value,
                        label: SOURCE_SECTION_LABELS[value],
                      })),
                      admin: {
                        readOnly: true,
                        description: '仅保存白名单化的详情页入口区块；不保存任意前台文案。',
                      },
                    },
                    {
                      name: 'activeSupplyGroup',
                      label: '当前供给分组',
                      type: 'select',
                      options: SUPPLY_GROUPS.map((value) => ({
                        value,
                        label: SUPPLY_GROUP_LABELS[value],
                      })),
                      admin: {
                        readOnly: true,
                        description: '提交时页面当前的供给分组，仅接受 lease / sale / coworking。',
                      },
                    },
                  ],
                },
              ],
            },
            {
              // 提交时快照低频查看：默认折叠
              type: 'collapsible',
              label: '提交时筛选与价格快照（只读）',
              admin: { initCollapsed: true },
              fields: [
                {
                  name: 'currentFilters',
                  label: '当前供给筛选',
                  type: 'json',
                  admin: {
                    readOnly: true,
                    description: '仅保存系统允许的选项值。',
                  },
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'priceSnapshot',
                      label: '提交时价格快照',
                      type: 'json',
                      admin: {
                        readOnly: true,
                        description: '非权威来源快照，仅供跟进参考，不参与公开价格或排序。',
                      },
                    },
                    {
                      name: 'priceSnapshotSubmittedAt',
                      label: '价格快照提交时间',
                      type: 'date',
                      admin: {
                        readOnly: true,
                        date: { pickerAppearance: 'dayAndTime' },
                      },
                    },
                  ],
                },
              ],
            },
            {
              // 合规与追踪仅投诉/审计场景需要：默认折叠
              type: 'collapsible',
              label: '合规与追踪（只读）',
              admin: { initCollapsed: true },
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'consentAccepted',
                      label: '隐私同意已勾选',
                      type: 'checkbox',
                      defaultValue: false,
                      admin: {
                        readOnly: true,
                        description: '用户必须主动勾选，未勾选不得提交。',
                      },
                    },
                    {
                      name: 'consentPolicyVersion',
                      label: '隐私政策版本',
                      type: 'text',
                      admin: {
                        readOnly: true,
                        description: '同意时的隐私政策版本号（PRIVACY_POLICY_VERSION）。',
                      },
                    },
                  ],
                },
                {
                  name: 'campaign',
                  label: '活动归因',
                  type: 'json',
                  admin: {
                    readOnly: true,
                    description: '营销来源参数（utm_source 等），各键值长度 ≤ 100。',
                  },
                },
                {
                  name: 'requestId',
                  label: '请求 ID',
                  type: 'text',
                  admin: {
                    readOnly: true,
                    description: '前台生成的请求唯一标识，用于日志关联与防重。',
                  },
                },
                {
                  // P2 Task 4：偏好看房时段。status 恒为 pending-confirmation；
                  // P2 不建实时日历锁位，顾问在后台确认后另行流转。
                  name: 'viewingPreference',
                  label: '偏好看房时段（待顾问确认）',
                  type: 'group',
                  admin: {
                    readOnly: true,
                    description:
                      '用户在询盘时选择的偏好看房时段，服务端已复核落在平台服务时间内。始终为“待顾问确认”，不代表已确认预约。',
                  },
                  fields: [
                    {
                      type: 'row',
                      fields: [
                        { name: 'startsAt', label: '开始时间', type: 'date', admin: { readOnly: true } },
                        { name: 'endsAt', label: '结束时间', type: 'date', admin: { readOnly: true } },
                        { name: 'timezone', label: '时区', type: 'text', admin: { readOnly: true } },
                        {
                          name: 'status',
                          label: '状态',
                          type: 'select',
                          options: [{ label: '待顾问确认', value: 'pending-confirmation' }],
                          admin: { readOnly: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
