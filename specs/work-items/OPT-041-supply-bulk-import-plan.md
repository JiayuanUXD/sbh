# OPT-041 后台批量导入楼盘 / 房源 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或
> `superpowers:executing-plans` 逐任务实施。步骤用 `- [ ]` 复选框跟踪。
>
> 规格（唯一需求事实源）：[`OPT-041-supply-bulk-import.md`](./OPT-041-supply-bulk-import.md)。
> 本计划只负责"怎么做"，任何与规格冲突之处以规格为准。

**Goal：** 给后台加两个批量导入入口（楼盘 / 房源），把运营手工整理的 Excel/CSV 经
「预检 → 确认 → 后台写入」变成库里的主数据，并保留按批次一键止血的能力。

**Architecture：** 五层单向依赖，只有最后一层碰库——
`workbook`(IO) → `normalize`(纯) → `resolve-refs`(纯 + 注入查询) → `row-schema`(纯) → `import-task`(Local API)。
预检同步执行且不写业务表，结果落 `supply-import-batches` 快照；确认后入 Jobs Queue 分片写入。

**Tech Stack：** Next.js 16 + Payload 3.86 + PostgreSQL（`push:false`，只走显式迁移）、
Payload Jobs Queue（`autoRun` 已开）、Arco Design（后台 UI）、Vitest（单测）、Playwright（E2E）、
**exceljs**（新增依赖，见下）。

---

## Global Constraints

以下约束对**每个任务**都生效，不在单个任务里重复。

- 包管理器固定 **pnpm**；不得用 npm/yarn 改写 `pnpm-lock.yaml`。
- **禁止** `any` / `as any` / `@ts-ignore` / `@ts-nocheck`。外部输入（上传文件、HTTP body、
  查询参数）一律以 `unknown` 进入，由纯函数 schema 收口。
- 权限在**服务端**执行；隐藏 UI 不是权限控制。直接打 API 无权必须 403。
- **不得物理删除**已引用主数据与业务历史。回滚 = 改 `publicationStatus`，不是 `delete`。
- 改 collection 配置后**必须** `pnpm exec payload migrate:create` 生成迁移并提交
  `src/migrations/`；**迁移文件正文绝不可手改**。`.githooks/pre-commit` 会拦"改了 collection 没带迁移"。
- 新增 client 组件 / 改 `payload.config.ts` 后**必须** `pnpm payload generate:importmap`，
  否则整个 `/admin` SPA hydration 白屏（HTML 与 JS 全 200，极难诊断）。
- 提交只用**显式 `git add <具体路径>`**；禁用 `git add -A` / `git add .` / `git commit -am`。
- 本地必须 `DATABASE_URL=postgres://...`（无 SQLite 回退）；多 worktree 用独立库与独立 `PORT`。
- 测试放 `tests/*.test.ts`（Vitest，node 环境，`@` alias → `src/`）；E2E 放 `tests/e2e/*.spec.ts`。
- 需要真库的单测统一用既有守卫写法：
  ```ts
  const databaseAvailable =
    typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')
  describe.skipIf(!databaseAvailable)('...', () => { /* ... */ })
  ```
- 文档、注释、提交信息里的中文一律**简体中文**。
- 提交信息类型前缀与分支类型一致：`feat` / `fix` / `test` / `docs` / `chore`。

### 新增依赖决策（实施前需用户确认）

需要一个既能**读** .xlsx/.csv、又能**写** .xlsx（模板、错误表、楼盘对照表）的库。仓库现无任何表格库。

**选 `exceljs`。** 理由：读写双向、纯 JS 无原生扩展（不影响 Dockerfile 构建）、维护活跃。
**不选 SheetJS (`xlsx`)**：npm 上的版本停在 0.18.5，带未修复的原型污染
CVE-2023-30533，作者已把新版本迁出 npm registry，装它等于给 `quality.yml` 埋一条永久告警。
**不选"只支持 CSV、零依赖"**：运营的 Excel 另存为 CSV 在 Windows 下默认 GBK，
中文表头直接乱码，等于把编码坑转嫁给运营。

```bash
cd payload-office-platform && pnpm add exceljs
```

装完确认 `pnpm-lock.yaml` 与 `package.json` 一起提交，并本地跑一次 `pnpm build`
确认 Turbopack 能打包（exceljs 只在服务端使用，不进客户端 bundle）。

---

## File Structure

### 新建

| 文件 | 职责 |
|---|---|
| `src/domain/supply-import/types.ts` | 共享类型：`RawRow` / `RowError` / `ValidBuildingRow` / `ValidListingRow` / `PreflightReport` |
| `src/domain/supply-import/normalize.ts` | 文本规范化纯函数（空白 / 全半角 / 城市后缀 / 数值单位） |
| `src/domain/supply-import/resolve-refs.ts` | 文本 → Location / Building ID，含别名表与候选建议；查询经 port 注入 |
| `src/domain/supply-import/building-row.ts` | 楼盘行校验：`RawRow → ValidBuildingRow \| RowError[]` |
| `src/domain/supply-import/listing-row.ts` | 房源行校验：`RawRow → ValidListingRow \| RowError[]` |
| `src/domain/supply-import/duplicate-check.ts` | 批内编号查重（两种导入共用，端点层不许重写） |
| `src/domain/supply-import/workbook.ts` | exceljs 读写：解析上传文件、生成模板、生成错误表、生成楼盘对照表 |
| `src/domain/supply-import/import-task.ts` | Jobs Queue task：分片写入、幂等、进度、超时恢复 |
| `src/domain/supply-import/batch-rollback.ts` | 按批次下架（房源 `publicationStatus=unpublished`） |
| `src/domain/supply-import/index.ts` | 对外 re-export |
| `src/collections/SupplyImportBatches.ts` | 导入批次集合 |
| `src/collections/LocationAliases.ts` | 地理别名集合 |
| `src/endpoints/bulk-import-endpoint.ts` | 六个路由（预检 / 执行 / 轮询 / 错误表 / 模板 / 对照表）+ Task 9 追加回滚 |
| `src/components/admin/bulk-import/BulkImportView.tsx` | Server component：按 pathname 解析模式 + 权限守卫 |
| `src/components/admin/bulk-import/BulkImportViewClient.tsx` | Client：上传 → 报告 → 轮询 → 结果 → 回滚 |
| `src/components/admin/bulk-import/require-import-access.tsx` | 视图级权限守卫（对齐 `require-geography-access.tsx`） |

### 修改

| 文件 | 改动 |
|---|---|
| `src/collections/Listings.ts:820` | `dataSource.source` options 增 `manual-import` |
| `src/collections/Buildings.ts` | 新增 `dataSource` group（与 Listings 同构） |
| `src/payload.config.ts:292` | `endpoints` 展开 `createBulkImportEndpoints()` |
| `src/payload.config.ts:205` | `admin.components.views` 增 `BulkImportBuildings` / `BulkImportListings` |
| `src/payload.config.ts:117` | `jobs.tasks` 增 `supplyImportTask`；`jobs.autoRun` 增导入队列 |
| `src/components/admin/AdminNavigation` | 供给分组下加两个入口 |
| `src/app/(payload)/admin/importMap.js` | 由 `pnpm payload generate:importmap` 重生成 |

### 复用（不要重写）

| 既有资产 | 用途 |
|---|---|
| `normalizeBuildingName()` (`src/domain/supply/building-dedup.ts:66`) | 楼盘名规范化（全半角 + 折叠空白 + 小写）。**别再写第二份** |
| `slugify()` (`src/domain/shared/slug.ts`) | 从名称/标题生成 slug（pinyin-pro） |
| `requireOperationPermission(req, code)` (`src/domain/auth/access.ts:118`) | endpoint 权限守卫，抛 `ForbiddenError` |
| `canReadByCity(ctx, cityId)` (`src/domain/auth/access.ts:182`) | OPS 城市范围判定 |
| `createCollectionAccess({...})` (`src/domain/auth/access.ts:221`) | 新集合的 access 配置 |
| `writeAuditSuccess` / `writeAuditFailed` (`src/domain/audit/audit-writer.ts:157`) | 审计写入 |
| 权限码 `data:import`（`src/domain/auth/permission-codes.ts:133`） | **已存在**，只需迁移授予角色 |
| 审计动作 `data.import`（`DATA_AUDIT_ACTIONS`，`audit-types.ts:92`） | **已存在**，直接用 |
| `LOCATION_TYPES` (`src/domain/geography/location-hierarchy.ts:19`) | `city` / `district` / `business_area` / `metro_line` / `metro_station` |
| `PUBLICATION_STATUSES` (`src/domain/review/publication-status.ts`) | `draft` / `published` / `unpublished` / `leased` / `sold` |
| `REVIEW_STATUSES` (`src/domain/review/review-status.ts`) | `not_submitted` / `pending` / `approved` / `rejected` |
| `recoverStaleCityPartnerNotificationJobs`（`application-notify.ts`） | 超时恢复的参照实现 |
| `isUniqueViolation`（`submission-notify.ts:64`） | PG `23505` 判定的参照实现 |

### 依赖顺序

```
T1 集合与迁移 ─┬─────────────────┐
T2 规范化 ─────┤                 │
               ├─ T4 行校验 ─┐   │
T3 关系解析 ───┘             ├── T6 预检端点 ── T7 写入 Job ── T8 视图 ── T9 回滚 ── T10 E2E
T5 工作簿读写 ───────────────┘
```

T1 / T2 / T3 / T5 互不依赖，可并行。T3 用注入的 port，不依赖 T1 的集合真实存在。

---

### Task 1: 集合、字段与迁移

**Files:**
- Create: `src/collections/SupplyImportBatches.ts`
- Create: `src/collections/LocationAliases.ts`
- Modify: `src/collections/Listings.ts:820`（`dataSource.source` options）
- Modify: `src/collections/Buildings.ts`（新增 `dataSource` group）
- Modify: `src/payload.config.ts`（`collections` 数组注册两个新集合）
- Create: `src/migrations/<时间戳>_supply_import_batches.ts`（生成物）
- Create: `src/migrations/<时间戳>_supply_import_unique_indexes.ts`（手写）
- Create: `src/migrations/<时间戳>_supply_import_role_permissions.ts`（手写，参照
  `src/migrations/20260810_090000_supply_submission_role_permissions.ts`）
- Test: `tests/supply-import-collections.test.ts`

**Interfaces:**
- Produces：collection slug `supply-import-batches`、`location-aliases`；
  `Buildings.dataSource.{source,externalId,syncedAt,sourceUrl}`；
  `Listings.dataSource.source` 新增枚举值 `manual-import`；
  `export const SUPPLY_IMPORT_BATCH_STATUSES: readonly string[]`；
  `export const LOCATION_ALIAS_KINDS: readonly string[]`。
  后续任务通过 `payload.find({ collection: 'supply-import-batches' })` 访问。

- [ ] **Step 1: 写失败测试——契约断言**

`tests/supply-import-collections.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import { SupplyImportBatches } from '@/collections/SupplyImportBatches'
import { LocationAliases } from '@/collections/LocationAliases'
import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'

/** 从 collection 配置里按 name 深度查找字段（跨 tabs / row / group）。 */
function findField(fields: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(fields)) return null
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as Record<string, unknown>
    if (field.name === name) return field
    for (const key of ['fields', 'tabs']) {
      const nested = findField(field[key], name)
      if (nested) return nested
    }
  }
  return null
}

describe('OPT-041 导入相关集合契约', () => {
  it('supply-import-batches 的 status 覆盖全部五个状态', () => {
    expect(SupplyImportBatches.slug).toBe('supply-import-batches')
    const status = findField(SupplyImportBatches.fields, 'status')
    const values = (status?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['preflight', 'queued', 'running', 'completed', 'failed'])
  })

  it('location-aliases 的 kind 与 LOCATION_TYPES 对齐（不含 metro_line）', () => {
    const kind = findField(LocationAliases.fields, 'kind')
    const values = (kind?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['city', 'district', 'business_area', 'metro_station'])
  })

  it('Listings.dataSource.source 增加 manual-import', () => {
    const source = findField(Listings.fields, 'source')
    const values = (source?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toContain('manual-import')
    expect(values).toContain('huizuxuanzhi')
  })

  it('Buildings 拥有与 Listings 同构的 dataSource 组', () => {
    for (const name of ['source', 'externalId', 'syncedAt', 'sourceUrl']) {
      expect(findField(Buildings.fields, name), `Buildings 缺 ${name}`).not.toBeNull()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-collections.test.ts
```

预期：FAIL，`Cannot find module '@/collections/SupplyImportBatches'`。

- [ ] **Step 3: 写 `SupplyImportBatches.ts`**

```ts
import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'

export const SUPPLY_IMPORT_BATCH_STATUSES = [
  'preflight',
  'queued',
  'running',
  'completed',
  'failed',
] as const

export const SupplyImportBatches: CollectionConfig = {
  slug: 'supply-import-batches',
  labels: { singular: '导入批次', plural: '导入批次' },
  admin: {
    useAsTitle: 'fileName',
    defaultColumns: ['fileName', 'type', 'status', 'createdAt'],
  },
  access: {
    ...createCollectionAccess({
      read: 'data:import',
      create: 'data:import',
      update: 'data:import',
    }),
    // 业务历史不可物理删除（AGENTS.md 第 4 条）。
    // **必须写字面量 false，不能用 createCollectionAccess 传一个不存在的权限码**——
    // hasOperationPermission 对持有通配符 `*` 的角色一律放行，假权限码根本关不死。
    // 这与 AuditLogs.ts:79 / SupplySubmissions.ts:82 的既有写法一致。
    delete: () => false,
  },
  fields: [
    {
      name: 'type',
      label: '导入对象',
      type: 'select',
      required: true,
      options: [
        { label: '楼盘', value: 'buildings' },
        { label: '房源', value: 'listings' },
      ],
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'preflight',
      options: [
        { label: '预检完成', value: 'preflight' },
        { label: '排队中', value: 'queued' },
        { label: '写入中', value: 'running' },
        { label: '已完成', value: 'completed' },
        { label: '失败', value: 'failed' },
      ],
    },
    { name: 'operator', label: '操作者', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'city', label: '归属城市', type: 'relationship', relationTo: 'locations', admin: { readOnly: true } },
    { name: 'fileName', label: '文件名', type: 'text', admin: { readOnly: true } },
    { name: 'rowCount', label: '总行数', type: 'number', admin: { readOnly: true } },
    {
      name: 'validRows',
      label: '通过行快照',
      type: 'json',
      admin: { readOnly: true, description: '完成 7 天后由清理任务置空' },
    },
    { name: 'rowErrors', label: '错误行', type: 'json', admin: { readOnly: true } },
    {
      name: 'stats',
      label: '统计',
      type: 'group',
      fields: [
        { name: 'processed', label: '已处理', type: 'number', defaultValue: 0 },
        { name: 'created', label: '新建', type: 'number', defaultValue: 0 },
        { name: 'updated', label: '更新', type: 'number', defaultValue: 0 },
        { name: 'failed', label: '失败', type: 'number', defaultValue: 0 },
      ],
    },
    {
      name: 'affectedIds',
      label: '影响对象 ID',
      type: 'json',
      admin: { readOnly: true, description: '回滚锚点' },
    },
    { name: 'startedAt', label: '开始写入时间', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', label: '完成时间', type: 'date', admin: { readOnly: true } },
  ],
}
```

- [ ] **Step 4: 写 `LocationAliases.ts`**

```ts
import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { normalizeAliasText } from '@/domain/supply-import/normalize'

/** 别名只覆盖导入表里会出现的四类；metro_line 运营不会手填，不开放。 */
export const LOCATION_ALIAS_KINDS = ['city', 'district', 'business_area', 'metro_station'] as const

export const LocationAliases: CollectionConfig = {
  slug: 'location-aliases',
  labels: { singular: '地理别名', plural: '地理别名' },
  admin: { useAsTitle: 'alias', defaultColumns: ['alias', 'kind', 'location'] },
  access: createCollectionAccess({
    read: 'data:import',
    create: 'location:manage',
    update: 'location:manage',
    delete: 'location:manage',
  }),
  hooks: {
    // 规范化在入库前完成：查询侧只用规范化值做等值匹配，不做运行时转换
    beforeValidate: [
      ({ data }) => {
        if (data && typeof data.alias === 'string') {
          data.normalizedAlias = normalizeAliasText(data.alias)
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'alias', label: '别名（原样）', type: 'text', required: true },
    {
      name: 'normalizedAlias',
      label: '规范化别名',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true, description: '由 alias 自动派生，导入匹配用的就是它' },
    },
    {
      name: 'kind',
      label: '类型',
      type: 'select',
      required: true,
      options: [
        { label: '城市', value: 'city' },
        { label: '行政区', value: 'district' },
        { label: '商圈', value: 'business_area' },
        { label: '地铁站', value: 'metro_station' },
      ],
    },
    { name: 'location', label: '指向区域', type: 'relationship', relationTo: 'locations', required: true },
  ],
  indexes: [{ fields: ['normalizedAlias', 'kind'], unique: true }],
}
```

- [ ] **Step 5: 改 Listings 与 Buildings**

`src/collections/Listings.ts:820` 的 `source` options 改成：

```ts
options: [
  { label: '汇租选址', value: 'huizuxuanzhi' },
  { label: '批量导入', value: 'manual-import' },
],
```

`dataSource` group **抽成共享字段工厂，不要把 Listings 的 40 行复制一份到 Buildings**
（控制端与用户于 2026-08-22 裁定：逐字复制会被评审判为重复代码，且 dataSource 将来改动
必然漏改一处——本仓库已吃过枚举双份定义的亏）。

新建 `src/domain/supply-import/data-source-field.ts`：

```ts
import type { Field } from 'payload'

// Listings.ts:172 里的 COL_4 是该文件的局部 const（值为 '25%'），没有导出。
// 本工厂自带一份同值常量，不去改 Listings 的导出面——那超出本任务范围。
const COL_4 = '25%'

/**
 * 「数据来源」字段组（Listings 与 Buildings 共用）。
 *
 * 抽成工厂而非各写一份：两处的字段结构必须逐字一致，否则
 * (dataSource.source, dataSource.externalId) 的幂等语义会在两个集合间漂移。
 * 只有 admin.description 里的主语不同。
 */
export function createDataSourceGroup(subject: '房源' | '楼盘'): Field {
  return {
    name: 'dataSource',
    label: '数据来源',
    type: 'group',
    admin: {
      hideGutter: true,
      // 仅外部来源已有数据时显示；手工新建的对象不需要维护此组字段
      condition: (data) => {
        const ds = data?.dataSource as
          | { source?: string | null; externalId?: string | null; sourceUrl?: string | null; syncedAt?: string | null }
          | null
          | undefined
        return Boolean(ds && (ds.source || ds.externalId || ds.sourceUrl || ds.syncedAt))
      },
    },
    fields: [
      {
        type: 'row',
        fields: [
          {
            name: 'source',
            label: '来源平台',
            type: 'select',
            options: [
              { label: '汇租选址', value: 'huizuxuanzhi' },
              { label: '批量导入', value: 'manual-import' },
            ],
            admin: { description: '外部抓取或批量导入来源标识', width: COL_4 },
          },
          {
            name: 'externalId',
            label: '外部 ID',
            type: 'text',
            admin: { description: `源平台或导入表里的原始${subject}编号`, width: COL_4 },
          },
          {
            name: 'syncedAt',
            label: '同步时间',
            type: 'date',
            admin: { readOnly: true, description: '最后一次同步/导入的时间', width: COL_4 },
          },
          {
            name: 'sourceUrl',
            label: '源地址',
            type: 'text',
            admin: { description: '详情页原始 URL', width: COL_4 },
          },
        ],
      },
    ],
  }
}
```

然后：

- `src/collections/Listings.ts:794-834` 的内联 group **整段替换**为 `createDataSourceGroup('房源')`
  （连带 Step 5 开头那处 `source` options 的改动一并由工厂承担，不要再改两遍）。
- `src/collections/Buildings.ts` 在「基础信息」tab 末尾加 `createDataSourceGroup('楼盘')`。

**验证工厂输出与原定义等价**：Step 8 生成迁移后，确认 `listings` 表**只有**
`enum_listings_data_source_source` 增加枚举值这一处变化，**没有**任何列的增删改。
若出现多余的列变更，说明工厂写得与原定义不一致，回去对齐后重新生成迁移，
**不要接受多余的迁移**。

- [ ] **Step 6: 在 payload.config 注册集合**

`src/payload.config.ts` 的 `collections` 数组加 `SupplyImportBatches` 与 `LocationAliases`，
并在文件头 import。

- [ ] **Step 7: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-collections.test.ts
```

预期：4 个用例 PASS。

> 注意：`LocationAliases.ts` import 了 Task 2 才创建的 `normalize.ts`。若 Task 2 尚未完成，
> 先在 `src/domain/supply-import/normalize.ts` 里放一个只有
> `export function normalizeAliasText(value: unknown): string` 的最小实现（直接转调
> `normalizeBuildingName`），Task 2 再补齐其余函数与测试。

- [ ] **Step 8: 生成迁移**

```bash
cd payload-office-platform && pnpm exec payload migrate:create supply_import_batches
```

生成后**打开检查但不修改正文**，确认：建了 `supply_import_batches` 与 `location_aliases` 两张表、
`location_aliases` 有 `(normalized_alias, kind)` 唯一索引、`enum_listings_data_source_source`
新增了 `manual-import`、`buildings` 加了四个 `data_source_*` 列。**记下这四个列的确切名字**，
下一步要用。

- [ ] **Step 9: 手写幂等唯一索引迁移**

`migrate:create` 不会生成"局部唯一索引"（`WHERE ... IS NOT NULL`）。新建一份手写迁移
`src/migrations/<时间戳>_supply_import_unique_indexes.ts`：

```ts
import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS listings_data_source_external_uniq
      ON listings (data_source_source, data_source_external_id)
      WHERE data_source_source IS NOT NULL AND data_source_external_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS buildings_data_source_external_uniq
      ON buildings (data_source_source, data_source_external_id)
      WHERE data_source_source IS NOT NULL AND data_source_external_id IS NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(`
    DROP INDEX IF EXISTS listings_data_source_external_uniq;
    DROP INDEX IF EXISTS buildings_data_source_external_uniq;
  `)
}
```

列名以 Step 8 记下的为准（Payload 的 group 字段展开规则是 `<group>_<field>` 的 snake_case，
但**不要凭规则推断**——以生成的迁移里写的为准）。

- [ ] **Step 10: 手写角色权限迁移**

`data:import` 权限码已存在但没有角色持有它。参照
`src/migrations/20260810_090000_supply_submission_role_permissions.ts` 的写法，
给 **ADM 与 OPS** 的 `operationPermissions` 追加 `data:import`（幂等：已有则跳过）。

- [ ] **Step 11: 跑迁移并验证**

```bash
cd payload-office-platform && pnpm exec payload migrate && pnpm migrate:status
```

预期：全部 applied，无 pending。

- [ ] **Step 12: 重生成类型与 importMap**

```bash
cd payload-office-platform && pnpm generate:types && pnpm payload generate:importmap && grep -c "prefix" src/payload-types.ts
```

`grep -c` 必须输出 `2`（`Media.prefix` 没被删掉）。

- [ ] **Step 13: 提交**

```bash
git add src/collections/SupplyImportBatches.ts src/collections/LocationAliases.ts src/collections/Listings.ts src/collections/Buildings.ts src/payload.config.ts src/payload-types.ts src/migrations/ tests/supply-import-collections.test.ts
git commit -m "feat(import): OPT-041 Task 1 导入批次与地理别名集合 + 幂等唯一索引"
```

---

### Task 2: 规范化纯函数

**Files:**
- Create: `src/domain/supply-import/types.ts`
- Create: `src/domain/supply-import/normalize.ts`
- Test: `tests/supply-import-normalize.test.ts`

**Interfaces:**
- Consumes：`normalizeBuildingName` from `@/domain/supply/building-dedup`。
- Produces：
  ```ts
  export function normalizeAliasText(value: unknown): string
  export function normalizeCityName(value: unknown): string
  export function normalizeDistrictName(value: unknown): string
  export function parseArea(value: unknown): number | null
  export function parseRent(value: unknown): { amount: number; unit: string } | null
  export function parseFloorNumber(value: unknown): number | null
  ```
  `types.ts` 导出 `RawRow`、`RowError`、`PreflightReport`。

- [ ] **Step 1: 写 `types.ts`（纯类型，无测试）**

```ts
/** 一行原始表格数据：表头 → 单元格文本（exceljs 侧已统一转成字符串）。 */
export type RawRow = Readonly<Record<string, string>>

/** 一条行级错误。`suggestion` 只给人看，系统绝不自动采用（规格 D5）。 */
export interface RowError {
  /** Excel 里的真实行号（含表头，从 2 开始），运营按它去改第几行 */
  readonly rowNumber: number
  readonly column: string
  readonly rawValue: string
  readonly code: string
  readonly message: string
  readonly suggestion?: string
}

export interface PreflightReport {
  readonly rowCount: number
  readonly validCount: number
  readonly errorCount: number
  readonly rowErrors: readonly RowError[]
}
```

> `RowContext`（Task 4 用）也定义在这里，不要定义在 `building-row.ts` 或 `listing-row.ts`——
> 两个文件都要用它，定义在其中一个会让另一个反向依赖。它依赖 Task 3 的类型，
> Task 4 实施时再补进本文件：
>
> ```ts
> import type { BuildingCandidate, ResolveTables } from './resolve-refs'
>
> export interface RowContext {
>   readonly tables: ResolveTables
>   readonly buildings: readonly BuildingCandidate[]
>   readonly allowedCityIds: 'all' | ReadonlySet<number | string>
> }
> ```

- [ ] **Step 2: 写失败测试**

`tests/supply-import-normalize.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import {
  normalizeAliasText,
  normalizeCityName,
  normalizeDistrictName,
  parseArea,
  parseRent,
  parseFloorNumber,
} from '@/domain/supply-import/normalize'

describe('normalizeAliasText', () => {
  it('折叠空白、全角转半角、英文小写', () => {
    expect(normalizeAliasText(' 浦　东 ')).toBe('浦东')
    expect(normalizeAliasText('ＳＯＨＯ')).toBe('soho')
  })
  it('非字符串返回空串', () => {
    expect(normalizeAliasText(null)).toBe('')
    expect(normalizeAliasText(42)).toBe('')
  })
})

describe('normalizeCityName', () => {
  it('剥离"市"后缀', () => {
    expect(normalizeCityName('上海市')).toBe('上海')
    expect(normalizeCityName('上海')).toBe('上海')
  })
  it('单字"市"原样保留——剥完是空串没有意义', () => {
    expect(normalizeCityName('市')).toBe('市')
  })
})

describe('normalizeDistrictName', () => {
  it('保留"区"后缀——浦东新区剥成"浦东新"匹配不到任何东西', () => {
    expect(normalizeDistrictName('浦东新区')).toBe('浦东新区')
  })
  it('剥离城市前缀', () => {
    expect(normalizeDistrictName('上海市黄浦区')).toBe('黄浦区')
  })
})

describe('parseArea', () => {
  it('接受带单位与千分位的写法', () => {
    expect(parseArea('280㎡')).toBe(280)
    expect(parseArea('280 平米')).toBe(280)
    expect(parseArea('1,280.5㎡')).toBe(1280.5)
  })
  it('拒绝零、负数与非数值', () => {
    expect(parseArea('0')).toBeNull()
    expect(parseArea('-5')).toBeNull()
    expect(parseArea('待定')).toBeNull()
  })
})

describe('parseRent', () => {
  it('识别四种常见报价单位', () => {
    expect(parseRent('4.5元/㎡/天')).toEqual({ amount: 4.5, unit: 'rmb-sqm-day' })
    expect(parseRent('30000元/月')).toEqual({ amount: 30000, unit: 'rmb-month' })
    expect(parseRent('1200元/工位/月')).toEqual({ amount: 1200, unit: 'rmb-seat-month' })
    expect(parseRent('80万')).toEqual({ amount: 800000, unit: 'rmb-total' })
  })
  it('单位缺失返回 null——不猜默认单位', () => {
    expect(parseRent('4.5')).toBeNull()
  })
})

describe('parseFloorNumber', () => {
  it('识别中文楼层写法', () => {
    expect(parseFloorNumber('12层')).toBe(12)
    expect(parseFloorNumber('12F')).toBe(12)
    expect(parseFloorNumber('B2')).toBe(-2)
  })
  it('非楼层返回 null', () => {
    expect(parseFloorNumber('中区')).toBeNull()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-normalize.test.ts
```

预期：FAIL（若 Task 1 已放了最小实现，则是除 `normalizeAliasText` 外全部 FAIL）。

- [ ] **Step 4: 实现 `normalize.ts`**

```ts
/**
 * 批量导入的文本规范化层（OPT-041 规格 §4.2）
 *
 * 全部纯函数，不依赖 payload / React。规范化的目标是把"人填的写法"收敛成
 * "可等值匹配的值"，**不做任何猜测性替换**——猜测归 resolve-refs 的候选建议。
 */

import { normalizeBuildingName } from '@/domain/supply/building-dedup'

/** 全角 ASCII（U+FF01–U+FF5E）→ 半角；全角空格 U+3000 单独处理。 */
function toHalfWidth(value: string): string {
  return value
    .replace(/　/g, ' ')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/**
 * 通用别名规范化：与 normalizeBuildingName 同口径（全半角 + 折叠空白 + 小写）。
 * 直接复用既有实现，避免两份规范化规则漂移。
 */
export function normalizeAliasText(value: unknown): string {
  return normalizeBuildingName(value)
}

/** 城市名：规范化后剥离末尾的"市"（长度 > 1 才剥，"市"本身保留）。 */
export function normalizeCityName(value: unknown): string {
  const base = normalizeAliasText(value)
  if (base.length > 1 && base.endsWith('市')) return base.slice(0, -1)
  return base
}

/**
 * 行政区名：规范化后剥离城市前缀（"上海市黄浦区" → "黄浦区"）。
 * **不剥"区"后缀**——"浦东新区"剥成"浦东新"会匹配不到任何东西。
 */
export function normalizeDistrictName(value: unknown): string {
  const base = normalizeAliasText(value)
  // lookahead 保证后面还有内容才剥，避免把"上海市"本身剥成空串
  return base.replace(/^[一-龥]{2,4}市(?=.+)/, '')
}

/** 抽取字符串里的第一个数值（容忍千分位）。 */
function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = toHalfWidth(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** 面积：必须为正数，单位（㎡ / 平米 / 平方米）可有可无。 */
export function parseArea(value: unknown): number | null {
  const num = extractNumber(value)
  if (num === null || num <= 0) return null
  return num
}

/**
 * 租金：**单位必须能识别**，识别不了返回 null。
 * 不给默认单位——"4.5"到底是元/㎡/天还是万元/月，猜错的代价是前台价格错一个数量级。
 * 取值域与 SUBMISSION_PRICE_UNITS 一致。
 */
export function parseRent(value: unknown): { amount: number; unit: string } | null {
  if (typeof value !== 'string') return null
  const text = toHalfWidth(value).replace(/\s/g, '')
  const num = extractNumber(text)
  if (num === null || num < 0) return null

  // 「万」是数量级修饰而非单位。出现"万"却不是纯总价写法（如 `1.5万/月`、`80万元/年`）时，
  // 单位其实识别不出来，必须返回 null——不能落到下面的 `/\/月$/` 分支，
  // 那会把「1.5 万元/月」读成「1.5 元/月」，差一万倍，而导入的房源是直接上架的。
  if (text.includes('万')) {
    if (/^[\d,]+(\.\d+)?万元?$/.test(text)) return { amount: num * 10000, unit: 'rmb-total' }
    return null
  }

  if (/\/㎡\/天|\/平米\/天|元\/平\/天/.test(text)) return { amount: num, unit: 'rmb-sqm-day' }
  if (/\/工位\/月|\/人\/月/.test(text)) return { amount: num, unit: 'rmb-seat-month' }
  if (/\/月$/.test(text)) return { amount: num, unit: 'rmb-month' }
  return null
}

/** 楼层：`12层` / `12F` → 12；`B2` / `负2层` → -2；识别不了返回 null。 */
export function parseFloorNumber(value: unknown): number | null {
  if (typeof value !== 'string') return extractNumber(value)
  const text = toHalfWidth(value).replace(/\s/g, '').toUpperCase()
  const basement = text.match(/^B(\d+)/) ?? text.match(/^负(\d+)/)
  if (basement) return -Number(basement[1])
  if (!/^\d+(层|F|楼)?$/.test(text)) return null
  return extractNumber(text)
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-normalize.test.ts
```

预期：全部 PASS。若 `normalizeDistrictName('上海市黄浦区')` 失败，检查 lookahead——
城市前缀必须后面还有内容才剥。

- [ ] **Step 6: 提交**

```bash
git add src/domain/supply-import/normalize.ts src/domain/supply-import/types.ts tests/supply-import-normalize.test.ts
git commit -m "feat(import): OPT-041 Task 2 导入文本规范化纯函数"
```

---

### Task 3: 关系解析（别名表 + 候选建议）

**Files:**
- Create: `src/domain/supply-import/resolve-refs.ts`
- Test: `tests/supply-import-resolve-refs.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `normalizeAliasText` / `normalizeCityName` / `normalizeDistrictName`。
- Produces：
  ```ts
  export interface LocationCandidate {
    id: number | string; name: string; kind: string; parentId: number | string | null
  }
  export interface BuildingCandidate {
    id: number | string; name: string; slug: string
    externalId: string | null; cityId: number | string | null
  }
  export interface ResolveTables {
    locations: Record<string, readonly LocationCandidate[]>
    aliases: Record<string, ReadonlyMap<string, number | string>>
  }
  export interface RefLookupPort {
    listLocations(kind: string): Promise<readonly LocationCandidate[]>
    listAliases(kind: string): Promise<ReadonlyArray<{ normalizedAlias: string; locationId: number | string }>>
  }
  export type ResolveResult<T> =
    | { ok: true; value: T }
    | { ok: false; code: string; message: string; suggestion?: string }

  export function buildResolveTables(port: RefLookupPort): Promise<ResolveTables>
  export function resolveLocation(
    input: { kind: string; text: string; parentId?: number | string | null },
    tables: ResolveTables,
  ): ResolveResult<LocationCandidate>
  export function resolveBuilding(
    text: string,
    buildings: readonly BuildingCandidate[],
  ): ResolveResult<BuildingCandidate>
  export function suggestClosest(text: string, names: readonly string[], limit?: number): string[]
  ```
  **纯函数 + 一次性预载表**：解析本身不发查询（几百行逐行查库会打爆连接池），
  `buildResolveTables` 在预检开始时把地理数据与别名一次性载入内存。

- [ ] **Step 1: 写失败测试**

`tests/supply-import-resolve-refs.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import {
  resolveLocation,
  resolveBuilding,
  suggestClosest,
  type BuildingCandidate,
  type ResolveTables,
} from '@/domain/supply-import/resolve-refs'

const tables: ResolveTables = {
  locations: {
    city: [{ id: 1, name: '上海', kind: 'city', parentId: null }],
    district: [
      { id: 11, name: '浦东新区', kind: 'district', parentId: 1 },
      { id: 12, name: '黄浦区', kind: 'district', parentId: 1 },
    ],
    business_area: [],
    metro_station: [],
  },
  aliases: {
    city: new Map(),
    district: new Map([['浦东', 11]]),
    business_area: new Map(),
    metro_station: new Map(),
  },
}

describe('resolveLocation', () => {
  it('规范化后精确命中名称', () => {
    const r = resolveLocation({ kind: 'district', text: ' 黄浦区 ', parentId: 1 }, tables)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.id).toBe(12)
  })

  it('命中别名表', () => {
    const r = resolveLocation({ kind: 'district', text: '浦东', parentId: 1 }, tables)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.id).toBe(11)
  })

  it('未命中时报错并给候选建议，但绝不自动采用', () => {
    const r = resolveLocation({ kind: 'district', text: '黄浦', parentId: 1 }, tables)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('LOCATION_NOT_FOUND')
    expect(r.ok === false && r.suggestion).toContain('黄浦区')
  })

  it('父级不匹配时判错——区域必须属于所填城市', () => {
    const r = resolveLocation({ kind: 'district', text: '浦东新区', parentId: 999 }, tables)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('LOCATION_PARENT_MISMATCH')
  })
})

const buildings: readonly BuildingCandidate[] = [
  { id: 100, name: '星展银行大厦', slug: 'xing-zhan-yin-hang-da-sha', externalId: 'B-001', cityId: 1 },
  { id: 101, name: '星展大厦', slug: 'xing-zhan-da-sha', externalId: 'B-002', cityId: 1 },
  { id: 102, name: '环球金融中心', slug: 'huan-qiu-jin-rong-zhong-xin', externalId: null, cityId: 1 },
  { id: 103, name: '环球金融中心', slug: 'huan-qiu-jin-rong-zhong-xin-2', externalId: null, cityId: 1 },
]

describe('resolveBuilding', () => {
  it('优先按外部编号精确命中', () => {
    const r = resolveBuilding('B-002', buildings)
    expect(r.ok && r.value.id).toBe(101)
  })

  it('其次按 slug 命中', () => {
    const r = resolveBuilding('xing-zhan-da-sha', buildings)
    expect(r.ok && r.value.id).toBe(101)
  })

  it('名称精确命中（规范化后）', () => {
    const r = resolveBuilding(' 星展银行大厦 ', buildings)
    expect(r.ok && r.value.id).toBe(100)
  })

  it('同名多条时报错要求消歧，绝不挑一个', () => {
    const r = resolveBuilding('环球金融中心', buildings)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('BUILDING_AMBIGUOUS')
    // 消息里要给出可用于消歧的 slug
    expect(r.ok === false && r.message).toContain('huan-qiu-jin-rong-zhong-xin-2')
  })

  it('相似但不相等时不匹配，只给建议', () => {
    const r = resolveBuilding('星展银行大夏', buildings)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('BUILDING_NOT_FOUND')
    expect(r.ok === false && r.suggestion).toContain('星展银行大厦')
  })
})

describe('suggestClosest', () => {
  it('按编辑距离升序返回，并按 limit 截断', () => {
    // '浦东新' → '浦东新' 距离 0；→ '浦东新区' 1/4=0.25；→ '浦东' 1/3≈0.33
    // 三者都在阈值内，limit=2 只留最近两个，顺序不能乱
    expect(suggestClosest('浦东新', ['浦东', '浦东新区', '浦东新'], 2)).toEqual(['浦东新', '浦东新区'])
  })
  it('相差太远的候选被过滤掉，不产生噪音建议', () => {
    // '黄浦' 对 '浦东新区' 的编辑距离是 4、比值 1.0——推荐它只会误导运营
    expect(suggestClosest('黄浦', ['黄浦区', '浦东新区', '静安区'], 3)).toEqual(['黄浦区'])
  })
  it('全都差太远时返回空数组', () => {
    expect(suggestClosest('abcdefg', ['黄浦区'], 3)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-resolve-refs.test.ts
```

预期：FAIL，`Cannot find module '@/domain/supply-import/resolve-refs'`。

- [ ] **Step 3: 实现 `suggestClosest`**

```ts
/** Levenshtein 距离。只用于生成"是否指…"的候选建议，不参与任何匹配决策。 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i]
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/** 相似度下限：超过这个比值就不算"疑似"，否则会给出纯噪音建议。 */
const SUGGESTION_MAX_RATIO = 0.5

export function suggestClosest(text: string, names: readonly string[], limit = 3): string[] {
  return names
    .map((name) => ({
      name,
      ratio: levenshtein(text, name) / Math.max(text.length, name.length, 1),
    }))
    .filter((entry) => entry.ratio <= SUGGESTION_MAX_RATIO)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, limit)
    .map((entry) => entry.name)
}
```

- [ ] **Step 4: 实现 `resolveLocation`**

顺序固定，任一步命中即停：

1. 按 `kind` 选规范化函数：`city` → `normalizeCityName`，`district` → `normalizeDistrictName`，
   其余 → `normalizeAliasText`。
2. **名称精确匹配**：候选的 `name` 同样规范化后比较。
3. **别名表**：`tables.aliases[kind].get(normalized)` → 拿 ID 再回 `tables.locations[kind]` 找候选。
4. 都不中 → `{ ok: false, code: 'LOCATION_NOT_FOUND', message, suggestion }`，
   `suggestion` 形如 `是否指：浦东新区、静安区？`（`suggestClosest` 返回空数组时省略该字段）。
5. 命中后若调用方传了 `parentId` 且候选的 `parentId` 不相等 →
   `{ ok: false, code: 'LOCATION_PARENT_MISMATCH', message: '「浦东新区」不属于所填城市' }`。

**结果里只放名称字符串，不放候选 ID**——防止调用方图省事直接采用建议。

- [ ] **Step 5: 实现 `resolveBuilding`**

顺序固定：

1. `externalId` 精确匹配（区分大小写，运营编号本来就是精确值）。
2. `slug` 精确匹配。
3. `normalizeAliasText(name)` 精确匹配。命中 **恰好 1 条** 才算成功。
4. 名称命中 **> 1 条** → `{ ok: false, code: 'BUILDING_AMBIGUOUS', message }`，
   message 里逐条列出 `名称(slug)` 供运营改填。
5. 一条都不中 → `{ ok: false, code: 'BUILDING_NOT_FOUND', message, suggestion }`。

- [ ] **Step 6: 实现 `buildResolveTables`**

对 `['city', 'district', 'business_area', 'metro_station']` 四类各调用一次
`port.listLocations(kind)` 与 `port.listAliases(kind)`，组装成 `ResolveTables`。
共 8 次查询，与表格行数无关。

- [ ] **Step 7: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-resolve-refs.test.ts
```

预期：全部 PASS。核对阈值：`suggestClosest('黄浦', ['黄浦区'])` 的比值是 `1/3 ≈ 0.33`，
在阈值内；`'abcdefg'` 对 `'黄浦区'` 比值为 `7/7 = 1`，被过滤掉。

- [ ] **Step 8: 提交**

```bash
git add src/domain/supply-import/resolve-refs.ts tests/supply-import-resolve-refs.test.ts
git commit -m "feat(import): OPT-041 Task 3 关系解析与候选建议（不做模糊自动采用）"
```

---

### Task 4: 行校验 schema（楼盘 + 房源）

**Files:**
- Create: `src/domain/supply-import/building-row.ts`
- Create: `src/domain/supply-import/listing-row.ts`
- Test: `tests/supply-import-building-row.test.ts`
- Test: `tests/supply-import-listing-row.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `normalize.ts` 全部导出与 `RawRow` / `RowError`；Task 3 的
  `resolveLocation` / `resolveBuilding` / `ResolveTables` / `BuildingCandidate`。
- Produces：
  ```ts
  export const BUILDING_COLUMNS: readonly string[]   // 模板表头，顺序即列顺序
  export const LISTING_COLUMNS: readonly string[]

  // RowContext 定义在 types.ts（两个 row 文件都要用），此处只 re-export
  export type { RowContext } from './types'

  export interface ValidBuildingRow {
    externalId: string; name: string
    cityId: number | string; districtId: number | string
    businessAreaId: number | string | null; address: string | null
    totalFloors: number | null; grossFloorArea: number | null
  }
  export interface ValidListingRow {
    externalId: string; title: string; listingType: string
    buildingId: number | string; cityId: number | string | null
    area: number; rentAmount: number; rentUnit: string
    floor: number | null; decorationStatus: string | null; availableFrom: string | null
  }
  export function validateBuildingRow(
    row: RawRow, rowNumber: number, ctx: RowContext,
  ): { ok: true; value: ValidBuildingRow } | { ok: false; errors: RowError[] }
  export function validateListingRow(
    row: RawRow, rowNumber: number, ctx: RowContext,
  ): { ok: true; value: ValidListingRow } | { ok: false; errors: RowError[] }

  // 批内编号查重（规格 §6）。放在共享处，两种导入都用，端点层不要再写一遍。
  // 定义在 src/domain/supply-import/duplicate-check.ts
  export function markDuplicateExternalIds<T extends { externalId: string }>(
    rows: readonly T[], rowNumbers: readonly number[], column: string,
  ): { kept: T[]; keptRowNumbers: number[]; errors: RowError[] }
  ```

- [ ] **Step 1: 抄准既有枚举取值域**

```bash
cd payload-office-platform && rg -n "name: 'listingType'" -A 14 src/collections/Listings.ts && rg -n "name: 'decorationStatus'" -A 12 src/collections/Listings.ts
```

把 `listingType` 与 `decorationStatus` 的 `options` 值原样记下。**不要在导入层写第二份取值域**——
本仓库已有同类教训（见根 `CLAUDE.md`「多 agent 入口」一节）。若这两个枚举已有导出的常量数组，
直接 import 那个常量。

- [ ] **Step 2: 写房源行的失败测试**

`tests/supply-import-listing-row.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import { validateListingRow, LISTING_COLUMNS, type RowContext } from '@/domain/supply-import/listing-row'

const ctx: RowContext = {
  tables: {
    locations: { city: [], district: [], business_area: [], metro_station: [] },
    aliases: { city: new Map(), district: new Map(), business_area: new Map(), metro_station: new Map() },
  },
  buildings: [
    { id: 100, name: '环球金融中心', slug: 'huan-qiu', externalId: 'B-001', cityId: 1 },
    { id: 200, name: '外地大厦', slug: 'wai-di', externalId: 'B-999', cityId: 9 },
  ],
  allowedCityIds: new Set([1]),
}

// listingType 的值以 Step 1 抄到的为准，此处的 '写字楼' 是模板里的中文标签
const goodRow = {
  房源编号: 'L-001',
  房源标题: '环球金融中心 280㎡ 精装办公室',
  房源类型: '写字楼',
  楼盘编号或标识: 'B-001',
  面积: '280㎡',
  租金: '4.5元/㎡/天',
  楼层: '12层',
  装修: '精装',
  可租日期: '2026-09-01',
}

describe('validateListingRow', () => {
  it('模板列头固定且以编号打头', () => {
    expect(LISTING_COLUMNS[0]).toBe('房源编号')
    expect(LISTING_COLUMNS).toContain('楼盘编号或标识')
  })

  it('完整正确行通过并产出规范化值', () => {
    const r = validateListingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      externalId: 'L-001',
      buildingId: 100,
      area: 280,
      rentAmount: 4.5,
      rentUnit: 'rmb-sqm-day',
      floor: 12,
    })
  })

  it('缺编号即错误行——编号是幂等键，不能自动补', () => {
    const r = validateListingRow({ ...goodRow, 房源编号: '  ' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({
      rowNumber: 2, column: '房源编号', code: 'REQUIRED',
    })
  })

  it('租金缺单位即错误行，不猜默认单位', () => {
    const r = validateListingRow({ ...goodRow, 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'RENT_UNIT_UNKNOWN')).toBe(true)
  })

  it('楼盘匹配不到即错误行，绝不自动建楼盘', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: '不存在大厦' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_FOUND')).toBe(true)
  })

  it('越权城市的楼盘判为错误行，而不是静默跳过', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('allowedCityIds 为 all 时不做城市校验', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, { ...ctx, allowedCityIds: 'all' })
    expect(r.ok).toBe(true)
  })

  it('一行的多个问题一次全报出来，不是报一个就停', () => {
    const r = validateListingRow({ ...goodRow, 面积: '待定', 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-listing-row.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 4: 实现 `listing-row.ts`**

要点：

1. `LISTING_COLUMNS` 固定为
   `['房源编号','房源标题','房源类型','楼盘编号或标识','面积','租金','楼层','装修','可租日期']`。
2. **收集全部错误再返回**（不 early return）——运营改一次表要能看到这一行所有问题。
3. 房源类型 / 装修：模板填中文标签，用 Step 1 抄到的 `options` 做「label → value」映射；
   映射不到 → `ENUM_UNKNOWN` 错误，message 里列出全部合法标签。
4. 城市校验：`allowedCityIds === 'all'` 跳过；否则用命中楼盘的 `cityId` 判定，
   不在集合内返回 `CITY_OUT_OF_SCOPE`（**先判城市再判其它**，让它成为 `errors[0]`）。
5. 可租日期只接受 `YYYY-MM-DD`，解析成 ISO 字符串；空值合法（`null`）。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-listing-row.test.ts
```

预期：全部 PASS。

- [ ] **Step 6: 用同样的 TDD 循环做 `building-row.ts`**

`BUILDING_COLUMNS` 固定为
`['楼盘编号','楼盘名称','城市','行政区','商圈','地址','总楼层','总建筑面积']`。

测试至少覆盖这 7 条，逐条写：编号必填、名称必填、城市解析失败（`LOCATION_NOT_FOUND`）、
行政区不属于所填城市（`LOCATION_PARENT_MISMATCH`）、商圈留空合法、
越权城市判错（`CITY_OUT_OF_SCOPE`，用城市自身的 ID 判定）、一行多错并报。

写测试 → 跑失败 → 实现 → 跑通过，四步各自单独执行，不要合并。

- [ ] **Step 7: 写批内编号查重的失败测试**

规格 §6 要求"编号在同一次导入内必须唯一，重复即错误行"。这是纯逻辑，
放 `src/domain/supply-import/duplicate-check.ts`，**不要写在端点里**——
两种导入都要用，写在端点里必然复制两份。

`tests/supply-import-duplicate-check.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import { markDuplicateExternalIds } from '@/domain/supply-import/duplicate-check'

describe('markDuplicateExternalIds', () => {
  it('首次出现保留，第二次起判错并剔除', () => {
    const rows = [{ externalId: 'L-1' }, { externalId: 'L-2' }, { externalId: 'L-1' }]
    const result = markDuplicateExternalIds(rows, [2, 3, 4], '房源编号')

    expect(result.kept).toEqual([{ externalId: 'L-1' }, { externalId: 'L-2' }])
    expect(result.keptRowNumbers).toEqual([2, 3])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 4, column: '房源编号', rawValue: 'L-1', code: 'DUPLICATE_EXTERNAL_ID',
    })
    // 错误消息要指出跟哪一行撞了，否则运营不知道去哪儿改
    expect(result.errors[0].message).toContain('2')
  })

  it('全不重复时原样返回', () => {
    const rows = [{ externalId: 'L-1' }, { externalId: 'L-2' }]
    const result = markDuplicateExternalIds(rows, [2, 3], '房源编号')
    expect(result.kept).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })
})
```

- [ ] **Step 8: 跑失败 → 实现 → 跑通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-duplicate-check.test.ts
```

实现用一个 `Map<string, number>` 记录 `externalId → 首次出现的行号`，
命中即产出 `DUPLICATE_EXTERNAL_ID` 错误并从 `kept` 里剔除。三步各自单独执行。

- [ ] **Step 9: 提交**

```bash
git add src/domain/supply-import/building-row.ts src/domain/supply-import/listing-row.ts src/domain/supply-import/duplicate-check.ts src/domain/supply-import/types.ts tests/supply-import-building-row.test.ts tests/supply-import-listing-row.test.ts tests/supply-import-duplicate-check.test.ts
git commit -m "feat(import): OPT-041 Task 4 楼盘与房源行校验 schema + 批内编号查重"
```

---

### Task 5: 工作簿读写（exceljs）

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml`（`pnpm add exceljs`）
- Create: `src/domain/supply-import/workbook.ts`
- Test: `tests/supply-import-workbook.test.ts`

**Interfaces:**
- Consumes：`RawRow` / `RowError`（Task 2）。
- Produces：
  ```ts
  export const MAX_FILE_BYTES: number   // 5 * 1024 * 1024
  export const MAX_ROWS: number         // 1000

  export type ParseResult =
    | { ok: true; rows: RawRow[]; rowNumbers: number[] }
    | { ok: false; code: string; message: string }

  export function parseWorkbook(
    buffer: Buffer, fileName: string, expectedColumns: readonly string[],
  ): Promise<ParseResult>
  export function buildTemplateWorkbook(columns: readonly string[]): Promise<Buffer>
  export function buildErrorWorkbook(
    columns: readonly string[], rows: readonly RawRow[],
    rowNumbers: readonly number[], errors: readonly RowError[],
  ): Promise<Buffer>
  export function buildBuildingReferenceWorkbook(
    rows: ReadonlyArray<{ externalId: string | null; name: string; slug: string; city: string }>,
  ): Promise<Buffer>
  ```
  `rows` 与 `rowNumbers` 是**并行数组**，`rowNumbers[i]` 是 `rows[i]` 在 Excel 里的真实行号。
  行号不能塞进 `RawRow` 的普通键——那会被当成一列写进错误表。

- [ ] **Step 1: 装依赖**

```bash
cd payload-office-platform && pnpm add exceljs
```

- [ ] **Step 2: 写失败测试**

`tests/supply-import-workbook.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import {
  parseWorkbook,
  buildTemplateWorkbook,
  buildErrorWorkbook,
  MAX_ROWS,
} from '@/domain/supply-import/workbook'

const COLUMNS = ['房源编号', '房源标题'] as const

async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  for (const row of rows) ws.addRow(row)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('parseWorkbook', () => {
  it('解析 xlsx，表头映射为对象', async () => {
    const buf = await makeXlsx([[...COLUMNS], ['L-001', '测试房源']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(true)
    expect(result.ok && result.rows).toEqual([{ 房源编号: 'L-001', 房源标题: '测试房源' }])
    expect(result.ok && result.rowNumbers).toEqual([2])
  })

  it('缺必需列 → 整个文件拒绝，一行都不解析', async () => {
    const buf = await makeXlsx([['房源编号'], ['L-001']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('MISSING_COLUMNS')
    expect(result.ok === false && result.message).toContain('房源标题')
  })

  it('超行数上限 → 拒绝', async () => {
    const rows = [[...COLUMNS], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`L-${i}`, 'x'])]
    const buf = await makeXlsx(rows)
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('TOO_MANY_ROWS')
  })

  it('不认识的扩展名 → 拒绝', async () => {
    const result = await parseWorkbook(Buffer.from('x'), 'a.txt', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('全空行被跳过，但后续行的行号不重算', async () => {
    const buf = await makeXlsx([[...COLUMNS], ['L-001', 'x'], ['', ''], ['L-002', 'y']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok && result.rows.length).toBe(2)
    // 第 3 行是空行被跳过，第 4 行的行号必须还是 4
    expect(result.ok && result.rowNumbers).toEqual([2, 4])
  })
})

describe('buildTemplateWorkbook / buildErrorWorkbook', () => {
  it('模板只有表头一行', async () => {
    const buf = await buildTemplateWorkbook(COLUMNS)
    const parsed = await parseWorkbook(buf, 't.xlsx', COLUMNS)
    expect(parsed.ok && parsed.rows).toEqual([])
  })

  it('错误表在原列后追加「错误原因」列', async () => {
    const buf = await buildErrorWorkbook(
      COLUMNS,
      [{ 房源编号: 'L-001', 房源标题: '' }],
      [2],
      [{ rowNumber: 2, column: '房源标题', rawValue: '', code: 'REQUIRED', message: '房源标题必填' }],
    )
    const parsed = await parseWorkbook(buf, 'e.xlsx', [...COLUMNS, '错误原因'])
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源标题必填')
  })

  it('同一行的多条错误合并进一个单元格', async () => {
    const buf = await buildErrorWorkbook(
      COLUMNS,
      [{ 房源编号: '', 房源标题: '' }],
      [2],
      [
        { rowNumber: 2, column: '房源编号', rawValue: '', code: 'REQUIRED', message: '房源编号必填' },
        { rowNumber: 2, column: '房源标题', rawValue: '', code: 'REQUIRED', message: '房源标题必填' },
      ],
    )
    const parsed = await parseWorkbook(buf, 'e.xlsx', [...COLUMNS, '错误原因'])
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源编号必填')
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源标题必填')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-workbook.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 4: 实现 `workbook.ts`**

要点：

1. **只按扩展名分派**：`.xlsx` 走 `workbook.xlsx.load(buffer)`，`.csv` 走
   `workbook.csv.read(stream)` 并显式传 `{ encoding: 'utf-8' }`。其它一律 `UNSUPPORTED_FORMAT`。
2. 单元格一律 `String(cell.text ?? '').trim()` 转字符串——数字、日期、公式结果统一成文本，
   由 Task 2 的 normalize 层去解释。**不要在这里做类型推断**。
3. 表头缺列时把**缺的列名全部**列进 message（`缺少必需列：房源标题、面积`），不只报第一个。
4. 行数上限判定在读取后、映射前；`MAX_FILE_BYTES` 只导出常量，由端点在读 body 时判定。
5. 全空行（所有单元格 trim 后为空）跳过，`rowNumbers` 记录 Excel 真实行号。
6. `buildErrorWorkbook` 按 `rowNumber` 分组合并错误消息，用 `；` 连接，
   带 `suggestion` 的追加在消息后。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-workbook.test.ts
```

预期：全部 PASS。

- [ ] **Step 6: 确认构建不受影响**

```bash
cd payload-office-platform && pnpm build
```

预期：构建成功。exceljs 只在服务端 import，不应出现在客户端 bundle 里。
若报几十条 `Module not found`，先量 worktree 路径长度（见
`payload-office-platform/CLAUDE.md` 并行开发纪律第 8 条），不要去查依赖。

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml src/domain/supply-import/workbook.ts tests/supply-import-workbook.test.ts
git commit -m "feat(import): OPT-041 Task 5 工作簿读写（exceljs）与模板/错误表生成"
```

---

### Task 6: 预检端点与下载端点

**Files:**
- Create: `src/endpoints/bulk-import-endpoint.ts`
- Modify: `src/payload.config.ts:292`（`endpoints` 数组）
- Test: `tests/supply-import-endpoint.test.ts`

**Interfaces:**
- Consumes：Task 1 的两个集合；Task 3 的 `buildResolveTables` / `RefLookupPort`；
  Task 4 的 `validateBuildingRow` / `validateListingRow` / `BUILDING_COLUMNS` / `LISTING_COLUMNS`；
  Task 5 的 `parseWorkbook` / `buildTemplateWorkbook` / `buildErrorWorkbook` /
  `buildBuildingReferenceWorkbook` / `MAX_FILE_BYTES`。
- Produces：
  ```ts
  export const PREFLIGHT_ERROR_PREVIEW_LIMIT: number  // 50
  export function createBulkImportEndpoints(): Endpoint[]
  ```

  | 方法 | 路径 | 作用 |
  |---|---|---|
  | POST | `/bulk-import/preflight` | multipart 上传 → 预检 → 落 `preflight` 批次 |
  | POST | `/bulk-import/batches/:id/execute` | 复核权限 → `queued` → 入队 |
  | GET | `/bulk-import/batches/:id` | 轮询状态与 stats |
  | GET | `/bulk-import/batches/:id/errors` | 下载错误表 xlsx |
  | GET | `/bulk-import/template` | 下载空模板（`?type=buildings\|listings`） |
  | GET | `/bulk-import/building-reference` | 下载楼盘对照表 |

- [ ] **Step 1: 写失败测试**

`tests/supply-import-endpoint.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import { createBulkImportEndpoints } from '@/endpoints/bulk-import-endpoint'

describe('createBulkImportEndpoints 路由契约', () => {
  const endpoints = createBulkImportEndpoints()

  it('注册六个路由，方法与路径固定', () => {
    expect(endpoints.map((e) => `${String(e.method).toUpperCase()} ${e.path}`).sort()).toEqual([
      'GET /bulk-import/batches/:id',
      'GET /bulk-import/batches/:id/errors',
      'GET /bulk-import/building-reference',
      'GET /bulk-import/template',
      'POST /bulk-import/batches/:id/execute',
      'POST /bulk-import/preflight',
    ])
  })

  it('未登录请求返回 403 而不是 200', async () => {
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')
    expect(preflight).toBeDefined()
    const req = {
      payload: { find: async () => ({ docs: [] }) },
      url: 'http://localhost/api/bulk-import/preflight',
    } as never
    const res = await preflight!.handler(req)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-endpoint.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现端点骨架与权限守卫**

每个 handler 的第一件事都是同一段守卫：

```ts
import type { Endpoint } from 'payload'
import { requireOperationPermission, canReadByCity, type RequestContext } from '@/domain/auth/access'
import type { PermissionContext } from '@/domain/auth/permission-context'

/** 统一守卫：无 data:import 一律 403。UI 隐藏不是权限控制。 */
async function guardImport(
  req: RequestContext,
): Promise<{ ok: true; ctx: PermissionContext } | { ok: false; response: Response }> {
  try {
    const ctx = await requireOperationPermission(req, 'data:import')
    return { ok: true, ctx }
  } catch (err) {
    const message = err instanceof Error ? err.message : '无权限'
    return { ok: false, response: Response.json({ ok: false, error: message }, { status: 403 }) }
  }
}
```

- [ ] **Step 4: 实现 preflight handler**

顺序固定，任一步失败直接返回，不继续：

1. `guardImport`。
2. `req.formData()` 取 `file`；无文件 → 400 `NO_FILE`。
3. `file.size > MAX_FILE_BYTES` → 400 `FILE_TOO_LARGE`。
4. `type` 参数只接受 `buildings` / `listings`，否则 400 `BAD_TYPE`。
5. `parseWorkbook(buffer, file.name, columns)`；`ok:false` → 400，原样带上 `code` 与 `message`。
6. `buildResolveTables(port)`；`port` 用 `req.payload.find({ collection: 'locations' | 'location-aliases' })` 实现。
   楼盘候选一次性查全（`payload.find({ collection: 'buildings', limit: 0, depth: 0, overrideAccess: true })`）。
7. 逐行 `validateXxxRow(rows[i], rowNumbers[i], { tables, buildings, allowedCityIds: ctx.cityIds })`。
   `ctx.cityIds` 的类型就是 `'all' | Set<number | string>`，直接透传。
8. **批内编号查重**（逐行校验之后做，因为要看全量）：调用 Task 4 的
   `markDuplicateExternalIds(validRows, keptRowNumbers, '房源编号' | '楼盘编号')`，
   把它返回的 `errors` 并进 `rowErrors`，`kept` 作为最终 `validRows`。
   **不要在这里重写查重逻辑**。
9. `payload.create({ collection: 'supply-import-batches', data: { type, status: 'preflight',
   operator: ctx.userId, fileName, rowCount, validRows, rowErrors, ... }, req, overrideAccess: true })`。
10. 返回 `{ ok: true, batchId, report: { rowCount, validCount, errorCount, rowErrors } }`。
    `rowErrors` 只返回**前 `PREFLIGHT_ERROR_PREVIEW_LIMIT` 条**给页面渲染，完整版走错误表下载——
    几百条错误直接塞 JSON 响应会把浏览器渲染拖死。响应里的 `errorCount` 是完整计数，
    让页面知道被截断了。

**预检不写任何业务表**——本任务最重要的不变量。review 时逐行确认没有对
`buildings` / `listings` 的 `create` / `update`。

- [ ] **Step 5: 实现 execute handler**

1. `guardImport` + 取批次；`status !== 'preflight'` → 409 `BAD_STATE`
   （防止重复点击重复入队）。
2. **复核城市范围**：`validRows` 里每行的 `cityId` 逐条过 `canReadByCity(ctx, cityId)`，
   有任一越权 → 403。预检时校验过一次，这里再校验一次——预检与执行之间用户角色可能已变更。
3. `payload.update` 批次：`status='queued'`、`startedAt=new Date().toISOString()`。
4. 入队：本任务先留注入点 `queueImportJob?: (batchId) => Promise<void>`，Task 7 接上真实实现。
5. 写审计：
   ```ts
   await writeAuditSuccess({
     payload: req.payload, req,
     data: {
       action: 'data.import',
       object: { collection: 'supply-import-batches', id: batchId },
       after: { type, validCount },
     },
   })
   ```

- [ ] **Step 6: 实现三个下载 handler**

统一返回：

```ts
return new Response(new Uint8Array(buffer), {
  status: 200,
  headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
  },
})
```

`building-reference` 的查询要按 `ctx.cityIds` 收窄——OPS 不该看到非授权城市的楼盘清单。

- [ ] **Step 7: 在 payload.config 注册**

```ts
endpoints: [
  // ...既有六条
  // OPT-041 批量导入（预检 / 执行 / 轮询 / 下载）
  ...createBulkImportEndpoints(),
],
```

- [ ] **Step 8: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-endpoint.test.ts && pnpm typecheck
```

预期：测试 PASS，typecheck 无错。

- [ ] **Step 9: 提交**

```bash
git add src/endpoints/bulk-import-endpoint.ts src/payload.config.ts tests/supply-import-endpoint.test.ts
git commit -m "feat(import): OPT-041 Task 6 预检端点与模板/错误表下载"
```

---

### Task 7: Jobs Queue 写入层

**Files:**
- Create: `src/domain/supply-import/import-task.ts`
- Modify: `src/payload.config.ts`（`jobs.tasks` / `jobs.autoRun` / `shouldAutoRun`）
- Modify: `src/endpoints/bulk-import-endpoint.ts`（接上真实入队）
- Test: `tests/supply-import-task-postgres.test.ts`

**Interfaces:**
- Consumes：`ValidBuildingRow` / `ValidListingRow`（Task 4）、批次集合（Task 1）、
  `slugify`（`@/domain/shared/slug`）。
- Produces：
  ```ts
  export const SUPPLY_IMPORT_TASK = 'run-supply-import'
  export const SUPPLY_IMPORT_QUEUE = 'supply-imports'
  export const SUPPLY_IMPORT_CHUNK = 20

  export interface ImportRunResult {
    created: number; updated: number; failed: number
    affectedIds: Array<number | string>
    errors: Array<{ externalId: string; message: string }>
  }
  export function runSupplyImportBatch(params: {
    payload: Payload; req?: PayloadRequest
    type: 'buildings' | 'listings'
    validRows: ReadonlyArray<ValidBuildingRow | ValidListingRow>
  }): Promise<ImportRunResult>

  export const supplyImportTask: TaskConfig
  export function recoverStaleSupplyImportJobs(payload: Payload): Promise<number>
  ```

- [ ] **Step 1: 写失败测试（真库）**

`tests/supply-import-task-postgres.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { runSupplyImportBatch } from '@/domain/supply-import/import-task'

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('OPT-041 导入写入层', () => {
  let payload: Payload
  let buildingId: number | string
  const createdListingIds: Array<number | string> = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    const building = await payload.find({
      collection: 'buildings', limit: 1, depth: 0, overrideAccess: true,
    })
    buildingId = building.docs[0].id
  })

  afterAll(async () => {
    for (const id of createdListingIds) {
      await payload.delete({ collection: 'listings', id, overrideAccess: true }).catch(() => null)
    }
  })

  function rows(externalId: string) {
    return [{
      externalId, title: `导入测试 ${externalId}`, listingType: 'office',
      buildingId, cityId: null, area: 280, rentAmount: 4.5, rentUnit: 'rmb-sqm-day',
      floor: 12, decorationStatus: null, availableFrom: null,
    }]
  }

  it('第一次跑全部新建，第二次跑全部更新——重传不翻倍', async () => {
    const first = await runSupplyImportBatch({ payload, type: 'listings', validRows: rows('E2E-IDEMP-1') })
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 0 })
    createdListingIds.push(...first.affectedIds)

    const second = await runSupplyImportBatch({ payload, type: 'listings', validRows: rows('E2E-IDEMP-1') })
    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 })
    expect(second.affectedIds).toEqual(first.affectedIds)
  })

  it('导入的房源直接上架（规格 D4），且带 manual-import 溯源', async () => {
    const doc = await payload.findByID({
      collection: 'listings', id: createdListingIds[0], depth: 0, overrideAccess: true,
    })
    expect(doc.publicationStatus).toBe('published')
    expect(doc.reviewStatus).toBe('approved')
    expect(doc.dataSource?.source).toBe('manual-import')
    expect(doc.dataSource?.externalId).toBe('E2E-IDEMP-1')
  })

  it('更新时不改 slug——改 slug 会断掉已有前台 URL', async () => {
    const before = await payload.findByID({
      collection: 'listings', id: createdListingIds[0], depth: 0, overrideAccess: true,
    })
    await runSupplyImportBatch({
      payload, type: 'listings',
      validRows: [{ ...rows('E2E-IDEMP-1')[0], title: '改了标题' }],
    })
    const after = await payload.findByID({
      collection: 'listings', id: createdListingIds[0], depth: 0, overrideAccess: true,
    })
    expect(after.slug).toBe(before.slug)
    expect(after.title).toBe('改了标题')
  })

  it('单行失败不阻断后续行，也不回滚已成功的行', async () => {
    const result = await runSupplyImportBatch({
      payload, type: 'listings',
      validRows: [
        { ...rows('E2E-BAD')[0], buildingId: 99999999 },
        rows('E2E-GOOD-1')[0],
      ],
    })
    expect(result.failed).toBe(1)
    expect(result.created).toBe(1)
    createdListingIds.push(...result.affectedIds)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-task-postgres.test.ts
```

预期：FAIL，`runSupplyImportBatch` 不存在。若整个 describe 显示 skipped，
说明 `DATABASE_URL` 没配，先给本 worktree 配好独立 PG 库再继续——skip 不算通过。

- [ ] **Step 3: 实现 `runSupplyImportBatch`**

要点：

1. **幂等查找**：
   ```ts
   const existing = await payload.find({
     collection,
     where: {
       and: [
         { 'dataSource.source': { equals: 'manual-import' } },
         { 'dataSource.externalId': { equals: row.externalId } },
       ],
     },
     limit: 1, depth: 0, overrideAccess: true,
   })
   ```
   命中 → `update`，未命中 → `create`。
2. **落地状态显式写死**，不依赖 `adminAutoPublish` 的副作用（规格 §3）：
   房源 `reviewStatus: 'approved'`、`publicationStatus: 'published'`、`supplyVisibilityHold: 'normal'`；
   楼盘 `status: 'published'`、`operationalStatus: 'active'`。
3. **slug**：`create` 时 `slug: await uniqueSlug(payload, collection, slugify(name))`，
   冲突则追加 `-2`、`-3`… 直至唯一；`update` 时**不动 slug**。
4. `dataSource: { source: 'manual-import', externalId: row.externalId, syncedAt: new Date().toISOString() }`。
5. 单行 `try/catch`：失败计入 `failed` 并把错误信息推进 `errors`，**继续下一行**，
   不回滚已成功的行。
6. 唯一索引冲突（PG `23505`）视为并发重复：重新按 externalId 查一次改走 update 路径，
   仍失败才计 `failed`。判定复用 `submission-notify.ts:64` `isUniqueViolation` 的写法
   （逐层看 `cause` 的 `code === '23505'`，最多 5 层）。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-task-postgres.test.ts
```

预期：4 个用例 PASS。

- [ ] **Step 4b: 补两条规格 §9 明确要求、上面没覆盖的用例**

追加到同一个 spec 文件，写 → 跑失败/跑通过各自单独执行：

```ts
it('局部唯一索引真的拦得住绕过应用层的重复写入', async () => {
  // 直接用 Local API 造第二条同 (source, externalId) 的房源，绕开 runSupplyImportBatch 的查重
  await expect(
    payload.create({
      collection: 'listings',
      data: {
        title: '越过应用层的重复', listingType: 'office', building: buildingId,
        slug: 'dup-index-probe',
        reviewStatus: 'approved', publicationStatus: 'published',
        dataSource: { source: 'manual-import', externalId: 'E2E-IDEMP-1' },
      },
      overrideAccess: true,
    }),
  ).rejects.toThrow()
  // 拦住了就说明 Task 1 的局部唯一索引真的建上了，而不是只靠应用层自觉
})

it('ADM 与 OPS 两种操作者导出的落地状态一致', async () => {
  // 落地状态由 runSupplyImportBatch 显式写死，不受 adminAutoPublish 的操作者身份影响
  const asOps = await runSupplyImportBatch({
    payload, type: 'listings',
    req: await createLocalReq({ user: opsUser }, payload),
    validRows: rows('E2E-ROLE-OPS'),
  })
  createdListingIds.push(...asOps.affectedIds)
  const doc = await payload.findByID({
    collection: 'listings', id: asOps.affectedIds[0], depth: 0, overrideAccess: true,
  })
  expect(doc.publicationStatus).toBe('published')
  expect(doc.reviewStatus).toBe('approved')
})
```

`createLocalReq` 从 `payload` 包 import；`opsUser` 在 `beforeAll` 里查一个 OPS 角色的用户
（没有就跳过这条断言并在测试名里说明，**不要造一个假 user 对象糊弄过去**）。

- [ ] **Step 5: 包装成 TaskConfig 并分片**

`supplyImportTask` 的 handler：
读批次 → `status='running'` → 按 `SUPPLY_IMPORT_CHUNK` 切片调用 `runSupplyImportBatch` →
**每片结束就 `payload.update` 批次的 `stats`**（页面轮询靠它显示进度）→
全部完成后 `status='completed'`、`finishedAt=now`、写入累计的 `affectedIds`。
任务整体抛错 → `status='failed'`，但**保留已写入的 `affectedIds`**，让回滚仍可用。

- [ ] **Step 6: 注册到 payload.config**

```ts
jobs: {
  tasks: [
    supplySubmissionNotificationTask,
    cityPartnerApplicationNotificationTask,
    cityPartnerNotificationOutboxTask,
    supplyImportTask,
  ],
  shouldAutoRun: async (payload) => {
    if (process.env.PAYLOAD_DISABLE_JOB_AUTORUN === '1') return false
    await recoverStaleCityPartnerNotificationJobs(payload)
    await recoverStaleSupplyImportJobs(payload)
    return true
  },
  autoRun: () => [
    // ...既有两条
    {
      // 导入是人触发的低频操作，但用户在页面上等结果，10 秒一轮兼顾响应与负载
      cron: '*/10 * * * * *',
      queue: SUPPLY_IMPORT_QUEUE,
      ...(process.env.PAYLOAD_DISABLE_JOB_AUTORUN === '1' ? { disableScheduling: true } : {}),
      limit: 5,
      silent: true,
    },
  ],
}
```

- [ ] **Step 7: 接上 execute handler 的真实入队**

把 Task 6 Step 5 留的 `queueImportJob` 注入点换成：

```ts
await req.payload.jobs.queue({
  task: SUPPLY_IMPORT_TASK,
  queue: SUPPLY_IMPORT_QUEUE,
  input: { batchId },
})
```

- [ ] **Step 8: 跑全量测试**

```bash
cd payload-office-platform && pnpm test && pnpm typecheck
```

预期：全绿。

- [ ] **Step 9: 提交**

```bash
git add src/domain/supply-import/import-task.ts src/payload.config.ts src/endpoints/bulk-import-endpoint.ts tests/supply-import-task-postgres.test.ts
git commit -m "feat(import): OPT-041 Task 7 导入写入 Job（幂等 + 分片 + 超时恢复）"
```

---

### Task 8: 两个后台视图

**Files:**
- Create: `src/components/admin/bulk-import/require-import-access.tsx`
- Create: `src/components/admin/bulk-import/BulkImportView.tsx`
- Create: `src/components/admin/bulk-import/BulkImportViewClient.tsx`
- Modify: `src/payload.config.ts`（`admin.components.views`）
- Modify: `src/components/admin/AdminNavigation`（供给分组加两个入口）
- Modify: `src/app/(payload)/admin/importMap.js`（重生成）

**Interfaces:**
- Consumes：Task 6 的六个路由。
- Produces：`/admin/import/buildings` 与 `/admin/import/listings` 两个页面。

- [ ] **Step 1: 写权限守卫与 server component**

`require-import-access.tsx` 照抄
`src/components/admin/geography/require-geography-access.tsx` 的结构，
把权限码换成 `data:import`，无权时渲染 Forbidden 而不是重定向
（重定向会让运营以为页面不存在）。

`BulkImportView.tsx` 按 pathname 解析模式（对齐 `GeographyListView` 的做法）：

```tsx
import type { AdminViewServerProps } from 'payload'

export default async function BulkImportView(props: AdminViewServerProps) {
  const denied = await requireImportAccess(props)
  if (denied) return denied

  const segments = props.params?.segments ?? []
  const mode: 'buildings' | 'listings' = segments.includes('buildings') ? 'buildings' : 'listings'

  return <BulkImportViewClient mode={mode} />
}
```

- [ ] **Step 2: 写 client 组件的四态机**

`BulkImportViewClient.tsx` 是一个四态机，**状态之间不能跳跃**：

| 状态 | 界面 |
|---|---|
| `idle` | 说明 + [下载模板] + [下载楼盘对照表]（仅房源模式）+ 文件选择 |
| `report` | 统计条 + **红色警示条** + 错误表格（前 50 条）+ [下载完整错误表] + [取消] + [确认导入] |
| `running` | 进度条 `已处理 120/183`，每 2 秒轮询 `GET /api/bulk-import/batches/:id` |
| `done` | 结果卡片（新建/更新/失败）+ [批量下架本批房源]（Task 9 接上）+ [再导一批] |

**红色警示条的文案是硬性要求**（规格 §3），房源模式：

```tsx
<Alert type="error" content={`确认后 ${validCount} 套房源将立即对外可见，请确认数据无误。`} />
```

楼盘模式：`确认后 ${validCount} 个楼盘将立即启用。`

错误表格被截断时（`errorCount > rowErrors.length`）必须显示
`仅显示前 ${rowErrors.length} 条，完整清单请下载错误表`，
否则运营会以为只有 50 个错。

- [ ] **Step 3: 注册视图**

```ts
views: {
  // ...既有 Geography*
  BulkImportBuildings: {
    Component: '/components/admin/bulk-import/BulkImportView',
    path: '/import/buildings',
    exact: true,
  },
  BulkImportListings: {
    Component: '/components/admin/bulk-import/BulkImportView',
    path: '/import/listings',
    exact: true,
  },
},
```

- [ ] **Step 4: 重生成 importMap（漏了必白屏）**

```bash
cd payload-office-platform && pnpm payload generate:importmap
```

- [ ] **Step 5: 浏览器验证**

启动 dev（本 worktree 用独立 `PORT`），登录后访问 `/admin/import/listings`。逐条确认：

1. 页面正常渲染，不是白屏（白屏 + 资源全 200 = importMap 没重生成）。
2. [下载模板] 能下到一个只有表头的 xlsx。
3. 上传一个含错误行的表，能看到统计条、红色警示条、错误表格。
4. 用无 `data:import` 权限的账号访问，看到 Forbidden 而不是表单。
5. 直接 `curl` 打 `POST /api/bulk-import/preflight`（不带登录态），返回 403。

**截图存 `artifacts/verification/OPT-041/`**，别粘进对话或 PR 正文。

- [ ] **Step 6: 提交**

```bash
git add src/components/admin/bulk-import/ src/payload.config.ts src/app/\(payload\)/admin/importMap.js artifacts/verification/OPT-041/
git commit -m "feat(import): OPT-041 Task 8 批量导入后台视图（上传/报告/轮询/结果）"
```

---

### Task 9: 按批次回滚

**Files:**
- Create: `src/domain/supply-import/batch-rollback.ts`
- Modify: `src/endpoints/bulk-import-endpoint.ts`（增 `POST /bulk-import/batches/:id/rollback`）
- Modify: `src/components/admin/bulk-import/BulkImportViewClient.tsx`（接按钮）
- Test: `tests/supply-import-rollback-postgres.test.ts`

**Interfaces:**
- Consumes：Task 1 的批次集合（`affectedIds`）、Task 7 写入的数据。
- Produces：
  ```ts
  export function rollbackImportBatch(params: {
    payload: Payload; req?: PayloadRequest; batchId: number | string
  }): Promise<{ unpublished: number; skipped: number }>
  ```
  端点新增第七条路由 `POST /bulk-import/batches/:id/rollback`，
  Task 6 的六路由契约测试需同步改为七条。

- [ ] **Step 1: 写失败测试（真库）**

`tests/supply-import-rollback-postgres.test.ts`，三条关键断言：

```ts
it('把本批房源打回下架，而不是删除', async () => {
  const result = await rollbackImportBatch({ payload, batchId })
  expect(result.unpublished).toBe(1)
  const doc = await payload.findByID({ collection: 'listings', id: listingId, overrideAccess: true })
  expect(doc.publicationStatus).toBe('unpublished')
})

it('文档仍然存在——回滚绝不物理删除', async () => {
  await expect(
    payload.findByID({ collection: 'listings', id: listingId, overrideAccess: true }),
  ).resolves.toBeTruthy()
})

it('重复回滚幂等，已下架的计入 skipped', async () => {
  const again = await rollbackImportBatch({ payload, batchId })
  expect(again).toMatchObject({ unpublished: 0, skipped: 1 })
})
```

`beforeAll` 里先跑一次 `runSupplyImportBatch` 造出一个带 `affectedIds` 的
`completed` 批次，`afterAll` 清理创建的房源。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-rollback-postgres.test.ts
```

预期：FAIL，`rollbackImportBatch` 不存在。

- [ ] **Step 3: 实现 `batch-rollback.ts`**

读批次 `affectedIds` → 逐个 `findByID` → 已经不是 `published` 的计 `skipped` →
其余 `payload.update({ data: { publicationStatus: 'unpublished' } })`。
楼盘批次的回滚是 `status: 'archived'`（不动 `operationalStatus`——那是另一条轴）。

**任何分支都不得调用 `payload.delete`。** 实现完 `rg -n "delete" src/domain/supply-import/batch-rollback.ts`
确认零命中。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm exec vitest run tests/supply-import-rollback-postgres.test.ts
```

预期：3 个用例 PASS。

- [ ] **Step 5: 加端点与审计，并更新路由契约测试**

`POST /bulk-import/batches/:id/rollback`：`guardImport` → 调用 `rollbackImportBatch` →

```ts
await writeAuditSuccess({
  payload: req.payload, req,
  data: {
    action: 'data.import',
    object: { collection: 'supply-import-batches', id: batchId },
    after: { rollback: true, unpublished },
  },
})
```

同步把 `tests/supply-import-endpoint.test.ts` 的路由清单从六条改为七条
（加 `'POST /bulk-import/batches/:id/rollback'`），跑一遍确认仍绿。

- [ ] **Step 6: 接上前端按钮**

`done` 状态的 [批量下架本批房源] 调该端点，成功后就地显示 `已下架 N 套`。
按钮需二次确认弹窗（Arco `Modal.confirm`），文案：
`将把本批 N 套房源全部下架，前台立即不可见。`

- [ ] **Step 7: 提交**

```bash
git add src/domain/supply-import/batch-rollback.ts src/endpoints/bulk-import-endpoint.ts src/components/admin/bulk-import/BulkImportViewClient.tsx tests/supply-import-rollback-postgres.test.ts tests/supply-import-endpoint.test.ts
git commit -m "feat(import): OPT-041 Task 9 按批次回滚（下架而非删除）+ 审计"
```

---

### Task 10: E2E 全链路

**Files:**
- Create: `tests/e2e/bulk-import.spec.ts`

**Interfaces:**
- Consumes：Task 8 的两个视图、Task 6/7/9 的七条端点。

- [ ] **Step 1: 现场生成 fixture，不往 git 里塞二进制**

在 spec 的 `beforeAll` 里用 exceljs 现场生成一个含 **2 行正确 + 1 行错误** 的临时
xlsx，写到 `test-results/` 下，`afterAll` 删掉。行内的楼盘编号取种子数据里真实存在的楼盘。

- [ ] **Step 2: 写 E2E**

```ts
import { expect, test } from '@playwright/test'

test('批量导入房源：预检 → 确认 → 上架 → 回滚', async ({ page }) => {
  await loginAsAdmin(page)   // 复用既有 e2e 登录辅助（见 tests/e2e/admin-navigation.spec.ts）
  await page.goto('/admin/import/listings')

  await page.setInputFiles('input[type=file]', fixturePath)

  // 预检报告：2 通过 1 错误，红条必须出现
  await expect(page.getByText('2 行可导入')).toBeVisible()
  await expect(page.getByText(/将立即对外可见/)).toBeVisible()

  await page.getByRole('button', { name: '确认导入' }).click()

  // 轮询到完成（Job 10 秒一轮，给足 60 秒）
  await expect(page.getByText('新建 2')).toBeVisible({ timeout: 60_000 })

  // 前台真的能查到
  const front = await page.context().newPage()
  const res = await front.goto(`/listings/${importedSlug}`)
  expect(res?.status()).toBe(200)

  // 回滚后前台查不到
  await page.getByRole('button', { name: '批量下架本批房源' }).click()
  await page.getByRole('button', { name: '确定' }).click()
  await expect(page.getByText('已下架 2')).toBeVisible()

  const after = await front.goto(`/listings/${importedSlug}`)
  expect(after?.status()).toBe(404)
})
```

`importedSlug` 从完成后的结果卡片里读，或用 `GET /api/bulk-import/batches/:id`
拿 `affectedIds` 再查一次——**不要硬编码 slug**，它是 `slugify` 现场生成的。

- [ ] **Step 3: 跑 E2E**

```bash
cd payload-office-platform && E2E_PROD_SERVER=1 pnpm test:e2e tests/e2e/bulk-import.spec.ts
```

预期：PASS。用生产 server 避开 `next dev` 的逐路由 JIT 编译超时。

- [ ] **Step 4: 跑全量闸门**

```bash
cd payload-office-platform && pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

预期：全绿。

- [ ] **Step 5: 证据归档**

把 E2E 报告、导入前后的前台截图、`migrate:status` 输出存到
`artifacts/verification/OPT-041/`。PR 正文只放短摘要和链接。

- [ ] **Step 6: 提交**

```bash
git add tests/e2e/bulk-import.spec.ts artifacts/verification/OPT-041/
git commit -m "test(e2e): OPT-041 Task 10 批量导入全链路（预检/上架/回滚）"
```

---

## 完成判据

只有下列全部有证据时才可声明完成（`.agent/testing.md`）：

- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 全绿
- [ ] `pnpm migrate:status` 无 pending，`grep -c "prefix" src/payload-types.ts` 输出 2
- [ ] E2E `bulk-import.spec.ts` 通过
- [ ] 浏览器实测：有权限账号能走完全流程；无 `data:import` 账号看到 Forbidden；
      未登录 `curl` 打预检端点返回 403
- [ ] 幂等实测：同一张表连传两次，前台房源数不翻倍
- [ ] 回滚实测：点下架后前台立即查不到，且文档仍在库里
- [ ] 证据归档在 `artifacts/verification/OPT-041/`

## 已知剩余风险（交付时必须说明）

1. **房源直接上架**（规格 D4，用户决定）：一张手工 Excel 直连前台，绕过审核闸门。
   补偿是预检红条与按批次回滚，不是消除风险。
2. **`validRows` 7 天清理任务本计划未包含**：字段和口径已就位（Task 1），
   实际的定时清理留作后续小工作项——不清理只是占空间，不影响正确性。
3. **别名表初期需要人工补录**：首次导入预计要补几十条别名，运营需要
   `location:manage` 权限才能加。这是设计选择（D8），不是缺陷。
