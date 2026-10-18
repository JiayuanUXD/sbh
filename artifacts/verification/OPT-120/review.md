# OPT-120 独立代码审查

审查日期：2026-10-17。审查对象为当前工作树中楼盘 slug 自动生成的未提交实现；依据已批准的 `specs/work-items/OPT-120-building-auto-slug.md`。本次仅审阅代码与本地已安装的 Payload 实现，并写入本报告；未修改业务代码、未写数据库、未提交或推送。

## 结论

未发现需要修复的实际缺陷；没有 P1/P2/P3 可操作问题。实现符合本次批准的规格，未发现扩大业务范围或改变历史地址的路径。

## 核对结果

- **生成和必填校验时机正确。** `payload-office-platform/src/collections/Buildings.ts:231` 把生成器接入集合 `beforeValidate`。`payload-office-platform/src/domain/supply/building-slug.ts:23` 复用 `slugify` 与 `ensureUniqueSlug`，中文名称生成拼音，空基名回退为 `building`，冲突依次使用后缀。直接核对本地 Payload 的 `dist/collections/operations/create.js:106` 与 `dist/fields/hooks/beforeChange/promise.js:86`，集合钩子先运行，字段 required 校验后运行；更新流程也维持该顺序。
- **历史地址与 API 自定义值得到保留。** `payload-office-platform/src/domain/supply/building-slug.ts:13` 优先保留显式非空字符串；`:15` 对省略、空串和空白 slug 的更新恢复原标识，因此改名与部分更新不会生成新地址。仅旧记录确实缺失标识时，才使用提交名称或原名称补齐。
- **去重范围、权限和事务符合规格。** `payload-office-platform/src/domain/supply/building-slug.ts:24` 查询没有状态筛选，`:32` 显式 `overrideAccess: true`，`:33` 使用 `trash: true`，`:34` 传递同一 `req`；更新缺失标识的旧记录时排除自身 ID。直接核对本地 Payload `dist/utilities/appendNonTrashedFilter.js:1`，`trash: true` 包含正常与软删除文档。Buildings 使用业务 `status` 字段，没有启用 Payload 独立版本草稿，不存在漏查版本表的边界。
- **表单撤下输入且保留服务端字段。** `payload-office-platform/src/collections/Buildings.ts:302` 保留 slug 的 `required`、`unique`，仅设置 `admin.disabled: true`；名称通过 `afterInput` 复用 `ListingSlugBadge`。本地 Payload `@payloadcms/ui/dist/forms/fieldSchemasToFormState/addFieldStatePromise.js:90` 确认禁用字段不会构建普通字段表单状态。该设置没有新增顶层 `hidden` 或 API 访问限制。
- **展示和生成物变更范围合理。** `ListingSlugBadge` 仍读取 `useDocumentInfo().data.slug`，新建未保存时返回空；组件本次仅更新注释。`custom.scss` 把现有窄屏内边距规则扩展至楼盘，桌面样式原已覆盖两类编辑页。import map 仅因首次注册遍历顺序移动既有条目，没有组件重复或漏注册。
- **测试覆盖核心分支。** `payload-office-platform/tests/building-slug.test.ts:44` 起覆盖生成、连续冲突、状态无筛选、回收站、旧值稳定、自定义值、符号、部分更新、自身排除和缺名称；`tests/building-form-layout.test.ts:115` 起守护字段 required/unique、禁用方式和名称图标注册。相关已跟踪文件的 `git diff --check` 通过。

## 证据边界与交接

- 单测在 Local API 边界替代 `find`，本身不能证明真实 PostgreSQL 事务、唯一索引、REST 序列化或浏览器持久化。此次审查通过框架源码补核钩子顺序、禁用字段与回收站过滤；真实创建、第二条同名、改名、保存抓包和刷新回显仍应以主代理的浏览器证据为准。
- 并发同名创建仍可能有一个请求被现有唯一约束拒绝；批准的规格已明确接受该边界，本次不将其列为缺陷，也不要求增加重试或分布式分配。
- 按分工未重复执行全量单测、typecheck、lint、构建或数据库写入。上述检查结果应汇总至本任务 `verification.md`，不能从本报告推断已经通过。
- `next-env.d.ts` 为先前生成改动，已排除审查。
