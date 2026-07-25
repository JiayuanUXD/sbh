import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getLeadMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'

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
