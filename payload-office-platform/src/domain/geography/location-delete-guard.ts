/**
 * 地理节点删除保护 hook（tasks.md M2.2「被引用节点保护」/ PRD 03_城市区域 L114, L125）
 *
 * 不变量（R2「引用保护」、PRD L113「使用逻辑删除或停用保护有关联的数据」）：
 *   - 已被任何业务对象、账号范围、团队范围或下级节点引用的节点，不允许物理删除。
 *   - MVP 不提供删除入口;有引用时只能「确认影响后停用」,不能删。
 *
 * 依赖 countLocationReferences（payload.count 副作用），故为 hook。
 * 计数用 overrideAccess: true —— 引用保护是数据完整性不变量，不随当前用户数据权限脱敏：
 * 被「当前用户看不到的对象」引用的节点同样必须挡住删除。
 */

import type { CollectionBeforeDeleteHook } from 'payload'
import { InvalidOperationError } from '@/domain/shared/errors'
import { countLocationReferences } from './location-references'

export const protectLocationDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  // overrideAccess: true —— 完整性不变量,须统计全部引用(含当前用户无权查看的对象)
  const report = await countLocationReferences(req.payload, id, req, { overrideAccess: true })

  if (report.referenced) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'LOCATION_REFERENCED',
      message: '该区域已被业务对象或下级节点引用，不允许删除；如需下线请改为「停用」',
      details: {
        total: report.total,
        sources: report.sources.map((s) => ({ label: s.label, count: s.count })),
      },
    })
  }
}
