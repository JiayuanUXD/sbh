# M3.4 完成楼盘列表和详情体验 — 实施计划

日期：2026-07-25 ｜ 分支：`feat/payload-native-shadcn-admin` ｜ 需求：R3、R7

## 任务原文（specs/backend-mvp/tasks.md 178-181）

- 增加城市、区域、商圈、等级和状态筛选。
- 展示有效房源套数、面积和租金聚合。
- 完成预览、查看房源、启停和导出动作。

## 已锁定的架构决策

1. **UI 库 = Arco**（沿用现状，与 DashboardOverview/LocationTreeView 一致，零迁移成本）。
2. **导出 = 受控导出**：加 `data:export` 权限门 + 审计；优先复用 import-export 插件生成的 `exports` 集合的 access/afterChange 钩子，不可行则自建导出 endpoint。满足 design §6.1「导入导出单独校验权限并写审计」与验收原则 line 7「先服务端权限和审计再开按钮」。
3. **启停写操作门 = `building:freeze`**（语义即"停用"）；`deactivation-impact` 只读接口维持 `building:update`。二者语义区分：读影响用更新权限，写停用用冻结权限。
4. **聚合展示落点 = 楼盘详情/编辑视图**（非列表逐行）。原生 List View 无法逐行跑异步聚合；R3 末条要求"预览楼盘时展示房源聚合"，编辑视图 `beforeDocumentControls` 是正确落点。
5. **筛选 = Payload 原生 List View 字段筛选 + Saved Filters**（design §7.1 原生列表优先，楼盘明确不做 Custom View）。

## 过渡口径（design §5 + F1.6/M4.7 降级说明）

统一有效供给谓词的完整 10 条依赖 M4 才有的字段。M3 阶段用已确认的过渡口径：
`status='available'`（Listing）+ `building.operationalStatus='active'` + `deletedAt:{exists:false}`。
复用 `listingBuildingOperationalWhere()`（`@/domain/supply/building`），不重写谓词。

## 子项 1 — 城市/区域/商圈/等级/状态筛选

Buildings 已有全部字段：`city`/`district`/`businessDistrict`（relationship→locations，带 activeLocationFilter）、`grade`（select）、`status`（select）。Payload 原生 List View 的 Filters 按钮已可对这些字段过滤，无需新组件。

改动（`src/collections/Buildings.ts`）：
- `admin.defaultColumns` 增补 `city`、`operationalStatus`，让筛选后关键列可见。
- 各字段确保 `admin.` 未隐藏筛选（Payload 默认可筛，无需额外配置；仅验证 relationship 字段筛选下拉正常）。
- Saved Filters 由用户在后台自行保存，无需代码——计划内不预置。

无新增测试（纯配置，靠 build + 浏览器验收）。

## 子项 2 — 有效房源套数/面积/租金聚合（TDD 纯函数）

新增 `src/domain/supply/building-aggregate.ts`，镜像 `building-references.ts` 签名与 `overrideAccess ?? false` 约定：

```
computeBuildingSupplyAggregate(payload, buildingId, req?, options?: { overrideAccess? })
  => { buildingId, count, totalArea, rentRanges: {unit,min,max,count}[] }
```

- **套数**：`payload.count`，where = `{ building:{equals:id}, status:{equals:'available'}, 'building.operationalStatus':{equals:'active'}, deletedAt:{exists:false} }`。
- **面积/租金**：`payload.find`（`pagination:false`，limit 上限如 200，对齐 supply-adapter.ts:216）→ JS reduce。面积统一 ㎡ 可直接 SUM；**租金按 `rentUnit` 分组**求 min/max（design §5.5，三种单位不可合并，镜像 facade.ts:479 `buildPriceRangesByUnit`）。
- 类型经 `unknown` + 守卫读取 relationship/数值，禁 `any`。
- barrel `src/domain/supply/index.ts` 导出函数与类型。

测试 `tests/building-aggregate.test.ts`：`vi.fn` mock `payload.count`/`payload.find` cast `as never`，断言 where 形状、`overrideAccess` 透传、混合 rentUnit 分组不合并、空结果。先红后绿。

## 子项 3 — 四个动作

均遵守 tasks.md 执行原则第 7 条：**先服务端权限+审计，再开放按钮**。UI 全用 Arco。服务端组件抽取可序列化字段 → `*Client.tsx` 交互（镜像 CopyRoleButton 对）。

**① 预览**：`Buildings.admin.preview` 已存在（`/buildings/${slug}`），无需改。聚合卡片（子项 2 结果）作为楼盘编辑视图内展示，满足 R3「预览展示符合有效供给谓词的房源聚合」。

**② 查看房源**：纯链接按钮，无 endpoint。Arco `<Button href="/admin/collections/listings?where[building][equals]=<id>">`（对齐 DashboardOverview 链接范式）。

**③ 启停（二次确认）**：
- 新 endpoint `POST /buildings/:id/toggle-operational-status`，镜像 building-merge-endpoint 模板；门禁 `building:freeze`（停用语义专用码，非 `building:update`——同时把 M3.5 的 deactivation-impact endpoint 门禁改齐为 `building:freeze` 以消除不一致）。
- handler：`req.routeParams.id` → 读当前 `operationalStatus` → 翻转 → `payload.update`。**只改 operationalStatus，绝不碰 Listing 的 status/审核/发布**（R3、M3 验收门第 3 条、R8）。写审计（复用 auditFieldsPlugin/领域审计）。
- 停用前调用现有 `deactivation-impact` endpoint 取受影响房源数 → Arco Modal 二次确认（M3.5 语义）。
- 组件对：`BuildingOperationalToggle.tsx`（server，抽 id/operationalStatus/name）+ `BuildingOperationalToggleClient.tsx`（client，Modal+fetch）。注册于 `Buildings.admin.components.edit.beforeDocumentControls`。

**④ 受控导出**（用户已选）：
- 复用 `@payloadcms/plugin-import-export` 自动生成的 `exports` 集合，但补：`exports.access.create` 挂 `data:export` 权限门（无权返回拒绝），`afterChange`/`afterOperation` 写审计。字段脱敏由现有 API 层继承（R1，手机号等在无 `phone:full` 时脱敏）。
- 批量上限 50 + 幂等请求 ID（design §10）——若插件不支持配置，则在受控层校验。
- 若插件不支持覆盖生成集合的 access，则退化为新增 `POST /buildings/export` endpoint（门禁 `data:export`+审计+脱敏+上限 50），并隐藏插件默认导出按钮。实现时先验证插件能力，再定选型。

测试：endpoint 的权限门（401/403/成功翻转）、启停只改 operationalStatus 不动 Listing。

## 门禁与验收

三门：`pnpm typecheck` / `pnpm test`（新增用例全绿）/ `pnpm build`。浏览器验收（preview_*）：筛选生效、聚合卡片数值正确、四动作可用、停用后 C 端不可见且 Listing status 不变（M3 验收门第 3 条）。

## 迁移

无新增字段（operationalStatus 已由 M3.1 迁移建列），**预期零迁移**。实现末尾跑 `pnpm migrate:status` 确认无 pending。

## 不做 / 边界

- 不做 Custom View（楼盘列表属原生列表优先，design §7.1）。
- 不碰 M2.1 locations 迁移的 `immutable_code NOT NULL` BLOCK（越界，另行处理，禁手改迁移正文）。
- 不提交（用户指令「暂时不提交」）。
- 完整 10 条有效供给谓词依赖 M4 字段，本期用过渡口径，代码标注 M4.7 替换点。
