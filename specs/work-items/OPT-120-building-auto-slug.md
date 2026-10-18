# OPT-120 楼盘 URL 标识自动生成实施计划

> 执行方式：同一会话内由子代理实现，主代理核对规格、代码质量与浏览器结果。用户已于本会话确认下述方案；未经确认不提交、推送、创建 PR 或部署。

**目标：** 楼盘新建时无需手填 URL 标识，自动生成且保持已有地址稳定。

**架构：** 在 Buildings 的 beforeValidate 阶段补全 slug，复用 `slugify` 与 `ensureUniqueSlug`。表单复用 `ListingSlugBadge` 展示已保存的标识，slug 字段保留 required、unique 和 API 可读性，仅从表单编辑状态中撤下。

**技术栈：** Next.js 16、Payload 3.86、PostgreSQL、pnpm 8.6.1、Vitest、真实浏览器。

## 全局约束与已确认设计

- 新建未提供 slug 时按楼盘名称生成拼音；重复依次追加 `-2`、`-3`。
- 已有标识在楼盘改名或普通保存时保持原值；显式传入的自定义标识保留，沿用现有 API 行为。
- 名称仅含符号时使用 `building` 基名并参与去重；缺少名称仍由 required 校验拒绝。
- 唯一性检查覆盖草稿、已发布、下架和回收站中的楼盘，并复用请求事务。
- 名称旁只读展示已保存的标识，新建未保存时无标识图标；不增加预览生成逻辑。
- 不变更数据库字段、约束、历史地址或房源逻辑，不引入依赖，不自动增加重定向。
- 在专用分支 `codex/building-auto-slug-b7e41a` 使用当前专属工作树与本地开发服务；保留既有 `next-env.d.ts` 改动。
- 所有说明文档与用户可见文案使用简体中文。

## Task 1：生成、展示与回归验证

**文件：**

- 新增 `payload-office-platform/src/domain/supply/building-slug.ts`：单一 beforeValidate hook。
- 修改 `payload-office-platform/src/collections/Buildings.ts`：挂载 hook、名称旁展示标识、撤下 slug 手填框。
- 修改 `payload-office-platform/src/components/admin/ListingSlugBadge.tsx`：仅调整注释，说明房源与楼盘复用。
- 视实际需要修改 `payload-office-platform/src/app/(payload)/custom.scss`：楼盘窄屏标识图标沿用房源内边距。
- 新增 `payload-office-platform/tests/building-slug.test.ts`；修改现有 `tests/building-form-layout.test.ts`。
- 重新生成 types / import map；若 import map 无实际差异，不制造额外改动。

**接口：** 导出 `ensureBuildingSlug: CollectionBeforeValidateHook`；输入 Payload 的 data、originalDoc、operation、req，输出补齐 slug 的 data。查询使用 `collection: 'buildings'`、`overrideAccess: true`、`trash: true`、`req`，避免权限或软删除过滤漏掉已占用值。

- [x] 先运行现有楼盘、房源 slug 与表单测试，确认基线。
- [x] 先写失败测试，覆盖拼音生成、连续重名、已有地址在改名时稳定、自定义值、符号名称、回收站占用、部分更新。
- [x] 确认失败来自缺失功能，再实现最小 hook。先于 required 字段校验生成，复用 shared/slug 工具。
- [x] 改造表单并更新表单契约测试。slug 必须保留 `required: true`、`unique: true`，使用 `admin.disabled: true`，不得使用顶层 hidden。
- [x] 运行针对性测试、类型生成、import map 生成、typecheck、lint 与全量单测。
- [x] 在本地浏览器中创建两条同名草稿楼盘，确认无 slug 手填框、生成不同标识，抓取保存请求/响应，刷新后核验。
- [x] 修改测试楼盘名称并保存，刷新后确认 slug 不变；核对已存在楼盘的标识展示和表单布局。只使用专用测试记录，测试记录最终移入回收站。
- [x] 由独立子代理审查规格符合性与代码质量，修正实际问题；保存验证结果到 `artifacts/verification/OPT-120/verification.md`。

### 测试判据示例

```ts
expect((await createBuilding({ name: '创科大厦' })).slug).toBe('chuang-ke-da-sha')
expect((await createBuilding({ name: '创科大厦' }, ['chuang-ke-da-sha'])).slug).toBe('chuang-ke-da-sha-2')
expect((await updateBuilding({ name: '改名' }, { slug: 'original-url' })).slug).toBe('original-url')
```

## 回滚与范围

本项只修改应用逻辑和后台展示，不需要数据库迁移。撤回代码即可恢复手填行为；新建记录的标识仍是合法的现有字段值。并发新建同名时继续由现有唯一约束兜底，不扩大为分布式 slug 分配系统。
