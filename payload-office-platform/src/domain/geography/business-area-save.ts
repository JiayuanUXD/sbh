import type { PayloadRequest } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'
import { findByIdSafe, runInRequestTransaction } from '@/domain/shared/transaction-safety'

export type SaveBusinessAreaInput = Readonly<{
  id: number | string
  /** `locations` 的基础字段（名称 / 状态 / 前台可见 / 排序 / 坐标 / 封面 / version） */
  location: Record<string, unknown>
  /** 不传 = 不动精选序号；`order: null` = 取消精选；`version` 是扩展记录的乐观锁版本 */
  featured?: Readonly<{ order: number | null; version?: number | null }>
}>

/**
 * 商圈抽屉的一次保存：基础信息（locations）与首页精选序号（business-area-extensions）
 * 在**同一笔事务**里提交。
 *
 * 为什么不让客户端串两次请求：序号校验（名额上限 / 版本冲突 / 前台可见）可能在基础信息
 * 落库之后才失败，客户端无法回滚前一次写入，一次保存就留下「一半成功」。
 * 自定义端点没有请求级事务，由 `runInRequestTransaction` 开；两次 payload 写入都带 req，
 * 扩展的保护 hook 因此也能看到同一事务里刚改的前台可见性（同时打开可见性并设序号能成功）。
 *
 * 权限不另判：两次写入都 `overrideAccess: false`，各自走 collection 的 access。
 */
export async function saveBusinessAreaWithFeatured(
  req: PayloadRequest,
  input: SaveBusinessAreaInput,
): Promise<{ doc: unknown }> {
  const { id, location, featured } = input
  const area = await findByIdSafe<{ type?: unknown }>({
    req,
    collection: 'locations',
    id,
    depth: 0,
    operation: 'business-area-save:location',
  })
  if (!area || area.type !== 'business_area') {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'NOT_BUSINESS_AREA',
      message: '目标不是商圈，不能按商圈保存',
    })
  }

  return runInRequestTransaction(req, 'business-area-save', async () => {
    const doc = await req.payload.update({
      collection: 'locations',
      id,
      data: location,
      depth: 0,
      req,
      overrideAccess: false,
    })

    if (featured) {
      const found = await req.payload.find({
        collection: 'business-area-extensions',
        where: { businessArea: { equals: id } },
        limit: 1,
        depth: 0,
        req,
        overrideAccess: false,
      })
      const extension = found.docs[0]
      if (extension) {
        await req.payload.update({
          collection: 'business-area-extensions',
          id: extension.id,
          data: {
            featuredOrder: featured.order,
            ...(typeof featured.version === 'number' ? { version: featured.version } : {}),
          },
          depth: 0,
          req,
          overrideAccess: false,
        })
      } else if (featured.order !== null) {
        await req.payload.create({
          collection: 'business-area-extensions',
          data: { businessArea: Number(id), featuredOrder: featured.order },
          depth: 0,
          req,
          overrideAccess: false,
        })
      }
    }
    return { doc }
  })
}
