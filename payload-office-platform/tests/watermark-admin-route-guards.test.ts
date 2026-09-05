import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * OPT-069 code review（第 1 轮 Important）：`/api/watermark-preview` 与
 * `/api/watermark-rebake` 此前没有任何自动化测试——这正是权限缺口
 * （预览端点只查了登录态、没查 `site_settings:manage`）没被发现的原因。
 *
 * 本文件只钉「登录但无权限 → 403」这一条守卫行为，不测渲染出的图片内容
 * 或队列任务的具体 payload（那些分别属于 watermark 纯函数层与 Task 7 的范畴）。
 */

const authMock = vi.fn()
const findMock = vi.fn()
const findGlobalMock = vi.fn()
const jobsQueueMock = vi.fn()

const payload = {
  auth: authMock,
  find: findMock,
  findGlobal: findGlobalMock,
  jobs: { queue: jobsQueueMock },
}

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => payload),
  }
})

import { GET as watermarkPreviewGet } from '@/app/api/watermark-preview/route'
import { POST as watermarkRebakePost } from '@/app/api/watermark-rebake/route'

/** 登录态有效、但没有任何角色——`site_settings:manage` 自然不在权限集合里。 */
const NO_PERMISSION_USER = {
  id: 1,
  roles: [],
  cityScope: null,
  status: 'active',
  sessionVersion: 1,
}

/**
 * 登录态有效，且角色里带着已解析（非 ID）的 `site_settings:manage`——
 * `buildPermissionContext` 遇到已经是对象形态的 role 会直接采信，不再回查
 * `payload.find`，所以这里不需要额外 mock 角色加载。
 */
const PERMITTED_USER = {
  id: 2,
  roles: [
    {
      id: 10,
      status: 'active',
      code: 'site-settings-admin',
      operationPermissions: ['site_settings:manage'],
      fieldPermissions: [],
      menuPermissions: [],
      dataScope: 'all',
    },
  ],
  cityScope: null,
  status: 'active',
  sessionVersion: 1,
}

beforeEach(() => {
  authMock.mockReset()
  findMock.mockReset()
  findGlobalMock.mockReset()
  jobsQueueMock.mockReset()
})

describe('GET /api/watermark-preview 权限守卫', () => {
  it('登录但无 site_settings:manage 权限时返回 403，而不是渲染预览图', async () => {
    authMock.mockResolvedValue({ user: NO_PERMISSION_USER })

    const request = new Request('http://localhost/api/watermark-preview?mode=tiled')
    const response = await watermarkPreviewGet(request)

    expect(response.status).toBe(403)
  })
})

describe('POST /api/watermark-rebake 权限守卫', () => {
  it('登录但无 site_settings:manage 权限时返回 403，且不投递重刷任务', async () => {
    authMock.mockResolvedValue({ user: NO_PERMISSION_USER })

    const request = new Request('http://localhost/api/watermark-rebake', { method: 'POST' })
    const response = await watermarkRebakePost(request)

    expect(response.status).toBe(403)
    expect(jobsQueueMock).not.toHaveBeenCalled()
  })
})

/**
 * 最终复审第 3 项：`rebakeWatermarkTask` 在开关关闭时会立刻早退、什么都不处理
 * （`src/domain/media/watermark-rebake.ts` 顶部注释「开关关着时不做事」），
 * 但本路由此前无论开关状态都返回 `{ queued: true }`，前端因此谎报「已加入队列」，
 * 真实原因只留在服务日志里。这里钉住路由必须能分辨这两种情况，且开关关闭时
 * 不能投递任务——防止有人把早退判断悄悄移回「排队后不做事」。
 */
describe('POST /api/watermark-rebake 水印开关状态', () => {
  it('开关关闭时不排队，返回 queued:false 而不是谎报已加入队列', async () => {
    authMock.mockResolvedValue({ user: PERMITTED_USER })
    findGlobalMock.mockResolvedValue({ watermark: { enabled: false }, siteName: '商办荟' })

    const request = new Request('http://localhost/api/watermark-rebake', { method: 'POST' })
    const response = await watermarkRebakePost(request)
    const body = (await response.json()) as { queued: boolean; reason?: string }

    expect(response.status).toBe(200)
    expect(body.queued).toBe(false)
    expect(jobsQueueMock).not.toHaveBeenCalled()
  })

  it('开关开启时正常排队，返回 queued:true', async () => {
    authMock.mockResolvedValue({ user: PERMITTED_USER })
    findGlobalMock.mockResolvedValue({ watermark: { enabled: true }, siteName: '商办荟' })

    const request = new Request('http://localhost/api/watermark-rebake', { method: 'POST' })
    const response = await watermarkRebakePost(request)
    const body = (await response.json()) as { queued: boolean }

    expect(response.status).toBe(200)
    expect(body.queued).toBe(true)
    expect(jobsQueueMock).toHaveBeenCalledTimes(1)
  })
})
