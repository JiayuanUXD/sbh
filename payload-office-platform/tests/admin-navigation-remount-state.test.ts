import { describe, expect, it } from 'vitest'

import {
  initialCollapsedForMount,
  initialOpenGroupsForMount,
} from '@/domain/admin-navigation/navigation-state'
import type {
  ResolvedAdminNavEntry,
  ResolvedAdminNavGroup,
} from '@/domain/admin-navigation/resolve-navigation'

/**
 * 后台导航在每次路由跳转时都会被 Payload 重新挂载（DOM 节点整个替换，2026-09-11
 * 浏览器实测）。此前初始展开集只含当前激活组，真实展开集要等挂载后的定时器才从
 * localStorage 读回，于是用户展开着的其它组每次点击都「收起再展开」一次，配上
 * 220ms 的面板过渡就是肉眼可见的跳动。
 *
 * 修法是把「首屏水合」与「客户端导航后的重挂载」分开：前者必须与服务端 HTML 逐字
 * 一致，只能给激活组；后者没有水合约束，初始化时就同步读回存储值。本文件钉住
 * 这两条路径的产出，删掉任何一条都不会让别的测试变红。
 */
const group = (id: string, href: string): ResolvedAdminNavGroup => ({
  kind: 'group',
  id,
  label: id,
  icon: 'inbox',
  children: [{ id: `${id}-leaf`, label: `${id}-leaf`, href }],
})

const entries: readonly ResolvedAdminNavEntry[] = [
  group('inbox', '/admin/collections/listing-reviews'),
  group('supply', '/admin/collections/listings'),
  group('crm', '/admin/collections/leads'),
]

describe('initialOpenGroupsForMount', () => {
  it('水合时只含当前激活组，且不读存储（与服务端输出一致）', () => {
    let readCalls = 0
    const open = initialOpenGroupsForMount({
      hydrating: true,
      entries,
      pathname: '/admin/collections/listings',
      readStored: () => {
        readCalls += 1
        return new Set(['inbox', 'crm'])
      },
    })
    expect([...open]).toEqual(['supply'])
    expect(readCalls).toBe(0)
  })

  it('重挂载时用存储集并上当前激活组', () => {
    const open = initialOpenGroupsForMount({
      hydrating: false,
      entries,
      pathname: '/admin/collections/listings',
      readStored: () => new Set(['inbox', 'crm']),
    })
    expect([...open].sort()).toEqual(['crm', 'inbox', 'supply'])
  })

  it('重挂载但没有存储值时回落默认集（并上激活组）', () => {
    const open = initialOpenGroupsForMount({
      hydrating: false,
      entries,
      pathname: '/admin/collections/leads',
      readStored: () => null,
    })
    expect([...open].sort()).toEqual(['crm', 'inbox', 'supply'])
  })

  it('重挂载时存储的是空集（用户全部收起）就照办，只保留激活组', () => {
    const open = initialOpenGroupsForMount({
      hydrating: false,
      entries,
      pathname: '/admin/collections/listings',
      readStored: () => new Set(),
    })
    expect([...open]).toEqual(['supply'])
  })
})

describe('initialCollapsedForMount', () => {
  it('水合时恒为展开，重挂载时取存储值', () => {
    expect(initialCollapsedForMount({ hydrating: true, readStored: () => true })).toBe(false)
    expect(initialCollapsedForMount({ hydrating: false, readStored: () => true })).toBe(true)
    expect(initialCollapsedForMount({ hydrating: false, readStored: () => false })).toBe(false)
  })
})
