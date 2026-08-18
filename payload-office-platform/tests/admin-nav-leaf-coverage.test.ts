/**
 * e2e 的全叶子清单与导航配置保持一致
 *
 * `tests/e2e/admin-navigation.spec.ts` 里的 `ALL_LEAF_LABELS` 是字面量（e2e 不走 `@/`
 * 别名，直接 import 配置不可靠）。字面量的代价是会漂：配置里新增一个入口而清单没跟上，
 * 那个入口就永远不在 e2e 的覆盖范围里——而「入口悄悄消失」正是这条 e2e 要防的事故。
 *
 * 所以在这里把两边钉死：清单必须与 ADMIN_NAV_GROUPS 的叶子集合完全相等。新增导航入口
 * 时这条会红，提示同步清单——这是刻意的摩擦，不是负担。
 *
 * 背景事故：「审核队列」整条入口在线上消失两天无人发现。页面能打开、数据查得出、URL
 * 直达可用，只是侧边栏没有它，而 3200 个单测 + typecheck + lint + 既有 e2e 全绿。
 * 既有的五角色矩阵每个角色只点一个代表性叶子，审核队列不是任何角色的代表。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavItem, AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'

const here = fileURLToPath(new URL('.', import.meta.url))

function isSubgroup(item: AdminNavItem): item is Exclude<AdminNavItem, AdminNavLeaf> {
  return 'children' in item
}

/** 配置里的全部叶子标签（展平子分组） */
function configLeafLabels(): string[] {
  return ADMIN_NAV_GROUPS.flatMap((group) =>
    group.children.flatMap((child) =>
      isSubgroup(child) ? child.children.map((leaf) => leaf.label) : [child.label],
    ),
  )
}

/** 从 e2e spec 源码里取 ALL_LEAF_LABELS 字面量 */
function specLeafLabels(): string[] {
  const src = readFileSync(resolve(here, 'e2e/admin-navigation.spec.ts'), 'utf8')
  const block = /const ALL_LEAF_LABELS = \[([\s\S]*?)\] as const/.exec(src)?.[1]
  expect(block, '未在 e2e spec 里找到 ALL_LEAF_LABELS').toBeTruthy()
  return [...(block ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('admin-nav-leaf-coverage', () => {
  it('e2e 的叶子清单与导航配置完全一致（多一个少一个都算漂移）', () => {
    expect([...specLeafLabels()].sort()).toEqual([...configLeafLabels()].sort())
  })

  it('清单里没有重复项（重复会让「缺失」在断言里被掩盖）', () => {
    const labels = specLeafLabels()
    expect(labels.length).toBe(new Set(labels).size)
  })

  it('审核队列在清单里（那次事故的直接回归）', () => {
    expect(specLeafLabels()).toContain('审核队列')
    expect(configLeafLabels()).toContain('审核队列')
  })
})
