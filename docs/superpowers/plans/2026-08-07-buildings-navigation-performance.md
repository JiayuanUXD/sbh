# 首页访问楼盘列表性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首页进入楼盘列表以及楼盘筛选、分页的缓存命中请求不再重复执行约 0.82 秒的在租面积聚合 SQL，同时保持页面数据与交互不变。

**Architecture:** 在现有前台缓存查询模块中增加无参数的楼盘搜索缓存封装，复用 Public Catalog `searchBuildings` 结果；缓存同时依赖楼盘和房源类别标签，并以领域事件 tag 作为主要即时失效机制、以 300 秒作为额外重新验证阈值。楼盘列表 Server Component 继续负责 URL 筛选和内存分页，只把直接 Facade 调用替换为缓存封装。超过阈值的首个请求可能返回旧值并后台刷新，后续请求获得新值，因此不承诺严格五分钟陈旧上限；这是用户选择的访问速度优先权衡。

**Tech Stack:** Next.js 16 App Router、React Server Components、TypeScript、Next.js `unstable_cache`、Vitest、pnpm、PostgreSQL/Payload CMS。

## Global Constraints

- 公共供给由领域事件 tag 主要负责即时失效；`revalidate: 300` 是 stale-while-revalidate 的重新验证阈值，不是五分钟硬过期或严格陈旧上限。
- React 页面只消费 Public Catalog DTO，不直接调用 Payload 或拼接查询条件。
- 保留 `/buildings` 的 URL 筛选、分页、Metadata、空状态和 `force-dynamic` 语义。
- 缓存必须同时绑定 `public:buildings` 和 `public:listings`，因为结果包含楼盘数据和房源聚合面积。
- 不重写 SQL、不增加索引或物化视图、不修改 Collection、迁移或生产数据。
- 使用 pnpm；先见 RED 再写生产代码，不删除或跳过失败测试。
- 当前工作树包含 OPT-023/OPT-024 用户修改，禁止覆盖或混入无关改动。
- 未获得新的明确授权，不执行 `git commit` 或 `git push`。

---

## File Structure

- Create `payload-office-platform/tests/buildings-navigation-performance-contract.test.ts`: 守护缓存配置和楼盘页接入边界。
- Modify `payload-office-platform/src/lib/frontend/cached-queries.ts`: 导出 `getCachedSearchBuildings(): Promise<BuildingSearchResult>` 缓存封装。
- Modify `payload-office-platform/src/app/(frontend)/buildings/page.tsx`: 使用缓存封装替代直接 `searchBuildings`。
- Create `specs/work-items/OPT-025-buildings-navigation-performance.md`: 记录目标、范围、检查项和最终结果。
- Create `artifacts/verification/OPT-025/README.md`: 保存 RED/GREEN、类型、构建、HTTP 与浏览器证据。

### Task 1: 用合同测试锁定缓存与页面接入

**Files:**
- Create: `payload-office-platform/tests/buildings-navigation-performance-contract.test.ts`
- Test: `payload-office-platform/tests/buildings-navigation-performance-contract.test.ts`

**Interfaces:**
- Consumes: `src/lib/frontend/cached-queries.ts` 与 `src/app/(frontend)/buildings/page.tsx` 的源文件。
- Produces: 两条合同——缓存封装必须调用 `searchBuildings`、绑定双标签并设置 `revalidate: 300`；页面必须只调用 `getCachedSearchBuildings`。

- [ ] **Step 1: 写入失败合同测试**

```ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')

describe('OPT-025 楼盘列表导航性能合同', () => {
  it('楼盘搜索缓存使用固定键、依赖楼盘与房源，并设置 300 秒重新验证阈值', async () => {
    const source = await readFile(
      resolve(ROOT, 'src/lib/frontend/cached-queries.ts'),
      'utf8',
    )
    const wrapper = source.match(
      /export const getCachedSearchBuildings = unstable_cache\([\s\S]*?\n\)/,
    )?.[0]

    expect(wrapper).toBeDefined()
    expect(wrapper).toContain('searchBuildings(defaultCtx())')
    expect(wrapper).toMatch(/\[\s*['"]search-buildings['"]\s*\]/)
    expect(wrapper).toContain('BUILDINGS_CATEGORY_TAG')
    expect(wrapper).toContain('LISTINGS_CATEGORY_TAG')
    expect(wrapper).toMatch(/revalidate:\s*300/)
  })

  it('楼盘列表页面使用缓存查询且不直接创建搜索上下文', async () => {
    const source = await readFile(
      resolve(ROOT, 'src/app/(frontend)/buildings/page.tsx'),
      'utf8',
    )

    expect(source).toContain("import { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'")
    expect(source).toContain('await getCachedSearchBuildings()')
    expect(source).not.toContain('defaultSearchContext')
    expect(source).not.toMatch(/\bsearchBuildings\s*\(/)
  })
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd payload-office-platform && pnpm exec vitest run tests/buildings-navigation-performance-contract.test.ts`

Expected: FAIL；第一条找不到 `getCachedSearchBuildings`，第二条仍发现直接 `searchBuildings`/`defaultSearchContext`。

- [ ] **Step 3: 检查失败只来自缺失功能**

确认没有路径、编码或 Vitest 配置错误。若正则未截取完整 wrapper，调整正则但不降低双标签和 300 秒断言。

### Task 2: 实现楼盘搜索缓存并接入页面

**Files:**
- Modify: `payload-office-platform/src/lib/frontend/cached-queries.ts:29-46,186-210`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/page.tsx:9-13,40-42`
- Test: `payload-office-platform/tests/buildings-navigation-performance-contract.test.ts`

**Interfaces:**
- Consumes: `searchBuildings(ctx)`、`defaultCtx()`、`BUILDINGS_CATEGORY_TAG`、`LISTINGS_CATEGORY_TAG`。
- Produces: `getCachedSearchBuildings(): Promise<BuildingSearchResult>`，无业务入参，缓存键为 `['search-buildings']`。

- [ ] **Step 1: 在缓存模块导入并封装楼盘搜索**

在 `@/domain/public-catalog` 导入列表中加入 `searchBuildings`，并在楼盘详情缓存前加入：

```ts
/**
 * 楼盘搜索结果（全量楼盘 + 在租面积聚合）
 *
 * tags：buildings 类别 + listings 类别
 * 失效触发：building.* / listing.* 事件；300 秒兜底重新验证
 */
export const getCachedSearchBuildings = unstable_cache(
  async () => {
    return searchBuildings(defaultCtx())
  },
  ['search-buildings'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      LISTINGS_CATEGORY_TAG,
    ],
    revalidate: 300,
  },
)
```

- [ ] **Step 2: 让楼盘列表页面只调用缓存封装**

删除页面对 `defaultSearchContext` 和 `searchBuildings` 的导入，加入：

```ts
import { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'
```

将查询替换为：

```ts
const result = await getCachedSearchBuildings()
const { docs: allDocs } = result
```

- [ ] **Step 3: 运行新增测试确认 GREEN**

Run: `cd payload-office-platform && pnpm exec vitest run tests/buildings-navigation-performance-contract.test.ts`

Expected: PASS，2 tests passed。

- [ ] **Step 4: 运行相关缓存回归测试**

Run: `cd payload-office-platform && pnpm exec vitest run tests/public-catalog-cache-invalidator.test.ts tests/cache-next-adapter-integration.test.ts tests/f7-4-6-performance-data-equivalence.test.ts tests/buildings-navigation-performance-contract.test.ts`

Expected: 全部 PASS；缓存失效标签和既有缓存合同无回归。

- [ ] **Step 5: 检查差异边界**

Run: `cd payload-office-platform && git diff --check && git diff -- src/lib/frontend/cached-queries.ts 'src/app/(frontend)/buildings/page.tsx' tests/buildings-navigation-performance-contract.test.ts`

Expected: `git diff --check` 无输出；差异只包含缓存封装、页面调用和合同测试，不改变页面筛选、分页或视觉。

### Task 3: 静态、构建、性能与浏览器验收

**Files:**
- Create: `artifacts/verification/OPT-025/README.md`
- Modify: `specs/work-items/OPT-025-buildings-navigation-performance.md`

**Interfaces:**
- Consumes: 已实现的 `getCachedSearchBuildings()` 与运行中的本地站点。
- Produces: 可复核的自动化、TTFB、浏览器、控制台和未验证项证据。

- [ ] **Step 1: 运行 TypeScript 检查**

Run: `cd payload-office-platform && pnpm exec tsc --noEmit --pretty false`

Expected: exit 0，无 TypeScript 错误。

- [ ] **Step 2: 运行生产构建**

Run: `cd payload-office-platform && pnpm build`

Expected: exit 0，`/buildings` 构建成功；不新增构建告警。

- [ ] **Step 3: 测量缓存命中 TTFB**

对同一生产构建服务连续请求 `/buildings` 至少三次，并同时请求 `/buildings?page=2`：

```bash
curl -sS -o /dev/null -w 'buildings %{time_starttransfer} %{time_total}\n' http://localhost:3717/buildings
curl -sS -o /dev/null -w 'buildings %{time_starttransfer} %{time_total}\n' http://localhost:3717/buildings
curl -sS -o /dev/null -w 'page2 %{time_starttransfer} %{time_total}\n' 'http://localhost:3717/buildings?page=2'
```

Expected: 首次允许生成缓存；后续 `/buildings` 与 `?page=2` 复用同一缓存结果，不再稳定承担基线约 818–834ms 的聚合时间。记录实际数字，不伪造固定阈值。

- [ ] **Step 4: 真实浏览器验证**

依次验证：

1. 首页 `/` 点击“找写字楼”进入 `/buildings`，楼盘数量和卡片正常。
2. 在 `/buildings` 切换一个区域或等级筛选，再访问分页（若当前数据产生第二页），URL 与结果同步。
3. 打开相邻前台路由 `/listings`，确认导航与页面正常。
4. 检查目标页和相邻页控制台，无新增 error。
5. 至少覆盖 375×812、768×1024、1440×900、1920×1080；本次无视觉改动，可用布局与可操作性检查记录结果。

Expected: 数据与优化前一致，筛选/分页不回归，无新增控制台错误。

- [ ] **Step 5: 更新任务与证据**

在 `artifacts/verification/OPT-025/README.md` 写入：根因分段测量、RED/GREEN 命令与结果、相关测试、TypeScript、构建、连续 TTFB、浏览器路由/视口/控制台、未验证项和剩余风险。仅在证据实际通过后勾选 `specs/work-items/OPT-025-buildings-navigation-performance.md` 对应检查项。

- [ ] **Step 6: 完成前验证并等待提交授权**

Run: `cd payload-office-platform && git status --short --branch && git diff --check`

Expected: OPT-025 文件与已知 OPT-023/OPT-024 修改均可辨识，无空白错误。不要提交或推送；向用户报告结果并等待明确授权。
