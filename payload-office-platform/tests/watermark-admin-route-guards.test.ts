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

/**
 * OPT-069 上线后的真实故障：`/api/watermark-preview` 在生产恒 500，而当时
 *   - 前端 `<img onError>` 把它显示成「预览需要『站点设置』管理权限」（指错方向），
 *   - 应用日志不进 CLS（服务配置里 LogSetId / LogTopicId 都是空串），
 * 两条观测通道同时断，异常成了纯黑盒，只能靠本地复现做排除法。
 *
 * 这里钉住修复后的契约：**渲染路径抛错必须变成带原因的 500 JSON**，
 * 而不是让异常冒泡成一个没有响应体的失败请求。谁以后把 try/catch 拿掉，这两条会红。
 */
describe('后台水印端点的异常出口', () => {
  it('预览渲染抛错时返回 500 与可读原因，而不是空响应体', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ user: PERMITTED_USER })
    findGlobalMock.mockRejectedValue(new Error('librsvg 渲染失败：no fonts configured'))

    const request = new Request('http://localhost/api/watermark-preview?mode=tiled')
    const response = await watermarkPreviewGet(request)
    const body = (await response.json()) as { error: string; name: string; message: string }

    expect(response.status).toBe(500)
    expect(body.error).toBe('internal_error')
    expect(body.message).toContain('librsvg')
    // 日志仍然照发：响应里这份是兜底，不是替代。
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('500 响应体不带 stack——stack 只进日志，不送出进程', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ user: PERMITTED_USER })
    findGlobalMock.mockRejectedValue(new Error('boom'))

    const request = new Request('http://localhost/api/watermark-preview?mode=badge')
    const response = await watermarkPreviewGet(request)
    const body = (await response.json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('stack')
    consoleError.mockRestore()
  })

  it('重刷投递抛错时返回 500 而不是让前端以为排队成功', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ user: PERMITTED_USER })
    findGlobalMock.mockResolvedValue({ watermark: { enabled: true }, siteName: '商办荟' })
    jobsQueueMock.mockRejectedValue(new Error('队列不可用'))

    const request = new Request('http://localhost/api/watermark-rebake', { method: 'POST' })
    const response = await watermarkRebakePost(request)
    const body = (await response.json()) as { error: string; message: string }

    expect(response.status).toBe(500)
    expect(body.error).toBe('internal_error')
    expect(body.message).toContain('队列不可用')
    consoleError.mockRestore()
  })
})

/**
 * PR #153 code review（P1）：初版把整个处理函数包进一个 try，于是 `getPayload` /
 * `payload.auth` / `getPermissionContext` 抛错时，原始异常消息会回给一个**尚未通过
 * 权限校验、甚至可能是匿名**的调用方——DB 连接失败带主机与端口，config-guard 的
 * 报错逐条列出环境变量名。
 *
 * 这里钉住修复后的分界：鉴权链路上的异常只回通用错误，现场全部留在服务端日志里；
 * 只有确认调用方持有 `site_settings:manage` 之后才回 name/message。
 */
describe('鉴权通过之前的异常不得泄露细节', () => {
  it('预览端点：会话校验抛错时 500 不带 message，但日志留全量现场', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockRejectedValue(new Error('connect ECONNREFUSED sh-postgres-xxxx.tencentcdb.com:26710'))

    const request = new Request('http://localhost/api/watermark-preview?mode=tiled')
    const response = await watermarkPreviewGet(request)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'internal_error' })
    expect(body).not.toHaveProperty('message')
    expect(body).not.toHaveProperty('name')
    // 日志不受影响：无论鉴权到哪一步，服务端都要能查到真实原因。
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).toContain('ECONNREFUSED')
    expect(logged).toContain('sh-postgres')
    consoleError.mockRestore()
  })

  it('重刷端点：会话校验抛错时 500 不带 message，且不投递任务', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockRejectedValue(new Error('DATABASE_URL 未配置'))

    const request = new Request('http://localhost/api/watermark-rebake', { method: 'POST' })
    const response = await watermarkRebakePost(request)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'internal_error' })
    expect(jobsQueueMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('权限不足的用户拿不到细节——403 先于任何异常出口', async () => {
    authMock.mockResolvedValue({ user: NO_PERMISSION_USER })
    findGlobalMock.mockRejectedValue(new Error('不该被读到的内部错误'))

    const response = await watermarkPreviewGet(
      new Request('http://localhost/api/watermark-preview?mode=tiled'),
    )
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(403)
    expect(JSON.stringify(body)).not.toContain('不该被读到')
  })
})
