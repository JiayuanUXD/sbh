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
 * admin.group=false：退出 Payload 默认导航，由自定义导航按权限承载。
 */
export const DisplayTags: CollectionConfig = {
  slug: 'display-tags',
  labels: {
    singular: '展示标签',
    plural: '展示标签',
  },
  admin: {
    // OPT-049：group:false 让本集合退出 Payload 原生导航（3.86 的 groupNavItems
    // 对 group===false 直接跳过），同时保留直达路由。
    //
    // **刻意不进自定义导航**：本集合的头注释写着「当前暂无消费字段，作为通用能力
    // 先就位；M3/M4 再挂接到具体业务对象」——给一个还没有任何业务在用的能力加
    // 导航入口，只会让运营点进去看到一个不知道拿来干什么的空列表。
    // 等它真正被业务消费时再收编。
    //
    // 另外「基础配置」子分组有明确产品意图「只保留配套字典」
    //（见 e2e geography-admin.spec 的用例标题），塞第二个进去是越界。
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'sortOrder', 'visible', 'status'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectDisplayTag],
  },
  fields: [
    {
      type: 'row',
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
      ],
    },
    {
      type: 'row',
      fields: [
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
          },
        },
      ],
    },
  ],
}
