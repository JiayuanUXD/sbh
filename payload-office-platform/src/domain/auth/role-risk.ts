/**
 * 角色风险检测工具（tasks.md M1.5）
 *
 * 业务规则：
 *   - 自定义角色不应使用通配符 * 权限（应明确列出所需权限）
 *   - 自定义角色不应使用 dataScope=global（应使用 city/team/self）
 *   - 自定义角色不应使用 isBuiltin=true 标记
 *
 * 内置角色（ADM/OPS/MGR/BRK/CSR）使用通配符或 global 是设计预期，不视为风险。
 *
 * 此模块为纯函数，便于单元测试覆盖。
 */

export type RoleRiskLevel = 'info' | 'warning' | 'danger'

export type RoleRiskItem = {
  level: RoleRiskLevel
  code: string
  message: string
  field?: string
}

export type RoleRiskInput = {
  /** 是否内置角色（内置角色不检测通配符 / global） */
  isBuiltin?: boolean | null
  /** 数据范围上限 */
  dataScope?: string | null
  /** 菜单权限编码数组 */
  menuPermissions?: unknown
  /** 操作权限编码数组 */
  operationPermissions?: unknown
  /** 字段权限编码数组 */
  fieldPermissions?: unknown
}

/**
 * 检测自定义角色的高风险配置。
 *
 * 返回空数组表示无风险；返回多项表示多项风险叠加。
 */
export function detectRoleRisks(input: RoleRiskInput): RoleRiskItem[] {
  const risks: RoleRiskItem[] = []
  const isBuiltin = input.isBuiltin === true

  // 内置角色跳过通配符 / global 检查
  if (!isBuiltin) {
    // 1. dataScope = 'global' 风险
    if (input.dataScope === 'global') {
      risks.push({
        level: 'warning',
        code: 'CUSTOM_ROLE_GLOBAL_SCOPE',
        message: '自定义角色使用 global 数据范围，可读取全部城市数据。建议改为 city/team/self。',
        field: 'dataScope',
      })
    }

    // 2. 任意权限层使用通配符 *
    if (hasWildcard(input.menuPermissions)) {
      risks.push({
        level: 'danger',
        code: 'CUSTOM_ROLE_MENU_WILDCARD',
        message: '自定义角色菜单权限使用通配符 *，将获得全部菜单。请明确列出所需菜单编码。',
        field: 'menuPermissions',
      })
    }
    if (hasWildcard(input.operationPermissions)) {
      risks.push({
        level: 'danger',
        code: 'CUSTOM_ROLE_OPERATION_WILDCARD',
        message: '自定义角色操作权限使用通配符 *，将获得全部业务动作权限（含审核/发布/删除）。',
        field: 'operationPermissions',
      })
    }
    if (hasWildcard(input.fieldPermissions)) {
      risks.push({
        level: 'danger',
        code: 'CUSTOM_ROLE_FIELD_WILDCARD',
        message: '自定义角色字段权限使用通配符 *，可读取所有敏感字段（含完整手机号、坐标、审计前后值）。',
        field: 'fieldPermissions',
      })
    }

    // 3. 自定义角色设置 isBuiltin=true（不应发生，但提示）
    // 注意：isBuiltin 由 Collection readOnly + beforeChange hook 双层保护
    // 这里仅作前端风险提示
  }

  return risks
}

/** 是否包含通配符 * */
function hasWildcard(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((x) => x === '*')
}

/** 按风险等级聚合展示标签颜色 */
export function riskLevelColor(level: RoleRiskLevel): string {
  switch (level) {
    case 'danger':
      return '#e03131'
    case 'warning':
      return '#f08c00'
    case 'info':
    default:
      return '#0b5fff'
  }
}

/** 按风险等级聚合展示标签文案 */
export function riskLevelLabel(level: RoleRiskLevel): string {
  switch (level) {
    case 'danger':
      return '高危'
    case 'warning':
      return '警告'
    case 'info':
    default:
      return '提示'
  }
}
