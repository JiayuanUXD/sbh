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
const jobsQueueMock = vi.fn()

const payload = {
  auth: authMock,
  find: findMock,
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

beforeEach(() => {
  authMock.mockReset()
  findMock.mockReset()
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
