/**
 * 角色保护 hook（tasks.md M1.2, design.md §3.1）
 *
 * 业务不变量（AGENTS.md §6）：
 *   - 内置角色固定 5 个：ADM / OPS / MGR / BRK / CSR
 *   - 不得创建第六种内置角色（isBuiltin=true 的 code 必须在这 5 个之内）
 *   - 内置角色禁止删除、改码、移除 builtin 标记
 *
 * 从 Roles.ts 抽出为独立纯函数，便于单测（P2-6）。
 */

import type { CollectionBeforeChangeHook } from 'payload'
import type { Role } from '@/payload-types'
import { BUILTIN_ROLE_CODES } from '@/domain/auth/permission-context'

/**
 * beforeChange hook：内置角色身份保护。
 *
 *   - create：若标记 isBuiltin=true，则 code 必须是 5 个合法内置码之一（禁止伪造第六种内置角色）
 *   - update：内置角色禁止改 code、禁止移除 builtin 标记
 *
 * 不校验权限（由 Collection access.create/update 的 role:manage 把关），仅守护身份不变量。
 */
export const protectBuiltinRole: CollectionBeforeChangeHook<Role> = ({
  originalDoc,
  data,
  operation,
}) => {
  if (operation === 'create') {
    // 只有 5 个合法内置码可标记为内置角色
    if (data?.isBuiltin === true) {
      const code = typeof data?.code === 'string' ? data.code : ''
      if (!(BUILTIN_ROLE_CODES as readonly string[]).includes(code)) {
        throw new Error(
          `不可创建内置角色：仅 ${BUILTIN_ROLE_CODES.join('/')} 允许标记为内置，收到 code=${code || '(空)'}`,
        )
      }
    }
    return data
  }

  if (operation !== 'update') return data
  if (!originalDoc?.isBuiltin) return data

  // 内置角色禁止改 code
  if (originalDoc.code && data?.code && originalDoc.code !== data.code) {
    throw new Error(`内置角色编码不可修改：${originalDoc.code}`)
  }
  // 内置角色禁止移除 builtin 标记
  if (originalDoc.isBuiltin === true && data?.isBuiltin === false) {
    throw new Error(`内置角色 builtin 标记不可移除：${originalDoc.code ?? ''}`)
  }
  return data
}
