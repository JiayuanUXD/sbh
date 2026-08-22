/**
 * 守护「公开目录失效必须是硬失效」这条语义，直接跑 Next 自己的运行时代码。
 *
 * 背景（OPT-041 Task 10 D11 排查结论）：
 *   回滚/下架后紧接着的一次读仍然返回 200，再下一次才 404。原因不是 tag 覆盖不够，
 *   而是 `revalidateTag(tag, 'max')` 只把 tag 标成 stale：
 *     revalidate.js  → pendingRevalidatedTags.push({tag, profile:'max'})
 *     revalidation-utils.js → durations = { expire: cacheLife.max.expire }  // 31536000
 *     file-system-cache.js  → { stale: now, expired: now + 一年 }
 *     incremental-cache.js  → areTagsExpired=false / areTagsStale=true → isStale:true
 *     unstable-cache.js     → 后台刷新 + **return cachedResponse（陈旧值）**
 *   `force-dynamic` 页面 isStaticGeneration=false，走不到阻塞式重算那条分支，
 *   所以陈旧一次是确定性行为，不是竞态。
 *
 * 参数断言（"传了 {expire:0}"）挡不住这个 bug——'max' 当初也是"传了合法参数"。
 * 所以这里断言的是**行为**：把我们的 profile 喂给 Next 真实的 FileSystemCache，
 * 再问 Next 真实的 areTagsExpired / areTagsStale，确认落在硬失效那一侧。
 *
 * 这个测试同时是 Next 升级的哨兵：`cacheLife.max` 的默认值或 tags-manifest 的
 * 判定逻辑一旦变了，这里会先红。
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { IMMEDIATE_CACHE_EXPIRE_PROFILE } from '@/domain/public-catalog'

const require_ = createRequire(import.meta.url)

/** Next 内部模块没有类型声明，以 unknown 收口后用守卫取出需要的两个函数。 */
type TagsManifestModule = {
  areTagsExpired: (tags: readonly string[], timestamp: number) => boolean
  areTagsStale: (tags: readonly string[], timestamp: number) => boolean
}

type RevalidateTagFn = (
  tags: readonly string[],
  durations?: { expire?: number },
) => Promise<void> | void

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

function loadTagsManifest(): TagsManifestModule {
  const mod: unknown = require_(
    'next/dist/server/lib/incremental-cache/tags-manifest.external.js',
  )
  if (
    typeof mod !== 'object' ||
    mod === null ||
    !('areTagsExpired' in mod) ||
    !('areTagsStale' in mod) ||
    !isFunction(mod.areTagsExpired) ||
    !isFunction(mod.areTagsStale)
  ) {
    throw new Error('next tags-manifest.external 结构变了，请重新核对失效语义')
  }
  return mod as unknown as TagsManifestModule
}

/**
 * 拿到 FileSystemCache.prototype.revalidateTag。
 * 只调这一个方法，不构造完整实例（构造函数要求磁盘目录等无关依赖）。
 */
function loadCacheHandlerRevalidateTag(): RevalidateTagFn {
  const mod: unknown = require_(
    'next/dist/server/lib/incremental-cache/file-system-cache.js',
  )
  const ctor: unknown =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined
  if (!isFunction(ctor)) {
    throw new Error('next file-system-cache 结构变了，请重新核对失效语义')
  }
  const instance: unknown = Object.create(ctor.prototype)
  if (
    typeof instance !== 'object' ||
    instance === null ||
    !('revalidateTag' in instance) ||
    !isFunction(instance.revalidateTag)
  ) {
    throw new Error('next FileSystemCache.revalidateTag 不存在，请重新核对失效语义')
  }
  const bound = instance.revalidateTag.bind(instance)
  return bound as unknown as RevalidateTagFn
}

/** `revalidation-utils.ts` 只把 profile 的 expire 传给 cache handler，这里如实模拟。 */
function durationsFor(profile: { expire?: number }): { expire?: number } {
  return { expire: profile.expire }
}

const { areTagsExpired, areTagsStale } = loadTagsManifest()
const cacheHandlerRevalidateTag = loadCacheHandlerRevalidateTag()

let tagSeq = 0
function freshTag(): string {
  tagSeq += 1
  return `public:test:immediate-expiry:${tagSeq}`
}

describe('公开目录缓存失效档位', () => {
  it('IMMEDIATE_CACHE_EXPIRE_PROFILE 让 Next 判定为已过期（硬 miss，零陈旧窗口）', async () => {
    const tag = freshTag()
    const entryWrittenAt = Date.now() - 1000

    await cacheHandlerRevalidateTag([tag], durationsFor(IMMEDIATE_CACHE_EXPIRE_PROFILE))

    // areTagsExpired=true → incremental-cache.get 返回 null → unstable_cache 当场回源。
    // 这是本次修复的核心断言：下架后紧接着的一次读就必须拿到新数据。
    expect(areTagsExpired([tag], entryWrittenAt)).toBe(true)
  })

  it("'max' 档位只标记 stale 而不过期——这正是被修掉的陈旧一次行为", async () => {
    const tag = freshTag()
    const entryWrittenAt = Date.now() - 1000

    // Next 内置 max 档位的 expire 是一年；照 revalidation-utils 的算法喂进去。
    await cacheHandlerRevalidateTag([tag], { expire: 60 * 60 * 24 * 365 })

    expect(areTagsExpired([tag], entryWrittenAt)).toBe(false)
    expect(areTagsStale([tag], entryWrittenAt)).toBe(true)
  })

  it('失效之后重新写入的缓存项不会被旧的失效标记误杀', async () => {
    const tag = freshTag()

    await cacheHandlerRevalidateTag([tag], durationsFor(IMMEDIATE_CACHE_EXPIRE_PROFILE))

    // 后台刷新写回的新条目 timestamp 晚于 expiredAt，必须重新可用，
    // 否则每次读都 miss，城市缓存等同于被永久关掉。
    const rewrittenAt = Date.now() + 5
    expect(areTagsExpired([tag], rewrittenAt)).toBe(false)
  })
})
