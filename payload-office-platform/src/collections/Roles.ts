import type { CollectionConfig } from 'payload'
import { getPermissionContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { validatePermissionCodes } from '@/domain/auth/permission-codes'
import { protectBuiltinRole } from '@/domain/auth/role-protect'

/**
 * 角色 Collection（tasks.md M1.2, design.md §3.1）
 *
 * 业务不变量（AGENTS.md §6）：
 *   - 内置角色固定 5 个：ADM / OPS / MGR / BRK / CSR
 *   - 不得创建第六种内置角色，也不得删除或改码这五种角色
 *   - 内置角色 is_builtin=true，禁止删除、改码、改 builtin 标记
 *   - 自定义角色可创建/复制/编辑，但不得改变内置角色身份
 *
 * 权限结果（design.md §3.1）：
 *   - 菜单、操作、字段权限采用允许并集
 *   - 数据范围采用业务域允许集合并集
 *   - 账号城市绑定作为最终上限，不允许角色扩大
 *
 * 注：roles 字段值数组在 Collection 层用 array；运行期由 PermissionContext 转换为 Set。
 */
export const Roles: CollectionConfig = {
  slug: 'roles',
  labels: {
    singular: '角色',
    plural: '角色管理',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'isBuiltin', 'status', 'dataScope', 'updatedAt'],
    group: '账号与权限',
    description: '内置角色不可删除或改码；自定义角色可编辑菜单/操作/数据/字段四层权限。',
    // 编辑页：
    //   - 顶部：复制角色按钮（基于当前角色创建自定义副本）
    //   - 顶部：自定义角色风险提示（通配符 / global 数据范围）
    // Payload admin.components.edit 仅支持 beforeDocumentControls（顶部）/ editMenuItems（三点菜单）
    // 及若干按钮替换槽；不存在底部槽，两个组件都放顶部
    components: {
      edit: {
        beforeDocumentControls: [
          {
            path: '/components/admin/CopyRoleButton',
          },
          {
            path: '/components/admin/RoleRiskWarning',
          },
        ],
      },
    },
  },
  // 禁用 trash：内置角色不应进入回收站
  trash: false,
  fields: [
    {
      name: 'code',
      label: '角色编码',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description:
          '不可变机器码。内置角色为 ADM/OPS/MGR/BRK/CSR；自定义角色使用大写字母加下划线。',
      },
      // 仅做格式校验。内置角色改码 / 移除 builtin 标记的拦截在 beforeChange
      // （protectBuiltinRole）——那里能拿到 originalDoc 的真实原值做比对；
      // validate 的 options.data.code 与 val 是同一字段新值，无法比对原值（P2-5 删除死分支）。
      validate: (val: unknown) => {
        if (!val || typeof val !== 'string') return '角色编码必填'
        if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(val)) {
          return '角色编码必须以大写字母开头，仅含大写字母/数字/下划线，长度 2-32'
        }
        return true
      },
    },
    {
      name: 'name',
      label: '角色名称',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      label: '描述',
      type: 'textarea',
      admin: { rows: 3 },
    },
    {
      name: 'isBuiltin',
      label: '是否内置角色',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: '内置角色不可删除、改码或改变 builtin 标记。',
        // 内置标记在编辑页只读，避免误改
        readOnly: true,
        condition: (data) => data?.isBuiltin === true,
      },
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      defaultValue: 'active',
      required: true,
      options: [
        { label: '启用', value: 'active' },
        { label: '停用', value: 'inactive' },
      ],
    },
    {
      name: 'dataScope',
      label: '数据范围',
      type: 'select',
      defaultValue: 'self',
      required: true,
      options: [
        { label: '全局', value: 'global' },
        { label: '按城市', value: 'city' },
        { label: '按团队', value: 'team' },
        { label: '仅本人', value: 'self' },
        { label: '无权限', value: 'none' },
      ],
      admin: {
        description: '数据范围上限；账号城市绑定作为最终上限，不允许角色扩大。',
      },
    },
    {
      name: 'menuPermissions',
      label: '菜单权限',
      type: 'json',
      admin: {
        description: '菜单权限编码数组（允许并集）；通配符 * 表示全部菜单。',
      },
      // beforeChange 兜底校验：编码必须在注册表中
      validate: (val: unknown) => {
        const result = validatePermissionCodes({ codes: val, type: 'menu' })
        if (!result.ok) {
          return `菜单权限编码未注册：${result.invalid.join(', ')}`
        }
        return true
      },
    },
    {
      name: 'operationPermissions',
      label: '操作权限',
      type: 'json',
      admin: {
        description: '操作权限编码数组（允许并集）；通配符 * 表示全部操作。',
      },
      validate: (val: unknown) => {
        const result = validatePermissionCodes({ codes: val, type: 'operation' })
        if (!result.ok) {
          return `操作权限编码未注册：${result.invalid.join(', ')}`
        }
        return true
      },
    },
    {
      name: 'fieldPermissions',
      label: '字段权限',
      type: 'json',
      admin: {
        description:
          '字段权限编码数组（允许并集）。phone:full 看完整手机号；phone:masked 仅看脱敏值；audit:before_after 看审计前后值。',
      },
      validate: (val: unknown) => {
        const result = validatePermissionCodes({ codes: val, type: 'field' })
        if (!result.ok) {
          return `字段权限编码未注册：${result.invalid.join(', ')}`
        }
        return true
      },
    },
  ],
  // M1.5 收紧：读取开放给登录用户（菜单/权限预览需要）；
  // 增删改必须具备 role:manage 操作权限（仅 ADM 默认拥有）
  //
  // P1-4 收紧 read：
  //   - 具备 role:manage 或 user:manage 者可读全部角色
  //   - 否则仅可读自己持有的角色（Where 约束，堵住枚举、保留自读 profile 时 roles populate）
  access: {
    read: async ({ req }) => {
      if (!req.user) return false
      const ctx = await getPermissionContext(req)
      if (
        ctx &&
        (hasOperationPermission(ctx, 'role:manage') ||
          hasOperationPermission(ctx, 'user:manage'))
      ) {
        return true
      }
      // 归一化自身持有的角色 ID（req.user.roles 可能是 ID 数组或文档数组）
      const rawRoles = (req.user as { roles?: unknown }).roles
      const ownRoleIds = Array.isArray(rawRoles)
        ? rawRoles
            .map((r) =>
              typeof r === 'number' || typeof r === 'string'
                ? r
                : r && typeof r === 'object' && 'id' in r
                  ? (r as { id: number | string }).id
                  : undefined,
            )
            .filter((v): v is number | string => v !== undefined)
        : []
      if (ownRoleIds.length === 0) return false
      return { id: { in: ownRoleIds } }
    },
    create: async ({ req }) => {
      if (!req.user) return false
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'role:manage')
    },
    update: async ({ req }) => {
      if (!req.user) return false
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'role:manage')
    },
    delete: async ({ req }) => {
      if (!req.user) return false
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'role:manage')
    },
  },
  hooks: {
    // 阻止删除内置角色：在 beforeDelete hook 中通过 req.payload 读取 isBuiltin
    beforeDelete: [
      async ({ id, req }) => {
        if (id === undefined || id === null) return
        const role = await req.payload.findByID({
          collection: 'roles',
          id: id as number | string,
          depth: 0,
          overrideAccess: true,
        })
        if (role?.isBuiltin === true) {
          throw new Error(`内置角色不可删除：${role.code ?? ''}`)
        }
      },
    ],
    beforeChange: [
      // 内置角色身份保护：create 时禁止伪造第六种内置角色；update 时禁止改码 / 移除 builtin 标记
      protectBuiltinRole,
    ],
  },
}
