import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 详情页「分享 / 收藏」已关闭（2026-09-19 产品决定）——守卫它不被带回来。
 *
 * 关闭的落点是删除：`ShareSaveActions` 组件、它在房源 / 楼盘两个详情视图标题栏的
 * 挂载、`styles.css` 的 `.share-save-actions*` 块、E2E `detail-share-save.spec.ts`。
 *
 * 为什么要为「没有的东西」写守卫：本仓库多分支并行，基于旧基线的分支在解决
 * `dt-titlebar__actions` 那几行的冲突时最容易把 `<ShareSaveActions … />` 原样保留
 * 下来（组件文件若也一起被恢复，typecheck 不会红）。用读源码断言而不是渲染，
 * 与 `tests/opt083-detail-spec-wiring.test.ts` 同一取舍：要守的是「这行代码在不在」。
 *
 * 会员侧「我的收藏」（`/account/favorites`、`/api/member/favorites`、登录时合并
 * 本地收藏的 `saved-details.ts`）**不在**关闭范围内，本测试刻意不碰。
 */

const SRC = join(process.cwd(), 'src')

const DETAIL_VIEWS: ReadonlyArray<readonly [string, string]> = [
  ['房源详情视图', join(SRC, 'components', 'frontend', 'city', 'CityListingDetailView.tsx')],
  ['楼盘详情视图', join(SRC, 'components', 'frontend', 'building-detail', 'BuildingDetailLayout.tsx')],
]

describe('详情页分享 / 收藏已关闭', () => {
  it.each(DETAIL_VIEWS)('%s 不再挂载 ShareSaveActions', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/import ShareSaveActions/)
    expect(source).not.toMatch(/<ShareSaveActions/)
  })

  it('ShareSaveActions 组件文件与它的 E2E 用例已删除', () => {
    expect(existsSync(join(SRC, 'components', 'frontend', 'ShareSaveActions.tsx'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'tests', 'e2e', 'detail-share-save.spec.ts'))).toBe(false)
  })

  it('styles.css 不再留 .share-save-actions 样式块', () => {
    const css = readFileSync(join(SRC, 'app', '(frontend)', 'styles.css'), 'utf8')
    expect(css).not.toContain('.share-save-actions')
  })
})
