import type { DocumentViewServerProps } from 'payload'

import type { Role, User } from '@/payload-types'
import {
  MENU_CODES,
  OPERATION_CODES,
  FIELD_CODES,
} from '@/domain/auth/permission-codes'
import {
  mergeDataScope,
  type DataScope,
  type PermissionContext,
} from '@/domain/auth/permission-context'

/**
 * 用户权限预览组件（tasks.md M1.5）
 *
 * 在用户编辑页顶部展示：
 *   - 绑定角色列表
 *   - 菜单权限并集
 *   - 操作权限并集
 *   - 字段权限并集
 *   - 数据范围上限（最宽）+ 账号城市上限
 *
 * 仅展示，不参与写入；数据来自服务端加载的角色文档。
 *
 * 安全说明：
 *   - 不可信任客户端表单数据；权限预览仅基于服务端 payload.find 加载的角色文档
 *   - 此组件仅展示，不修改任何字段；最终权限仍由 PermissionContext 在请求时派生
 *
 * 注：DocumentViewServerProps 不直接暴露 req；通过 ServerProps.payload 访问 Local API
 */
export default async function UserPermissionPreview({
  doc,
  payload,
}: DocumentViewServerProps) {
  const user = doc as unknown as User
  if (!user || !user.id) return null

  // 加载绑定的角色文档（roles 字段可能是 ID 数组或文档数组）
  const roleIds = (user.roles ?? []).filter(
    (r): r is number => typeof r === 'number',
  )
  const loadedDocs = (user.roles ?? []).filter(
    (r): r is Role => typeof r === 'object' && r !== null && 'id' in r,
  )

  let roles: Role[] = loadedDocs
  if (roleIds.length > 0) {
    const result = await payload.find({
      collection: 'roles',
      where: { id: { in: roleIds } },
      depth: 0,
      overrideAccess: true,
      limit: roleIds.length,
    })
    roles = [...loadedDocs, ...(result.docs as unknown as Role[])]
  }

  // 计算权限并集
  const menuPermissions = new Set<string>()
  const operationPermissions = new Set<string>()
  const fieldPermissions = new Set<string>()
  let dataScope: DataScope = 'none'
  const roleCodes: string[] = []

  for (const role of roles) {
    if (role.status !== 'active') continue
    roleCodes.push(role.code ?? '')
    addAll(menuPermissions, parseArray(role.menuPermissions))
    addAll(operationPermissions, parseArray(role.operationPermissions))
    addAll(fieldPermissions, parseArray(role.fieldPermissions))
    dataScope = mergeDataScope(dataScope, (role.dataScope as DataScope) ?? 'self')
  }

  // 账号城市上限
  const cityScopeRaw = user.cityScope ?? []
  const cityIds: (number | string)[] = []
  for (const c of cityScopeRaw) {
    if (typeof c === 'number' || typeof c === 'string') cityIds.push(c)
    else if (c && typeof c === 'object' && 'id' in c) cityIds.push((c as { id: number }).id)
  }
  const cityScopeLabel = cityIds.length === 0 ? '不限（受角色 dataScope 约束）' : `${cityIds.length} 个城市`

  // 菜单权限展开：通配符 → 全部菜单
  const menuList = expandWildcard(menuPermissions, MENU_CODES)
  const operationList = expandWildcard(operationPermissions, OPERATION_CODES)
  const fieldList = expandWildcard(fieldPermissions, FIELD_CODES)

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#f9fafb',
      }}
    >
      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>
        权限预览（服务端派生）
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6b7280' }}>
        展示该账号绑定角色的权限并集；最终生效权限仍由服务端 PermissionContext 在请求时派生，
        账号城市绑定作为最终上限。
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 13 }}>
        <strong>绑定角色：</strong>
        <span>{roleCodes.length === 0 ? <em>无</em> : roleCodes.join(' / ')}</span>

        <strong>数据范围上限：</strong>
        <span>{dataScope}</span>

        <strong>账号城市上限：</strong>
        <span>{cityScopeLabel}</span>
      </div>

      <PermissionBlock title="菜单权限" codes={menuList} color="#0b5fff" />
      <PermissionBlock title="操作权限" codes={operationList} color="#2f9e44" />
      <PermissionBlock title="字段权限" codes={fieldList} color="#e8590c" />
    </div>
  )
}

function PermissionBlock({
  title,
  codes,
  color,
}: {
  title: string
  codes: readonly string[]
  color: string
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
        {title}（{codes.length}）
      </strong>
      {codes.length === 0 ? (
        <em style={{ color: '#9ca3af', fontSize: 12 }}>无权限</em>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {codes.map((code) => (
            <span
              key={code}
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 12,
                lineHeight: '20px',
                color,
                background: `${color}1a`,
                borderRadius: 4,
                border: `1px solid ${color}40`,
              }}
            >
              {code}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

function parseArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
}

function addAll(set: Set<string>, values: string[]): void {
  for (const v of values) set.add(v)
}

/** 通配符 * → 展开为注册表全集 */
function expandWildcard(
  granted: Set<string>,
  registry: readonly string[],
): readonly string[] {
  if (granted.has('*')) return registry
  return Array.from(granted).sort()
}

// 类型守卫：让未使用的 PermissionContext 类型在 ts strict 下不报错
export type { PermissionContext }
