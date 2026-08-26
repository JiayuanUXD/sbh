import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { shouldDeferToDefaultListView } from '@/components/admin/list-view-context'

/**
 * 自定义列表视图的「渲染上下文」契约（OPT-056，PR 评审发现）。
 *
 * `views.list.Component` 不只用于整页列表——Payload 3.86 还在这两处渲染同一个覆盖：
 *
 *   1. `/admin/collections/<slug>/trash`：`CollectionTrash` 调 `renderListView`，
 *      仅把 `viewType` 换成 `'trash'`。覆盖组件若照常查活跃文档，回收站会显示
 *      未删除的记录且没有恢复入口——**这条已在浏览器实测复现过**。
 *   2. 关系字段的列表抽屉（`appearance: 'drawer'`）：`renderListHandler` 带
 *      `drawerSlug` / `enableRowSelections` 调同一入口，并显式传
 *      `disableBulkDelete: true` + `disableBulkEdit: true`。覆盖组件若渲染普通
 *      编辑链接，抽屉里选不中任何记录。
 *
 * 两处都**不会报错**：页面照常渲染，只是内容或交互是错的——正是需要测试守的形态。
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8')

const LIST_VIEWS = [
  { label: '房源列表', path: '../src/components/admin/ListingsListView.tsx' },
  { label: '楼盘库', path: '../src/components/admin/BuildingsListView.tsx' },
] as const

const LIST_CLIENTS = [
  { label: '房源列表', path: '../src/components/admin/ListingsListViewClient.tsx', title: '房源列表' },
  { label: '楼盘库', path: '../src/components/admin/BuildingsListViewClient.tsx', title: '楼盘库' },
] as const

describe('shouldDeferToDefaultListView', () => {
  it('整页列表：自己接管', () => {
    expect(shouldDeferToDefaultListView({ viewType: 'list' })).toBe(false)
  })

  it('回收站等非 list 视图：让位给原生（否则显示活跃文档、且没有恢复流程）', () => {
    expect(shouldDeferToDefaultListView({ viewType: 'trash' })).toBe(true)
  })

  it('关系抽屉：让位给原生（否则抽屉里选不中记录）', () => {
    expect(
      shouldDeferToDefaultListView({
        disableBulkDelete: true,
        disableBulkEdit: true,
        viewType: 'list',
      }),
    ).toBe(true)
  })

  it('只有单个批量开关为真不算抽屉信号（collection 也可能自己关掉其中一个）', () => {
    expect(
      shouldDeferToDefaultListView({ disableBulkDelete: true, viewType: 'list' }),
    ).toBe(false)
    expect(
      shouldDeferToDefaultListView({ disableBulkEdit: true, viewType: 'list' }),
    ).toBe(false)
  })
})

describe('自定义列表视图接入了上下文让位', () => {
  for (const { label, path } of LIST_VIEWS) {
    it(`${label} 在渲染自身之前先判定是否让位`, () => {
      const source = read(path)
      expect(source).toMatch(/shouldDeferToDefaultListView\(props\)/)
      expect(source).toMatch(/renderDefaultListView\(props\)/)
      // 让位必须发生在取数之前，否则回收站/抽屉仍会打出多余的查询
      const deferIndex = source.indexOf('shouldDeferToDefaultListView')
      const findIndex = source.indexOf('payload.find')
      expect(deferIndex).toBeGreaterThan(-1)
      expect(findIndex).toBeGreaterThan(deferIndex)
    })
  }
})

describe('自定义列表页保留 h1 标题', () => {
  // 用户要去掉的是原生的「所有 X / 垃圾箱」标签条，不是页面标题。
  // 标题同时是可访问性地标，也是 admin-navigation.spec.ts 角色矩阵判断
  // 「是否真的进到了目标页」的依据（getByRole('heading', { level: 1 })）。
  for (const { label, path, title } of LIST_CLIENTS) {
    it(`${label} 渲染 <h1>${title}</h1>`, () => {
      const source = read(path)
      expect(source).toMatch(new RegExp(`<h1[^>]*>${title}</h1>`))
    })
  }
})
