import sharp from 'sharp'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockGetPayload = vi.fn(async () => ({
  auth: mockAuth,
  create: mockCreate,
  update: mockUpdate,
  secret: 'test-secret',
  logger: { info: vi.fn(), warn: vi.fn() },
  db: {},
}))

const mockGetCurrentMember = vi.fn()

vi.mock('payload', async () => {
  const actual = await vi.importActual<typeof import('payload')>('payload')
  return {
    ...actual,
    getPayload: mockGetPayload,
  }
})

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/payload.config', () => ({ default: {} }))

vi.mock('@/domain/member/current-member', () => ({
  getCurrentMember: mockGetCurrentMember,
}))

vi.mock('@/domain/member/sms-provider', () => ({
  resolveSmsProvider: () => null,
}))

const { POST: adminAvatarPost } = await import('@/app/api/admin/avatar/route')
const { POST: memberAvatarPost, DELETE: memberAvatarDelete } = await import(
  '@/app/api/member/avatar/route'
)

async function makePngFile(name = 'avatar.png'): Promise<File> {
  const buf = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return new File([new Uint8Array(buf)], name, { type: 'image/png' })
}

function makeFormReq(
  url: string,
  file: File | null,
  headers: Record<string, string> = { origin: 'http://localhost:3727', host: 'localhost:3727' },
): Request {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request(url, { method: 'POST', headers, body: fd })
}

describe('头像上传与清除 API 路由权限与校验', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST /api/admin/avatar：跨源拒绝 403，未登录与会员上下文拒绝 401', async () => {
    const cross = makeFormReq('http://localhost:3727/api/admin/avatar', await makePngFile(), {
      origin: 'https://evil.example.com',
      host: 'localhost:3727',
    })
    expect((await adminAvatarPost(cross)).status).toBe(403)

    mockAuth.mockResolvedValueOnce({ user: null })
    expect(
      (await adminAvatarPost(makeFormReq('http://localhost:3727/api/admin/avatar', await makePngFile())))
        .status,
    ).toBe(401)

    mockAuth.mockResolvedValueOnce({ user: { id: 1, collection: 'members' } })
    expect(
      (await adminAvatarPost(makeFormReq('http://localhost:3727/api/admin/avatar', await makePngFile())))
        .status,
    ).toBe(401)
  })

  it('POST /api/admin/avatar：后台员工上传合法 PNG 返回 201 且写入 usage=other', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 5, name: '张三', collection: 'users' },
    })
    mockCreate.mockResolvedValueOnce({
      id: 88,
      url: '/api/media/file/user-avatar.png',
      sizes: { thumb: { url: '/api/media/file/user-avatar-thumb.webp' } },
    })

    const res = await adminAvatarPost(
      makeFormReq('http://localhost:3727/api/admin/avatar', await makePngFile()),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      media: { id: 88, url: '/api/media/file/user-avatar-thumb.webp' },
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        data: { alt: '张三头像', usage: 'other' },
        overrideAccess: true,
      }),
    )
  })

  it('POST /api/member/avatar：跨源 403、未登录 401、SVG 400、成功更新返回 MemberDto', async () => {
    const cross = makeFormReq('http://localhost:3727/api/member/avatar', await makePngFile(), {
      origin: 'https://evil.example.com',
      host: 'localhost:3727',
    })
    expect((await memberAvatarPost(cross)).status).toBe(403)

    mockGetCurrentMember.mockResolvedValueOnce(null)
    expect(
      (await memberAvatarPost(makeFormReq('http://localhost:3727/api/member/avatar', await makePngFile())))
        .status,
    ).toBe(401)

    mockGetCurrentMember.mockResolvedValueOnce({
      id: 7,
      username: '13800001234',
      nickname: '王先生',
      hasPassword: true,
      createdAt: '2026-09-11T00:00:00Z',
    })
    const svgFile = new File(['<svg></svg>'], 'a.svg', { type: 'image/svg+xml' })
    const badRes = await memberAvatarPost(
      makeFormReq('http://localhost:3727/api/member/avatar', svgFile),
    )
    expect(badRes.status).toBe(400)
    expect((await badRes.json()).code).toBe('UNSUPPORTED_IMAGE')

    mockGetCurrentMember.mockResolvedValueOnce({
      id: 7,
      username: '13800001234',
      nickname: '王先生',
      hasPassword: true,
      createdAt: '2026-09-11T00:00:00Z',
    })
    mockCreate.mockResolvedValueOnce({
      id: 99,
      url: '/api/media/file/m-avatar.png',
      sizes: { thumb: { url: '/api/media/file/m-avatar-thumb.webp' } },
    })
    mockUpdate.mockResolvedValueOnce({
      id: 7,
      username: '13800001234',
      nickname: '王先生',
      hasPassword: true,
      createdAt: '2026-09-11T00:00:00Z',
      avatar: {
        id: 99,
        url: '/api/media/file/m-avatar.png',
        sizes: { thumb: { url: '/api/media/file/m-avatar-thumb.webp' } },
      },
    })

    const okRes = await memberAvatarPost(
      makeFormReq('http://localhost:3727/api/member/avatar', await makePngFile()),
    )
    expect(okRes.status).toBe(200)
    const okBody = await okRes.json()
    expect(okBody.ok).toBe(true)
    expect(okBody.member.avatarUrl).toBe('/api/media/file/m-avatar-thumb.webp')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'members',
        id: 7,
        data: { avatar: 99 },
        context: { memberFlow: 'profile' },
      }),
    )
  })

  it('DELETE /api/member/avatar：清空头像并返回 avatarUrl: null', async () => {
    mockGetCurrentMember.mockResolvedValueOnce({
      id: 7,
      username: '13800001234',
      nickname: '王先生',
      hasPassword: true,
      createdAt: '2026-09-11T00:00:00Z',
    })
    mockUpdate.mockResolvedValueOnce({
      id: 7,
      username: '13800001234',
      nickname: '王先生',
      hasPassword: true,
      createdAt: '2026-09-11T00:00:00Z',
      avatar: null,
    })

    const req = new Request('http://localhost:3727/api/member/avatar', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3727', host: 'localhost:3727' },
    })
    const res = await memberAvatarDelete(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.member.avatarUrl).toBeNull()
  })
})
