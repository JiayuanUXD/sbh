/**
 * 角色复制服务（tasks.md M1.5）
 *
 * 业务规则：
 *   - 任何角色都可被复制（包括内置角色）
 *   - 复制结果总是创建一个 isBuiltin=false 的自定义角色
 *   - 复制时必须提供新的 code（必须唯一且符合编码规则）
 *   - 复制保留 dataScope / menuPermissions / operationPermissions / fieldPermissions
 *
 * 安全：
 *   - 调用方必须先通过 requireOperationPermission(req, 'role:manage') 校验
 *   - 此函数不重复校验权限；只负责领域逻辑
 *   - code 唯一性由 Collection unique 字段保证
 *   - 权限编码合法性由 Collection validate 保证
 */

import type { BasePayload } from 'payload'
import type { Role } from '@/payload-types'

export type CopyRoleInput = {
  /** 源角色 ID */
  sourceId: number | string
  /** 新角色编码（必须唯一，符合 [A-Z][A-Z0-9_]{1,31}） */
  newCode: string
  /** 新角色名称（可选，默认：${source.name} - 副本） */
  newName?: string
}

export type CopyRoleResult = {
  ok: true
  role: Role
} | {
  ok: false
  error: string
}

/**
 * 复制角色：创建一个基于源角色的自定义角色副本。
 *
 * 步骤：
 *   1. 读取源角色（overrideAccess=true，避免 access 递归）
 *   2. 校验新 code 合法性
 *   3. 创建新角色，isBuiltin=false
 *
 * 注意：调用方必须先校验 role:manage 权限。
 */
export async function copyRole(
  payload: BasePayload,
  input: CopyRoleInput,
): Promise<CopyRoleResult> {
  const { sourceId, newCode, newName } = input

  // 1. 校验 newCode 格式
  const codeError = validateRoleCode(newCode)
  if (codeError) return { ok: false, error: codeError }

  // 2. 读取源角色
  let source: Role | null = null
  try {
    source = (await payload.findByID({
      collection: 'roles',
      id: sourceId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Role
  } catch {
    return { ok: false, error: `源角色不存在：${sourceId}` }
  }
  if (!source) return { ok: false, error: `源角色不存在：${sourceId}` }

  // 3. 检查 newCode 唯一性
  const existing = await payload.find({
    collection: 'roles',
    where: { code: { equals: newCode } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    return { ok: false, error: `角色编码已存在：${newCode}` }
  }

  // 4. 创建副本
  const finalName = newName?.trim() || `${source.name} - 副本`
  try {
    const created = await payload.create({
      collection: 'roles',
      data: {
        code: newCode,
        name: finalName,
        description: source.description ?? undefined,
        isBuiltin: false, // 副本总是自定义角色
        status: 'active',
        dataScope: source.dataScope,
        menuPermissions: source.menuPermissions,
        operationPermissions: source.operationPermissions,
        fieldPermissions: source.fieldPermissions,
      },
      overrideAccess: true,
    })
    return { ok: true, role: created as unknown as Role }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `创建角色副本失败：${message}` }
  }
}

/** 校验角色编码格式：[A-Z][A-Z0-9_]{1,31}，长度 2-32 */
export function validateRoleCode(code: string): string | null {
  if (!code || typeof code !== 'string') return '角色编码必填'
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
    return '角色编码必须以大写字母开头，仅含大写字母/数字/下划线，长度 2-32'
  }
  return null
}
