import type { DocumentViewServerProps } from 'payload'

import type { Role } from '@/payload-types'
import {
  detectRoleRisks,
  riskLevelColor,
  riskLevelLabel,
} from '@/domain/auth/role-risk'

/**
 * 角色风险提示组件（tasks.md M1.5）
 *
 * 在角色编辑页底部展示：
 *   - 自定义角色使用通配符 * 权限 → 高危提示
 *   - 自定义角色 dataScope=global → 警告提示
 *   - 内置角色不显示风险提示（通配符 / global 是设计预期）
 *
 * 仅展示，不阻止保存；最终由 Collection validate / beforeChange 兜底校验。
 */
export default async function RoleRiskWarning({
  doc,
}: DocumentViewServerProps) {
  const role = doc as unknown as Role
  if (!role || !role.id) return null

  // 内置角色不展示风险提示
  if (role.isBuiltin === true) return null

  const risks = detectRoleRisks({
    isBuiltin: role.isBuiltin,
    dataScope: role.dataScope,
    menuPermissions: role.menuPermissions,
    operationPermissions: role.operationPermissions,
    fieldPermissions: role.fieldPermissions,
  })

  if (risks.length === 0) {
    return (
      <div className="risk-warning risk-warning--safe">
        <strong className="risk-warning__safe-title">✓ 风险检查通过</strong>
        <span className="risk-warning__safe-desc">
          自定义角色未使用通配符或 global 数据范围。
        </span>
      </div>
    )
  }

  return (
    <div className="risk-warning risk-warning--danger">
      <h3 className="risk-warning__title">
        ⚠ 自定义角色风险提示（{risks.length}）
      </h3>
      <p className="risk-warning__desc">
        以下配置可授予超出预期的权限；最终由 Collection validate / beforeChange 兜底校验，
        建议改为按需明确列出权限编码。
      </p>
      <ul className="risk-warning__list">
        {risks.map((risk, idx) => (
          <li key={`${risk.code}-${idx}`}>
            <span
              className="risk-warning__badge"
              style={{ background: riskLevelColor(risk.level) }}
            >
              {riskLevelLabel(risk.level)}
            </span>
            <strong>{risk.field ?? risk.code}</strong>
            <span className="risk-warning__msg">{risk.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
