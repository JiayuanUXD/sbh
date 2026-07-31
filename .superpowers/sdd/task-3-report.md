# Task 3 — 楼盘供给分组、聚合、筛选和排序

## 状态

完成并提交前验证通过。

## RED / GREEN 证据

1. RED：新增 `tests/building-supply.test.ts` 后执行：

   ```sh
   npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test -- tests/building-supply.test.ts'
   ```

   结果：预期失败，`Cannot find package '@/domain/public-catalog/building-supply'`。

2. GREEN：创建 `building-supply.ts` 和快照契约后重跑相同命令，2/2 通过。

3. RED：为 `getRelatedBuildings` 加入契约测试后，测试按预期失败：`getRelatedBuildings is not a function`。

4. GREEN：导出并实现门面及适配器方法后，`tests/building-supply.test.ts` 3/3 通过；随后加入单次楼内供给查询断言，最终为 4/4 通过。

## 实现

- 新增 `buildBuildingSupplySnapshot(cards, input, asOf)`、`emptyBuildingSupplySnapshot(asOf)` 和稳定公开 DTO：`BuildingSupplySnapshot`、分组与完整价格键区间。
- 联合办公使用现有且明确的领域判别 `listingType === 'coworking'`；该类型优先于租赁 businessType。
- 价格区间的唯一键是 `businessType:currency:period:basis`；不会跨完整键合并或比较。
- 价格排序遇到混合完整价格键且未提供 `priceUnit` 时返回 `price_unit_required`，并只以稳定 ID 收束，不会选择任意单位排序。
- `price === null`（待面议）卡片不被过滤或聚合流程丢弃；显式 `priceUnit` 过滤也保留它们。
- `getBuildingDetail` 改为 `{ building, supply }`，空楼盘返回同一 `ctx.asOf` 的空快照；通过兼容 overload 保留原有第三参数 adapter 注入方式，并支持传入供给筛选输入。
- `getRelatedBuildings` 与 `SupplyAdapter.findEffectiveBuildingsNear` 已加入。默认适配器先读取当前楼盘的商圈（无商圈时行政区），应用同一公开楼盘谓词（已发布、未删除、active），排除自身，并按坐标距离或稳定 ID 排序；没有通过历史房源推断楼盘状态。
- 楼盘页面、既有 façade/一致性/生产等价性测试已迁移至 `supply.groups`。

## Query / asOf 证据

`tests/building-supply.test.ts` 的 `getBuildingDetail` 测试断言：

- `findEffectiveListingsByBuilding` 调用次数：**1**；
- `findEffectiveBuildingBySlug` 和唯一一次楼内供给查询接收到的 `asOf`：均为 `2026-07-30T10:00:00.000Z`；
- 返回快照的 `totalEffectiveListings` 为该同一 raw 集合映射所得。

## 验证

```sh
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test -- tests/building-supply.test.ts tests/public-catalog-effective-supply-consistency.test.ts tests/public-catalog-facade.test.ts && pnpm typecheck'
```

结果：67/67 通过，`tsc --noEmit` 通过。

```sh
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test'
```

结果：121 个测试文件、2153 个测试全部通过。

## 自审

- 复核完整价格 key 的范围聚合与价格排序路径：没有以 `displayUnit` 作为比较或合并键。
- 复核联合办公分组：使用项目 schema 中已有 `listingType` 枚举，未杜撰判别字段。
- 复核相关楼盘：只查询 buildings 集合；不从 listing 历史状态反推；默认路径排除自身并有稳定排序。
- `git diff --check` 通过。

## 关注点

- 价格请求卡在显式价格单位筛选时仍保留，以满足“不能丢弃”的要求；UI 若需只显示可报价条目，应提供独立的显式筛选条件，而不是复用 `priceUnit`。

## Review follow-up（Task 3 requested changes）

### RED / GREEN

新增下列回归到 `tests/building-supply.test.ts` 后执行：

```sh
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test -- tests/building-supply.test.ts'
```

RED：7 个测试中 3 个按预期失败：

- `BuildingSupplyPriceRanges` 未导出，不能渲染跨组的相同完整价格键；
- `limit=0/-1/NaN` 仍调用了 fake adapter；
- `rankRelatedBuildingsByProximity` 不存在。

GREEN：实现后同一命令 7/7 通过；聚焦 `building-supply` + `public-catalog-facade` 为 41/41 通过。

### 修复

- 楼盘页增加 `BuildingSupplyPriceRanges`，以供给组嵌套渲染价格范围，显式显示“出租 / 出售 / 联合办公”；行 React key 与 `data-price-range-key` 均为 `${group.key}:${range.key}`，使跨组相同完整价格键可区分。房源卡也按供给组可见地嵌套，key 包含组键。
- `findEffectiveBuildingsNear` 现在用 Payload 3.86.0 支持的 `pagination: false` 且**省略** `limit`。本地 Payload 类型源码注释确认 `pagination: false` 会返回全部文档；因此先得到完整商圈/行政区候选、过滤有效公开楼盘、距离/ID 排序，再截取规范化 limit。回归使用 ID 2–31 的远候选和 ID 99 的最近候选，确认 ID 99 取胜。
- `getRelatedBuildings` 在任何适配器调用前将 limit 规范化为非负整数；零、负数及 NaN 立即返回 `[]`。默认适配器也作相同防御，避免直接调用时将不安全 limit 传入 Payload。

### Follow-up 验证

```sh
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test -- tests/building-supply.test.ts tests/public-catalog-facade.test.ts && pnpm typecheck'
```

结果：41/41 通过，typecheck 通过。

```sh
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'pnpm test'
```

结果：121 个文件、2156 个测试全通过。

### Follow-up files

- `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- `payload-office-platform/src/domain/public-catalog/facade.ts`
- `payload-office-platform/src/domain/public-catalog/supply-adapter.ts`
- `payload-office-platform/tests/building-supply.test.ts`
