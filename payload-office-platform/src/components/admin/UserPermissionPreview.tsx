import type { Payload } from 'payload'

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
 * 在用户编辑页表单顶部展示：
 *   - 绑定角色列表
 *   - 菜单权限并集
 *   - 操作权限并集
 *   - 字段权限并集
 *   - 数据范围上限（最宽）+ 账号城市上限
 *
 * 落点：用户编辑视图表单顶部（ui 字段），占满主内容区宽度。
 * 原先挂在 beforeDocumentControls（右侧按钮区，宽度仅 ~290px），
 * 三列权限块布局严重挤压、且溢出遮挡下方表单——改为 ui 字段后
 * 模块在表单区顶部渲染，有充足横向空间。
 *
 * 仅展示，不参与写入；数据来自服务端加载的角色文档。
 *
 * 安全说明：
 *   - 不可信任客户端表单数据；权限预览仅基于服务端 payload.find 加载的角色文档
 *   - 此组件仅展示，不修改任何字段；最终权限仍由 PermissionContext 在请求时派生
 *
 * 新建（未保存）用户无 id → 不渲染。
 */
type FieldProps = Readonly<{
  payload: Payload
  data?: Readonly<{ id?: string | number }> & Record<string, unknown>
  id?: string | number
}>

export default async function UserPermissionPreview({ payload, data, id }: FieldProps) {
  const docId = id ?? data?.id
  if (docId === undefined || docId === null || docId === '') return null

  let user: User | null = null
  try {
    user = (await payload.findByID({
      collection: 'users',
      id: docId,
      depth: 1,
      overrideAccess: true,
    })) as unknown as User
  } catch {
    return null
  }
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

  // 数据范围中文映射
  const dataScopeLabels: Record<DataScope, string> = {
    none: '无数据权限',
    self: '仅本人数据',
    team: '本团队数据',
    city: '本城市数据',
    global: '全部数据',
  }

  return (
    <div className="perm-preview">
      <div className="perm-preview__header">
        <h3 className="perm-preview__title">权限预览</h3>
        <span className="perm-preview__badge">服务端派生</span>
      </div>
      <p className="perm-preview__desc">
        展示该账号绑定角色的权限并集；最终生效权限仍由服务端 PermissionContext 在请求时派生，账号城市绑定作为最终上限。
      </p>

      <div className="perm-preview__meta">
        <div className="perm-preview__meta-item">
          <span className="perm-preview__meta-label">绑定角色</span>
          <span className="perm-preview__meta-value">
            {roleCodes.length === 0 ? <em className="perm-preview__empty-text">无</em> : roleCodes.join(' / ')}
          </span>
        </div>
        <div className="perm-preview__meta-item">
          <span className="perm-preview__meta-label">数据范围上限</span>
          <span className="perm-preview__meta-value perm-preview__meta-value--strong">
            {dataScopeLabels[dataScope]}
          </span>
        </div>
        <div className="perm-preview__meta-item">
          <span className="perm-preview__meta-label">账号城市上限</span>
          <span className="perm-preview__meta-value">{cityScopeLabel}</span>
        </div>
      </div>

      <div className="perm-preview__blocks">
        <PermissionBlock title="菜单权限" codes={menuList} variant="blue" />
        <PermissionBlock title="操作权限" codes={operationList} variant="green" />
        <PermissionBlock title="字段权限" codes={fieldList} variant="orange" />
      </div>
    </div>
  )
}

function PermissionBlock({
  title,
  codes,
  variant,
}: {
  title: string
  codes: readonly string[]
  variant: 'blue' | 'green' | 'orange'
}) {
  return (
    <div className={`perm-preview__block perm-preview__block--${variant}`}>
      <div className="perm-preview__block-header">
        <span className="perm-preview__block-title">{title}</span>
        <span className={`perm-preview__block-count perm-preview__block-count--${variant}`}>
          {codes.length}
        </span>
      </div>
      {codes.length === 0 ? (
        <span className="perm-preview__empty-text">无权限</span>
      ) : (
        <div className="perm-preview__tags">
          {codes.map((code) => (
            <span key={code} className={`perm-preview__tag perm-preview__tag--${variant}`}>
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
