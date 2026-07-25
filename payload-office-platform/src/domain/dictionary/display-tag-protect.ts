/**
 * 展示标签保护 hook（tasks.md M2.6 Part B / Requirement R2）
 *
 * 守护不变量：
 *   1. code 格式合法（normalizeTagCode，回写规范化值）
 *   2. code 创建后不可改（改名只改 name，不改稳定引用键）
 *   3. 版本乐观锁（VersionConflictError）
 *
 * 停用语义：status=disabled 允许保存，记录保持可读——历史快照（snapshotTag）
 * 由业务对象自身冻结，不依赖标签在线，故停用不影响历史展示。
 */
import type { CollectionBeforeChangeHook } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { normalizeTagCode } from './display-tag'

export const protectDisplayTag: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
}) => {
  // —— code 格式校验 + 规范化回写 ——
  const normalized = normalizeTagCode(data?.code)
  data.code = normalized

  // —— code 创建后不可改 ——
  if (operation === 'update' && originalDoc) {
    const prevCode = typeof originalDoc.code === 'string' ? originalDoc.code : null
    if (prevCode !== null && prevCode !== normalized) {
      throw new InvalidOperationError({
        domain: 'dictionary',
        code: 'TAG_CODE_IMMUTABLE',
        message: '标签编码创建后不可更改，如需改名请修改显示名',
        details: { from: prevCode, to: normalized },
      })
    }
  }

  // —— 版本乐观锁 ——
  if (operation === 'create') {
    data.version = 1
  } else if (operation === 'update' && originalDoc) {
    const currentVersion = typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const submitted = data?.version
    if (typeof submitted === 'number' && submitted !== currentVersion) {
      throw new VersionConflictError({
        domain: 'dictionary',
        resource: '展示标签',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
