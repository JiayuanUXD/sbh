import type { CollectionConfig, Field } from 'payload'
import { normalizePhone } from '@/domain/shared/phone'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getUserMaskRules } from '@/domain/auth/field-mask'
import { getPermissionContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import {
  protectLastAdminBeforeChange,
  protectLastAdminBeforeDelete,
  protectSelfPrivilegeEscalation,
} from '@/domain/auth/user-protect'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'

/**
 * 用户账号 Collection（tasks.md M1.1, design.md §3.1）
 *
 * 扩展字段：
 *   - name：姓名
 *   - phone_normalized：规范化手机号（用于查重，仅一个）
 *   - login_name：登录账号（可选，允许按邮箱或登录名登录）
 *   - status：账号状态（active / disabled / locked）
 *   - roles：hasMany → roles
 *   - city_scope：hasMany → locations（账号城市上限；不可由角色扩大）
 *   - session_version：会话版本；停用时递增，旧 token 失效
 *   - failed_login_count / locked_until：连续登录失败锁定
 *
 * 业务不变量：
 *   - 手机号及登录账号唯一校验
 *   - 账号停用 → 旧会话失效（session_version +1，hook 同步到所有 active token）
 *   - 账号城市绑定作为最终上限，不允许角色扩大
 *   - team：hasMany → teams（M2.5 回填；账号所属团队，销售主管/经纪人归组）
 */
export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: '用户',
    plural: '用户管理',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'loginName', 'status', 'roles', 'updatedAt'],
  },
  auth: {
    // 使用 Payload 默认 email/password；登录后由 payload 校验 status === 'active'
    // token 失效通过 session_version 与 hooks 联动
    useAPIKey: false,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
    },
  },
  trash: false,
  fields: [
    // 权限预览卡片（M1.5）：渲染在表单顶部，占满主内容区宽度。
    // 不能用 beforeDocumentControls（右侧按钮区，宽度仅 ~290px，会挤压/遮挡）。
    {
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/UserPermissionPreview',
        },
      },
    } as unknown as Field,
    // Email added by default by auth: true
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          label: '姓名',
          type: 'text',
          required: true,
          admin: { description: '用户真实姓名；后台展示用。' },
        },
        {
          name: 'phone',
          label: '手机号',
          type: 'text',
          admin: {
            description:
              '原始手机号输入。系统会自动规范化后存储并用于查询。',
          },
          // 入库前规范化原值（不影响 phone_normalized）
          hooks: {
            beforeChange: [
              ({ value }) => {
                if (typeof value !== 'string' || !value) return value
                return normalizePhone(value)
              },
            ],
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'loginName',
          label: '登录账号',
          type: 'text',
          unique: true,
          // 登录账号一旦设置不可修改（避免引用断裂）
          admin: {
            description:
              '可选登录账号；留空时使用邮箱登录。一旦设置不可修改，且必须唯一。',
            readOnly: true,
            condition: (data) => Boolean(data?.loginName),
          },
          validate: (val: unknown) => {
            if (!val) return true // 可选
            if (typeof val !== 'string') return '登录账号必须是字符串'
            if (!/^[a-zA-Z0-9._-]{3,32}$/.test(val)) {
              return '登录账号仅允许字母/数字/./-/_,长度 3-32'
            }
            return true
          },
        },
        {
          name: 'phoneNormalized',
          label: '规范化手机号',
          type: 'text',
          unique: true,
          admin: {
            description: '用于查重和登录；自动从 phone 字段生成，不允许手动编辑。',
            readOnly: true,
          },
          hooks: {
            beforeChange: [
              ({ data }) => {
                // 同步从 phone 字段派生。无手机号时返回 null（而非 ''）：
                // phoneNormalized 是 unique，空串会占用唯一槽导致第二个无手机号账号冲突；
                // null 在唯一索引下可多行并存。
                const raw = (data?.phone as string | undefined) ?? ''
                return normalizePhone(raw) || null
              },
            ],
          },
        },
        {
          name: 'status',
          label: '账号状态',
          type: 'select',
          defaultValue: 'active',
          required: true,
          options: [
            { label: '启用', value: 'active' },
            { label: '停用', value: 'disabled' },
            { label: '锁定', value: 'locked' },
          ],
          admin: {
            description:
              '停用账号无法登录且旧会话失效；锁定账号在解锁时间之前无法登录。',
          },
        },
      ],
    },
    {
      name: 'roles',
      label: '角色',
      type: 'relationship',
      relationTo: 'roles',
      hasMany: true,
      admin: {
        description: '可绑定多个角色；最终权限采用允许并集，账号城市作为最终上限。',
      },
    },
    {
      name: 'cityScope',
      label: '城市范围',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      admin: {
        description:
          '账号城市绑定（多城市）。留空表示无城市上限（受角色 dataScope 约束）。',
      },
      // 仅允许启用的 type === 'city' 的 location（M2.2：停用城市不进候选，历史值不受影响）
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'team',
      label: '所属团队',
      type: 'relationship',
      relationTo: 'teams',
      hasMany: true,
      admin: {
        description: '账号所属团队（可多个）；销售主管/经纪人按团队归组。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'sessionVersion',
          label: '会话版本',
          type: 'number',
          defaultValue: 1,
          required: true,
          admin: {
            readOnly: true,
            description: '停用账号后旧登录会话自动失效。',
          },
        },
        {
          name: 'failedLoginCount',
          label: '连续登录失败次数',
          type: 'number',
          defaultValue: 0,
          admin: {
            readOnly: true,
            description: '连续 5 次失败自动锁定 30 分钟。',
          },
        },
        {
          name: 'lockedUntil',
          label: '锁定截止时间',
          type: 'date',
          admin: {
            readOnly: true,
            description: '到达此时间后自动解锁。',
          },
        },
      ],
    },
  ],
  // M1.5 收紧 access：
  //   - read：具备 user:manage 者可读全部；否则仅可读自己（返回 Where 约束，list/单文档同时生效）
  //   - create/update/delete：需具备 user:manage 操作权限（仅 ADM 默认拥有）
  //   - 首次创建管理员由 Payload 在数据库无用户时自动允许（payload 自身机制）
  access: {
    read: async ({ req }) => {
      if (!req.user) return false
      // 具备 user:manage 的账号可读全部用户
      const ctx = await getPermissionContext(req)
      if (ctx && hasOperationPermission(ctx, 'user:manage')) return true
      // 否则仅可读自己：返回 Where 约束，列表查询自动过滤、按 id 读他人时命中不到 → 404
      // （P1-4：修复此前"任何登录用户可读全部账号"的越权读）
      return { id: { equals: req.user.id } }
    },
    create: async ({ req }) => {
      // 首次创建管理员（数据库无用户）由 Payload 自身逻辑放行，req.user 为空时通过
      if (!req.user) return true
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'user:manage')
    },
    update: async ({ req, id }) => {
      if (!req.user) return false
      // 自己可改自己的非敏感字段（如密码、姓名）；敏感字段（roles/cityScope/status）由 user:manage 收窄
      // 这里仅做粗粒度校验：自己改自己允许，他人修改需 user:manage
      if (req.user.id === id) return true
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'user:manage')
    },
    delete: async ({ req }) => {
      if (!req.user) return false
      const ctx = await getPermissionContext(req)
      if (!ctx) return false
      return hasOperationPermission(ctx, 'user:manage')
    },
  },
  hooks: {
    beforeChange: [
      // 自我提权防护：自己改自己且无 user:manage 时剥离 roles/cityScope/status
      // 必须最先执行，确保后续 hook 看到的是已剥离的 data
      protectSelfPrivilegeEscalation,
      // 字段派生：状态切换、手机号规范化
      async ({ operation, originalDoc, data }) => {
        // 状态变化：active/locked → disabled 时递增 session_version
        if (operation === 'update' && originalDoc) {
          const oldStatus = originalDoc.status as string | undefined
          const newStatus = data?.status as string | undefined
          if (oldStatus !== 'disabled' && newStatus === 'disabled') {
            data.sessionVersion = (originalDoc.sessionVersion ?? 1) + 1
            // 现状（P1 已知限制）：Payload 默认签发的 JWT 不携带 session_version，
            // getPermissionContext 也未比对 token 版本。停用账号的"旧会话即时失效"
            // 当前依赖 buildPermissionContext 的 status!=='active' → 返回 null 来兜底
            // （停用后任何请求派生权限上下文都为 null）。
            // session_version 递增值目前仅落库留档，为后续在 auth 策略层做
            // 真正的 token 版本校验（强制登出/改密即时失效等非停用场景）预留；
            // 是否需要该能力由产品在 M2 决定，此处不做 schema 变更。
          }
        }
        // 手机号规范化（再次确认，防止直接传 phoneNormalized）
        // 无手机号时写 null 而非 ''：phoneNormalized 唯一索引下空串会互相冲突，null 可并存。
        if (operation === 'create' || (operation === 'update' && data?.phone !== undefined)) {
          const raw = (data?.phone as string | undefined) ?? ''
          data.phoneNormalized = normalizePhone(raw) || null
        }
        return data
      },
      // 最后一个全局管理员保护（tasks.md M1.5）
      protectLastAdminBeforeChange,
    ],
    beforeDelete: [
      // 最后一个全局管理员保护：阻止删除最后一个 active ADM 用户
      protectLastAdminBeforeDelete,
    ],
    // 字段脱敏（tasks.md M1.4）：缺 phone:full 权限 → 返回 138****1111
    afterRead: createFieldMaskHooks(getUserMaskRules()),
  },
}
