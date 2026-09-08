import type { CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { TEAM_STATUS_LABELS, TEAM_STATUSES } from '@/domain/auth/org'
import { protectTeam } from '@/domain/auth/team-protect'
import { createMenuAccess } from '@/domain/auth/access'

const STATUS_OPTIONS = TEAM_STATUSES.map((value) => ({
  label: TEAM_STATUS_LABELS[value],
  value,
}))

/**
 * 写侧准入（2026-09-08 收口）
 *
 * 读侧此前已经收过一轮（见下方注释），但 create/update/delete 三个仍是缺省，
 * 落到 Payload 3.86 的 `defaultAccess`（判据仅 `Boolean(req.user)`）——
 * 任何登录账号都能新建、改写、物理删除团队。
 *
 * 没有 `team:*` 操作码，故取承载它的模块菜单码 `teams`（导航「团队管理」叶子）。
 * 持有者是 ADM 与 MGR，与「谁该维护团队编制」重合。
 */
const canManageTeam = createMenuAccess(['teams'])

export const Teams: CollectionConfig = {
  slug: 'teams',
  labels: {
    singular: '团队',
    plural: '团队管理',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'manager', 'status'],
  },
  access: {
    /**
     * 登录可读、匿名不可读。原为 `read: () => true`，等于把它挂在公开 REST /
     * GraphQL 端点上——团队编制对外可读。
     * 该集合在 C 端零引用（只被 payload.config 后台导航、admin 组件与其它后台
     * 集合的关系字段消费），收紧不影响前台。
     */
    read: ({ req }) => Boolean(req.user),
    create: canManageTeam,
    update: canManageTeam,
    /**
     * 一律禁止物理删除。
     *
     * 三条事实叠在一起才是理由：本仓库 `payload.delete` 恒为硬删；**本表没有任何
     * `beforeDelete` 守卫**，删除完全不做引用检查；全仓库没有任何代码删本表，
     * 关死不夺走在用能力。
     *
     * 产品口径也不是删：`brokers.team_id` 与 `leads.team_id` 的外键都是
     * `ON DELETE SET NULL`，删一个团队会把它名下的经纪人与线索静默变成「无团队」
     * ——而 MGR 的数据范围正是按团队收窄的，等于悄悄改变了谁能看到哪些线索。
     * 团队下线的设计答案是 `status` 停用（`protectTeam` 把关）。
     */
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectTeam],
  },
  fields: [
    {
      name: 'name',
      label: '团队名称',
      type: 'text',
      required: true,
    },
    {
      name: 'manager',
      label: '主管',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: '团队主管账号；主管须具备 MGR 角色属分配/团队管理门禁（M5）',
      },
    },
    {
      name: 'cityScope',
      label: '服务城市范围',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      // 仅启用城市进候选；停用城市不进新增，历史已存值仍展示
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: STATUS_OPTIONS,
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
}
