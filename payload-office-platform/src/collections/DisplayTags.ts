import type { CollectionConfig } from 'payload'
import {
  DISPLAY_TAG_STATUSES,
  DISPLAY_TAG_STATUS_LABELS,
} from '@/domain/dictionary/display-tag'
import { protectDisplayTag } from '@/domain/dictionary/display-tag-protect'

/**
 * 可维护展示标签集合（tasks.md M2.6 Part B / Requirement R2）
 *
 * 与只读枚举发布基线（domain/dictionary/enum-registry.ts）正交：展示标签支持
 * 后台新增/改名/排序/可见性/停用。业务对象引用标签时保存**编码 + 历史显示快照**
 * （见 display-tag.ts 的 snapshotTag），改名不影响历史记录展示。
 *
 * 当前暂无消费字段，作为通用能力先就位；M3/M4 再挂接到具体业务对象。
 * admin.hidden=true：注册但暂不进后台导航。
 */
export const DisplayTags: CollectionConfig = {
  slug: 'display-tags',
  labels: {
    singular: '展示标签',
    plural: '展示标签',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'sortOrder', 'visible', 'status'],
    // 暂不进导航：字典能力先就位，待 M3/M4 挂接消费字段后再放出
    hidden: true,
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectDisplayTag],
  },
  fields: [
    {
      name: 'code',
      label: '标签编码',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: '稳定引用键，创建后不可更改；字母开头，仅含字母/数字/下划线/连字符',
      },
    },
    {
      name: 'name',
      label: '显示名',
      type: 'text',
      required: true,
      admin: {
        description: '可改名，历史记录展示由业务对象快照冻结，不受改名影响',
      },
    },
    {
      name: 'sortOrder',
      label: '排序',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: '数值越小越靠前',
      },
    },
    {
      name: 'visible',
      label: '可见',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      defaultValue: 'active',
      options: DISPLAY_TAG_STATUSES.map((value) => ({
        value,
        label: DISPLAY_TAG_STATUS_LABELS[value],
      })),
    },
    {
      name: 'version',
      label: '版本',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本号,系统维护',
      },
    },
  ],
}
