import type { Endpoint } from 'payload'

import { saveBusinessAreaWithFeatured } from '@/domain/geography/business-area-save'

import { readEndpointBody } from './read-endpoint-body'

/** 抽屉允许保存的基础字段。白名单：这个端点不该成为改任意 locations 字段的后门。 */
const LOCATION_FIELDS = [
  'name',
  'status',
  'frontendVisible',
  'sortOrder',
  'centerLatitude',
  'centerLongitude',
  'coverImage',
  'version',
] as const

/**
 * 商圈抽屉保存 endpoint：基础信息 + 首页精选序号，同一笔事务。
 *
 * POST /api/locations/:id/save-business-area
 *   body { name, status, frontendVisible, sortOrder, centerLatitude, centerLongitude,
 *          coverImage?, version, featuredOrder?, extensionVersion? }
 *   featuredOrder 缺省 = 不动精选；null = 取消精选；整数 = 设置。
 *
 * 响应：200 { doc }；失败 { errors: [{ message }] }，状态码取自底层错误（版本冲突 409、
 * 校验失败 4xx、无权 403），形状与 Payload REST 一致，客户端沿用同一套错误展示。
 */
export function createBusinessAreaSaveEndpoint(): Endpoint {
  return {
    path: '/:id/save-business-area',
    method: 'post',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ errors: [{ message: '未登录' }] }, { status: 401 })
      }
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (id === undefined || id === '') {
        return Response.json({ errors: [{ message: '缺少商圈 ID' }] }, { status: 400 })
      }
      const body = await readEndpointBody(req)
      if (!body) {
        return Response.json({ errors: [{ message: '请求体必须是 JSON 对象' }] }, { status: 400 })
      }

      const location: Record<string, unknown> = {}
      for (const key of LOCATION_FIELDS) if (key in body) location[key] = body[key]

      let featured: { order: number | null; version?: number | null } | undefined
      if ('featuredOrder' in body) {
        const order = body.featuredOrder
        if (order !== null && typeof order !== 'number') {
          return Response.json({ errors: [{ message: '首页精选序号必须是数字或 null' }] }, { status: 400 })
        }
        const version = body.extensionVersion
        featured = { order, version: typeof version === 'number' ? version : null }
      }

      try {
        const { doc } = await saveBusinessAreaWithFeatured(req, { id, location, featured })
        return Response.json({ doc })
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
            ? error.status
            : 500
        const message = error instanceof Error ? error.message : '保存失败'
        return Response.json({ errors: [{ message }] }, { status })
      }
    },
  }
}
