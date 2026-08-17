import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getSupplySubmissionMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import {
  SUBMISSION_PRICE_UNIT_LABELS,
  SUBMISSION_PRICE_UNITS,
} from '@/domain/supply-submission/schema'
import { enqueueSupplySubmissionCreated } from '@/domain/supply-submission/submission-notify'
import { protectSupplySubmission } from '@/domain/supply-submission/submission-protect'
import {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  FITOUT_STATUS_LABELS,
  FITOUT_STATUSES,
  LEASE_MODE_LABELS,
  LEASE_MODES,
  SUBMITTER_ROLE_LABELS,
  SUBMITTER_ROLES,
  SUPPLY_LIMITS,
  SUPPLY_SUBMISSION_STATUS_LABELS,
  SUPPLY_SUBMISSION_STATUSES,
} from '@/domain/supply-submission/schema'

/**
 * 价格单位中文标签。
 *
 * 用业主提交专用的 `SUBMISSION_PRICE_UNITS`（4 值）而非前台展示单位全集（12 值）：
 * 本字段入库到 `enum_supply_submissions_rent_unit`，下拉里多一个 ENUM 外的选项就是
 * 一条保存必失败的路径。
 */
const PRICE_UNIT_LABELS = SUBMISSION_PRICE_UNIT_LABELS

/**
 * 房源投放申请（委托找房/投放房源 PRD §5.3）
 *
 * 业务不变量：
 *   - 提交事实字段 append-only：创建后不可改（protect hook 兜底）、不可删除（access.delete=false）；
 *   - 前台只能写 6 个提交字段 + 溯源/同意；后台补录字段与流程字段外部不可写；
 *   - 幂等键唯一索引兜底：同 requestId + 手机号 + 楼盘名只留一条；
 *   - 审单动作（转房源草稿 / 拒绝）由后台 supply_submission:manage / :convert 操作。
 *
 * 权限：
 *   - read：supply_submission:read
 *   - create：Collection 边界关闭；公开提交仅走专用 Next route
 *   - update：supply_submission:manage
 *   - delete：禁止（审计轨迹）
 */
export const SupplySubmissions: CollectionConfig = {
  slug: 'supply-submissions',
  labels: {
    singular: '投放申请',
    plural: '房源投放申请',
  },
  admin: {
    group: false,
    useAsTitle: 'buildingName',
    defaultColumns: [
      'buildingName',
      'address',
      'areaSqm',
      'rentAmount',
      'commissionMonths',
      'status',
      'createdAt',
    ],
    description:
      '业主/物业/中介从 /publish 提交的房源投放申请。提交事实不可改、不可删；status 由后台流转，可转为房源草稿。',
  },
  access: {
    ...createCollectionAccess({
      read: 'supply_submission:read',
      update: 'supply_submission:manage',
    }),
    // Collection 创建边界关闭：公开提交仅走专用端点的 schema / 同源 / 限流守卫。
    // Public writes must pass the dedicated hardened Next route, which uses
    // Local API overrideAccess deliberately after validation and rate limiting.
    create: () => false,
    // 只追加：禁止删除（审计轨迹）
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectSupplySubmission],
    afterChange: [enqueueSupplySubmissionCreated],
    // 字段脱敏：缺 phone:full 权限 → contactPhone 返回 138****1111。
    // 与 Leads 的 afterRead 口径一致；房东联系手机号不因集合不同而失去保护。
    afterRead: createFieldMaskHooks(getSupplySubmissionMaskRules()),
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '提交内容',
          description: '前台 /publish 提交的房源信息，创建后不可修改。',
          fields: [
            {
              name: 'buildingName',
              label: '楼盘名称',
              type: 'text',
              required: true,
              index: true,
              maxLength: SUPPLY_LIMITS.BUILDING_NAME_MAX,
            },
            {
              name: 'address',
              label: '详细地址',
              type: 'text',
              required: true,
              maxLength: SUPPLY_LIMITS.ADDRESS_MAX,
              admin: { description: '楼号/单元号/房间号。' },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'areaSqm',
                  label: '出租面积(㎡)',
                  type: 'number',
                  required: true,
                  min: 0,
                },
                {
                  name: 'commissionMonths',
                  label: '佣金悬赏',
                  type: 'select',
                  required: true,
                  defaultValue: 'none',
                  index: true,
                  options: COMMISSION_MONTHS.map((value) => ({
                    value,
                    label: COMMISSION_MONTHS_LABELS[value],
                  })),
                  admin: { description: '业主愿意悬赏的佣金月数，成交后支付。有悬赏的申请优先处理。' },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'rentAmount', label: '期望租金', type: 'number', min: 0 },
                {
                  name: 'rentUnit',
                  label: '租金单位',
                  type: 'select',
                  options: SUBMISSION_PRICE_UNITS.map((value) => ({
                    value,
                    label: PRICE_UNIT_LABELS[value],
                  })),
                },
              ],
            },
            {
              name: 'contactPhone',
              label: '联系手机号',
              type: 'text',
              required: true,
              index: true,
            },
          ],
        },
        {
          label: '审单与补录',
          description: '顾问电话确认后补录的信息，以及审单流程字段。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'status',
                  label: '处理状态',
                  type: 'select',
                  required: true,
                  defaultValue: 'pending',
                  index: true,
                  options: SUPPLY_SUBMISSION_STATUSES.map((value) => ({
                    value,
                    label: SUPPLY_SUBMISSION_STATUS_LABELS[value],
                  })),
                },
                {
                  name: 'assignee',
                  label: '跟进人',
                  type: 'relationship',
                  relationTo: 'users',
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'contactName', label: '联系人', type: 'text', maxLength: 50 },
                { name: 'companyName', label: '公司名称', type: 'text', maxLength: 100 },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'submitterRole',
                  label: '提交人身份',
                  type: 'select',
                  options: SUBMITTER_ROLES.map((value) => ({
                    value,
                    label: SUBMITTER_ROLE_LABELS[value],
                  })),
                },
                {
                  name: 'leaseMode',
                  label: '出租方式',
                  type: 'select',
                  options: LEASE_MODES.map((value) => ({
                    value,
                    label: LEASE_MODE_LABELS[value],
                  })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'fitoutStatus',
                  label: '装修状况',
                  type: 'select',
                  options: FITOUT_STATUSES.map((value) => ({
                    value,
                    label: FITOUT_STATUS_LABELS[value],
                  })),
                },
                {
                  name: 'availableFrom',
                  label: '可入驻时间',
                  type: 'date',
                  admin: { date: { pickerAppearance: 'dayOnly' } },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'city',
                  label: '城市',
                  type: 'relationship',
                  relationTo: 'locations',
                  typescriptSchema: [({ jsonSchema }) => ({
                    anyOf: [jsonSchema, { type: 'string' }],
                  })],
                  filterOptions: () => activeLocationFilter(['city']),
                },
                {
                  name: 'district',
                  label: '区域/商圈',
                  type: 'relationship',
                  relationTo: 'locations',
                },
              ],
            },
            { name: 'description', label: '房源补充说明', type: 'textarea', maxLength: 1000 },
            { name: 'reviewNote', label: '审核备注 / 拒绝原因', type: 'textarea' },
            {
              type: 'row',
              fields: [
                {
                  name: 'matchedBuilding',
                  label: '匹配到的楼盘',
                  type: 'relationship',
                  relationTo: 'buildings',
                },
                {
                  name: 'convertedListing',
                  label: '转出的房源',
                  type: 'relationship',
                  relationTo: 'listings',
                },
              ],
            },
            {
              name: 'handledAt',
              label: '处理时间',
              type: 'date',
              admin: { readOnly: true, description: '状态流转到终态时自动写入。' },
            },
          ],
        },
        {
          label: '溯源与合规',
          description: '服务端写入，前台不可指定，后台只读。',
          fields: [
            {
              name: 'requestId',
              label: '请求 ID',
              type: 'text',
              required: true,
              maxLength: SUPPLY_LIMITS.REQUEST_ID_MAX,
              admin: { readOnly: true },
            },
            {
              name: 'idempotencyKey',
              label: '幂等键',
              type: 'text',
              required: true,
              unique: true,
              index: true,
              admin: {
                readOnly: true,
                description: 'requestId + 标准化手机号 + 楼盘名 的哈希。唯一约束防并发重复。',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'sourcePath',
                  label: '入口路径',
                  type: 'text',
                  admin: { readOnly: true, description: '同源 pathname，不含查询参数。' },
                },
                {
                  name: 'sourceUrl',
                  label: '入口 URL',
                  type: 'text',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'consentAccepted',
                  label: '已同意隐私政策',
                  type: 'checkbox',
                  admin: { readOnly: true },
                },
                {
                  name: 'consentPolicyVersion',
                  label: '同意的政策版本',
                  type: 'text',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              name: 'submitterIpHash',
              label: '提交 IP 哈希',
              type: 'text',
              admin: { readOnly: true, description: '反垃圾用，不存原始 IP。' },
            },
          ],
        },
      ],
    },
  ],
}
