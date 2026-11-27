import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { isStaffRequest } from '@/domain/member/member-access'
import { isSameOriginHost } from '@/lib/api/request-guards'
import { respondWithRouteError } from '@/lib/runtime/admin-route-error'
import {
  AvatarUploadError,
  storeAvatarMedia,
  validateAvatarFile,
} from '@/domain/media/avatar-upload'

export const dynamic = 'force-dynamic'

/**
 * 后台登录员工上传个人头像端点。
 *
 * 为什么单独开端点而不是复用 `/api/media`：
 *   - `Media` 集合写权限仅限持 `media` 菜单码的 ADM/OPS；MGR/BRK/CSR 在 `/admin/account`
 *     改自己的头像时走 `/api/media` 会 403；
 *   - `/api/media` 默认 `usage: 'listing-photo'` 会触发实景图水印烘焙，而头像不应打水印。
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginHost(request)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 })
  }

  let payload: Awaited<ReturnType<typeof getPayload>>
  let user: Record<string, unknown> | null = null
  try {
    payload = await getPayload({ config })
    const auth = await payload.auth({ headers: request.headers })
    if (!auth.user || !isStaffRequest({ user: auth.user })) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    user = auth.user as unknown as Record<string, unknown>
  } catch (error) {
    return respondWithRouteError('admin-avatar', error, {
      exposeDetail: false,
      context: { phase: 'authorize' },
    })
  }

  try {
    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: '请使用表单上传头像文件' },
        { status: 400 },
      )
    }

    const validated = await validateAvatarFile(formData.get('file'))
    const rawName = typeof user.name === 'string' ? user.name.trim() : ''
    const userId = typeof user.id === 'number' || typeof user.id === 'string' ? String(user.id) : 'staff'
    const media = await storeAvatarMedia(payload, validated, {
      prefix: `user-avatar-${userId}`,
      alt: rawName ? `${rawName}头像` : '后台用户头像',
    })

    return NextResponse.json(
      { ok: true, media },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof AvatarUploadError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      )
    }
    return respondWithRouteError('admin-avatar', error, {
      exposeDetail: true,
      context: { phase: 'upload' },
    })
  }
}
