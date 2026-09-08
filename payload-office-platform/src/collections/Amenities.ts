import type { CollectionConfig } from 'payload'
import { createMenuAccess } from '@/domain/auth/access'

/**
 * 写侧准入（2026-09-08 收口）
 *
 * 此前只写了 `read`，其余三个动作落到 Payload 3.86 的 `defaultAccess`
 * （判据仅 `Boolean(req.user)`）——任何登录账号都能增删改配套字典。
 *
 * 取承载它的模块菜单码 `dictionaries`（导航「系统管理 → 基础配置 → 配套字典」）。
 * **不用 `dictionary:manage`**：该操作码虽已注册，却没有任何内置角色持有，绑上去
 * 等于只剩 ADM、把运营的字典维护能力砍掉；而 `dictionaries` 菜单码的持有者恰好是
 * ADM 与 OPS。
 *
 * delete 保留：字典项就是要能删的，外键只级联到 `buildings_rels`
 * （删一个配套项 = 把它从楼盘的配套列表里移除），正是期望行为。
 */
const canManageDictionary = createMenuAccess(['dictionaries'])

export const Amenities: CollectionConfig = {
  slug: 'amenities',
  labels: {
    singular: '配套',
    plural: '配套字典',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'category'],
  },
  access: {
    // 读侧维持公开：C 端筛选器要列配套项。
    read: () => true,
    create: canManageDictionary,
    update: canManageDictionary,
    delete: canManageDictionary,
  },
  fields: [
    {
      name: 'name',
      label: '配套名称',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'category',
      label: '分类',
      type: 'select',
      options: [
        { label: '办公服务', value: 'office-service' },
        { label: '空间设施', value: 'space' },
        { label: '楼宇配套', value: 'building' },
        { label: '交通生活', value: 'lifestyle' },
      ],
    },
  ],
}
