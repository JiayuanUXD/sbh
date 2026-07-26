import type { DocumentViewServerProps } from 'payload'

import type { Role } from '@/payload-types'
import CopyRoleButtonClient from './CopyRoleButtonClient'

/**
 * 角色复制按钮 - 服务端入口（tasks.md M1.5）
 *
 * 在角色编辑页顶部展示"复制角色"按钮：
 *   - 服务端从 doc 提取 id/code/name 等可序列化字段
 *   - 客户端组件负责交互（弹窗 / API 调用 / 跳转）
 *
 * 注册方式：在 Roles Collection admin.components.edit 顶部追加。
 */
export default async function CopyRoleButton({ doc }: DocumentViewServerProps) {
  const role = doc as unknown as Role
  if (!role || !role.id) return null

  return (
    <CopyRoleButtonClient
      roleId={role.id}
      roleCode={role.code ?? ''}
      roleName={role.name ?? ''}
    />
  )
}
