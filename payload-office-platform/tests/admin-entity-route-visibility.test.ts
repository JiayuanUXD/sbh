import type { SanitizedConfig } from 'payload'
import { getVisibleEntities } from '@payloadcms/ui/utilities/getVisibleEntities'
import { describe, expect, it } from 'vitest'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = await configPromise

/**
 * 后台实体路由可达性守卫（OPT-053 与 OPT-074 撞的是同一个坑）
 *
 * `admin.hidden` 不是「只把入口从导航里拿掉」：
 *   1. `@payloadcms/ui` 的 getVisibleEntities 按 hidden 过滤，产出 visibleEntities；
 *   2. `@payloadcms/next` 的 List 与 Document 两个 view 都在
 *      `!visibleEntities.<type>.includes(slug)` 时直接 notFound()。
 * 于是 /admin/collections/<slug>（含 /create、/:id）与 /admin/globals/<slug> 一起
 * 404，表现是「菜单里看得到、点进去是『没有找到任何东西』」——菜单与路由分属两套
 * 机制，只看菜单在不在会踩空。
 *
 * 退出 Payload 原生导航的正解是 `admin.group: false`：groupNavItems 直接跳过它，
 * 侧边栏与仪表盘都不出现，而路由分毫不动。本仓库所有实体都走自定义导航
 * （AdminNavigation，挂在 admin.components.beforeNavLinks），原生导航必须为空，
 * 但路由必须全部保留——包括那些日常走内嵌面板、只在排障时直接开 URL 的
 * （如 business-area-extensions，见该文件注释与 admin.description）。
 *
 * 确实要让某个实体在后台不可达，把 slug 写进下面的清单并写明理由；空着就是
 * 「一个都不许藏」。另注意 hidden 只管后台 UI，REST/GraphQL 端点照常开放：
 * 想真正禁止访问得写 access control，写 hidden 只会得到「API 能删、后台打不开」。
 */
const INTENTIONALLY_UNREACHABLE: Record<string, string> = {
  // 例：'some-slug': '理由（并确认已用 access control 真正兜住）',
  'member-sms-codes': '纯服务端验证码暂存，access 全拒，仅 Local API 读写（OPT-088 §4.2）',
  'member-favorites': '纯服务端会员收藏，access 全拒，经 /api/member/favorites/* 读写（OPT-088 §4.3）',
}

/**
 * Payload 自己注册的内部实体（payload-kv / payload-jobs / payload-locked-documents /
 * payload-preferences / payload-migrations / payload-jobs-stats）本来就写着
 * admin.hidden，藏掉是框架的意图，不在本守卫的管辖范围内——按前缀整体跳过，
 * 免得每次升级 Payload 新增一个内部集合就来红一次。
 */
const isPayloadInternal = (slug: string): boolean => slug.startsWith('payload-')

type VisibleEntitiesArgs = Parameters<typeof getVisibleEntities>[0]

/** getVisibleEntities 只用到 req.payload.config 与 req.user（hidden 的函数形态） */
function visibleEntitiesFor(config: SanitizedConfig): {
  collections: string[]
  globals: string[]
} {
  const req = {
    payload: { config },
    user: { id: 1, collection: 'users', email: 'guard@example.com' },
  } as unknown as VisibleEntitiesArgs['req']

  return getVisibleEntities({ req }) as { collections: string[]; globals: string[] }
}

describe('后台实体路由可达性（admin.hidden 会连路由一起杀掉）', () => {
  it('每个 collection 的 /admin/collections/<slug> 都保持可达', () => {
    const visible = new Set(visibleEntitiesFor(payloadConfig).collections)
    const unreachable = payloadConfig.collections
      .map((collection) => collection.slug)
      .filter((slug) => !isPayloadInternal(slug))
      .filter((slug) => !visible.has(slug) && !(slug in INTENTIONALLY_UNREACHABLE))

    expect(
      unreachable,
      `这些 collection 的后台路由被 admin.hidden 排除了，/admin/collections/<slug> 会 404：` +
        `${unreachable.join('、')}。退出原生导航请改用 admin.group: false`,
    ).toEqual([])
  })

  it('每个 global 的 /admin/globals/<slug> 都保持可达', () => {
    const visible = new Set(visibleEntitiesFor(payloadConfig).globals)
    const unreachable = payloadConfig.globals
      .map((global) => global.slug)
      .filter((slug) => !isPayloadInternal(slug))
      .filter((slug) => !visible.has(slug) && !(slug in INTENTIONALLY_UNREACHABLE))

    expect(
      unreachable,
      `这些 global 的后台路由被 admin.hidden 排除了，/admin/globals/<slug> 会 404：` +
        `${unreachable.join('、')}。退出原生导航请改用 admin.group: false`,
    ).toEqual([])
  })

  it('没有实体拿 admin.hidden 当「退出导航」用', () => {
    const offenders = [
      ...payloadConfig.collections.map((entity) => ({ kind: 'collection', entity })),
      ...payloadConfig.globals.map((entity) => ({ kind: 'global', entity })),
    ]
      .filter(({ entity }) => !isPayloadInternal(entity.slug))
      .filter(({ entity }) => entity.admin?.hidden !== undefined)
      .filter(({ entity }) => !(entity.slug in INTENTIONALLY_UNREACHABLE))
      .map(({ kind, entity }) => `${kind}:${entity.slug}`)

    expect(
      offenders,
      `${offenders.join('、')} 写了 admin.hidden。它会连后台路由一起排除，` +
        `只想退出原生导航请用 admin.group: false；确实要藏请登记进 INTENTIONALLY_UNREACHABLE`,
    ).toEqual([])
  })

  it('business-area-extensions 保留排障用的直接 URL（本守卫的由来）', () => {
    const collection = payloadConfig.collections.find(
      (candidate) => candidate.slug === 'business-area-extensions',
    )

    // 日常配置走「商圈管理」编辑页里的 BusinessAreaExtensionPanel，本页只在排障时开；
    // admin.description 对着运营这么承诺，路由就必须真的在。
    expect(collection?.admin.description).toContain('排障')
    expect(collection?.admin.group, '退出原生导航靠 group: false').toBe(false)
    expect(visibleEntitiesFor(payloadConfig).collections).toContain('business-area-extensions')
  })
})
