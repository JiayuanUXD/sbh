/**
 * 免审直发「入口」的接线契约（源码级断言）
 *
 * 背景：这个功能的状态机、端点、权限码、迁移、单测早就合进了 master，但**后台没有
 * 任何按钮**——后端全通、CI 全绿、3200 个单测全过，而运营在界面上点不到它。和
 * 「审核队列在侧边栏消失」是同一类事故：功能存在但人碰不到，测试却看不见。
 *
 * 所以这里锁的不是业务规则（那些在 review-status / endpoint 的单测里），而是
 * **入口确实接上了**。
 *
 * 守护不变量：
 *   - 房源编辑页注册了直发 ui 字段（入口存在）
 *   - importMap 收录了该组件（漏了会让整个 /admin 白屏，本仓库的老坑）
 *   - 可见性在服务端判定：权限两道 + 状态机，不在客户端复制规则
 *   - 客户端发的是 fast_track，且把 422 的缺失项摊开
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string) => readFile(resolve(ROOT, p), 'utf8')

describe('fast-track-entry/入口接线', () => {
  it('房源编辑页注册了直发 ui 字段', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).toContain("Field: '/components/admin/ListingFastTrackAction'")
  })

  it('importMap 收录了该组件（漏了 /admin 会整页白屏）', async () => {
    const map = await read('src/app/(payload)/admin/importMap.js')
    expect(map).toContain('components/admin/ListingFastTrackAction')
    expect(map).toContain('/components/admin/ListingFastTrackAction#default')
  })
})

describe('fast-track-entry/可见性在服务端判定', () => {
  it('服务端组件同时校验 listing:review 与 listing:fast_track_review', async () => {
    const src = await read('src/components/admin/ListingFastTrackAction.tsx')
    expect(src).toContain("hasOperationPermission(ctx, 'listing:review')")
    expect(src).toContain("hasOperationPermission(ctx, 'listing:fast_track_review')")
  })

  it('状态门走状态机而不是手写状态字面量比较', async () => {
    const src = await read('src/components/admin/ListingFastTrackAction.tsx')
    // 手写 `x === 'not_submitted' || x === 'rejected'` 会与 TRANSITIONS 表漂移
    expect(src).toContain("canTransitionReview(reviewStatus, 'fast_track')")
  })

  it('新建未保存房源（无 id）不渲染入口', async () => {
    const src = await read('src/components/admin/ListingFastTrackAction.tsx')
    expect(src).toMatch(/docId === undefined \|\| docId === null \|\| docId === ''\) return null/)
  })
})

describe('fast-track-entry/客户端只触发不判规则', () => {
  it('发的是 fast_track 决策', async () => {
    const src = await read('src/components/admin/ListingFastTrackActionClient.tsx')
    expect(src).toContain("decision: 'fast_track'")
    expect(src).toContain('/api/listings/${listingId}/review')
  })

  it('422 时把缺失项摊开，而不是只报一句失败', async () => {
    const src = await read('src/components/admin/ListingFastTrackActionClient.tsx')
    expect(src).toContain("data.code === 'INCOMPLETE_LISTING'")
    expect(src).toContain('setMissing(data.missing ?? [])')
  })

  it('不在客户端复制完整度规则（不 import 校验函数）', async () => {
    const src = await read('src/components/admin/ListingFastTrackActionClient.tsx')
    expect(src).not.toContain('checkListingCompleteness')
    expect(src).not.toContain('getSubmitRequiredFields')
  })
})
