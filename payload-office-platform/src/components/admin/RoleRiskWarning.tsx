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
      <div
        style={{
          marginTop: 24,
          padding: 12,
          border: '1px solid #d3f9d8',
          borderRadius: 8,
          background: '#ebfbee',
          fontSize: 13,
        }}
      >
        <strong style={{ color: '#2f9e44' }}>✓ 风险检查通过</strong>
        <span style={{ marginLeft: 8, color: '#495057' }}>
          自定义角色未使用通配符或 global 数据范围。
        </span>
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid #ffa8a8',
        borderRadius: 8,
        background: '#fff5f5',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#c92a2a' }}>
        ⚠ 自定义角色风险提示（{risks.length}）
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#868e96' }}>
        以下配置可授予超出预期的权限；最终由 Collection validate / beforeChange 兜底校验，
        建议改为按需明确列出权限编码。
      </p>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: '1.8' }}>
        {risks.map((risk, idx) => (
          <li key={`${risk.code}-${idx}`}>
            <span
              style={{
                display: 'inline-block',
                padding: '1px 8px',
                marginRight: 8,
                fontSize: 11,
                fontWeight: 600,
                color: '#fff',
                background: riskLevelColor(risk.level),
                borderRadius: 3,
              }}
            >
              {riskLevelLabel(risk.level)}
            </span>
            <strong>{risk.field ?? risk.code}</strong>
            <span style={{ marginLeft: 8, color: '#495057' }}>{risk.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
