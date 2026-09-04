# MP-109 小程序真实闭环与交互抽屉修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MP-106/107 审查中的真实性、数据契约、用户资产和验收假绿问题，并把筛选/咨询抽屉做成真实打开态可验收的原生小程序组件。

**Architecture:** 继续复用现有 Mini session、咨询 controller、Public Catalog 和 Payload；新增私有 `mini-user-assets` 集合，以稳定、不可逆 session subject 关联收藏和 Lead。筛选/咨询抽屉共享视觉行为规范但保留独立状态机，页面负责原生 TabBar 与背景锁定。

**Tech Stack:** TypeScript 5.9、原生微信小程序 WXML/WXSS、Next.js 16、Payload 3.86、PostgreSQL、Vitest 4、miniprogram-automator、Node.js 22.23.2、pnpm 8.6.1。

## Global Constraints

- 禁止触碰生产环境；不得执行生产部署、生产迁移、生产流量或生产数据库写入。
- 分支固定为 `feat/miniprogram-mvp-59f9`，工作目录固定为 `/Users/liujiayuan/App/wt-mp-59f9`。
- 所有提交使用显式 `git add <具体路径>`；禁止 `git add .`、`git add -A`、`git commit -am` 和 `--no-verify`。
- 数据库 `push: false`；collection 变化必须运行 `payload migrate:create`，生成后的迁移正文禁止手工修改。
- 所有生产代码变更遵循 RED → GREEN → REFACTOR；报告必须记录失败测试和通过测试的命令与输出。
- 禁止 `any`、`@ts-ignore`、伪造 `0`、伪造成功状态和未经 DTO 支持的事实性文案。
- 所有 Mini 写请求必须 fail-closed；只有服务端成功响应可以驱动“已提交/已收藏”状态。
- 用户资产接口不得返回手机号、openid、内部备注、经纪人内部信息、Lead ID、幂等键、token、Secret 或审计字段。
- 抽屉使用灰底白卡、唯一蓝色交互色、系统字体、44pt 最小命中区和底部安全区；不得使用红色收藏或彩色 emoji 作为产品图标。
- Mock UI 验收与 staging/真机验收分开归档；本地 Mock 不得表述为真实业务闭环。
- MP-108 保留为上线加固与正式发布；本次所有新增任务和证据使用 MP-109。

---

### Task 1: 验收 runner fail-closed 与筛选父子合同回归

**Files:**
- Create: `sbh-miniprogram/scripts/acceptance-result.mjs`
- Modify: `sbh-miniprogram/scripts/mp106-acceptance-runner.mjs`
- Modify: `sbh-miniprogram/scripts/mp107-acceptance-runner.mjs`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.ts`
- Test: `sbh-miniprogram/tests/acceptance-runners.test.ts`
- Test: `sbh-miniprogram/tests/listings-page-contract.test.ts`

**Interfaces:**
- Produces: `assertAcceptancePassed(report: unknown): void`，递归检查 `testCases` 与 `interactions` 的每个叶节点。
- Produces: `<filter-sheet section="{{sheetSection}}" query="{{query}}" result-count="{{estimatedCount}}">`。

- [ ] **Step 1: 写 runner 失败传播测试**

  测试导入 `assertAcceptancePassed`，覆盖：任意 `{passed:false}` 抛错；空 `interactions` 在声明有必需交互时抛错；全 true 时不抛错；关键 selector 缺失路径由 runner 明确抛错而非跳过。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/acceptance-runners.test.ts tests/listings-page-contract.test.ts'`
  Expected: FAIL，原因为 helper 不存在，以及页面仍使用 `initial-section/current-query/estimated-count`。

- [ ] **Step 3: 实现最小 fail-closed helper 与真实属性绑定**

  `assertAcceptancePassed` 只接受普通对象；递归检查报告并在路径中列出失败项。两个 runner 在写报告前调用 helper，关键 selector 缺失立即 throw。删除 MP-107 的 `addSampleInquiryForDemo` 调用和页面测试专用方法。父页恢复组件实际属性名。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/acceptance-runners.test.ts tests/listings-page-contract.test.ts tests/filter-components.test.ts'`
  Expected: PASS，且故意构造 `passed:false` 的单测证明 helper 抛错。

- [ ] **Step 5: 提交**

  `git add sbh-miniprogram/scripts/acceptance-result.mjs sbh-miniprogram/scripts/mp106-acceptance-runner.mjs sbh-miniprogram/scripts/mp107-acceptance-runner.mjs sbh-miniprogram/miniprogram/pages/listings/index.wxml sbh-miniprogram/miniprogram/pages/listings/index.ts sbh-miniprogram/tests/acceptance-runners.test.ts sbh-miniprogram/tests/listings-page-contract.test.ts && git commit -m "fix(miniprogram): 阻断验收假绿并恢复筛选抽屉合同"`

### Task 2: 修复楼盘、首页 Mini DTO 的真实性与 mapper 覆盖

**Files:**
- Modify: `payload-office-platform/src/domain/mini-program/contracts.ts`
- Modify: `payload-office-platform/src/domain/mini-program/mappers.ts`
- Modify: `payload-office-platform/src/lib/mini-program/catalog-service.ts`
- Modify: `payload-office-platform/src/lib/mini-program/cached-queries.ts`
- Modify: `sbh-miniprogram/miniprogram/services/catalog-contracts.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/model.ts`
- Test: `payload-office-platform/tests/mini-api-mappers.test.ts`
- Test: `payload-office-platform/tests/mini-api-catalog-service.test.ts`
- Test: `payload-office-platform/tests/mini-api-cached-queries.test.ts`
- Test: `sbh-miniprogram/tests/catalog-contracts.test.ts`

**Interfaces:**
- Produces: `MiniBuildingGrade = 'grade-a' | 'super-grade-a' | 'creative-park' | 'serviced-office'`。
- Produces: `nearestMetro: { station: string; line: string | null; distanceMeters: number | null } | null`。
- Produces: 必填 `MiniHomeData.featuredBuildings: readonly MiniBuildingCard[]`。

- [ ] **Step 1: 写真实 mapper 失败测试**

  构造包含公共 `factGroups`、真实 grade、无线路/距离地铁、未知面积和 24 条分页的 view model；断言已有事实字段被映射、未知值为 null、未知面积不进入分组、pageSize=24、首页返回 featuredBuildings。增加坏枚举/负数/NaN 的小程序解析拒绝测试。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-api-mappers.test.ts tests/mini-api-catalog-service.test.ts tests/mini-api-cached-queries.test.ts'`
  Expected: FAIL，原因为现有 null/0/20/A-B-C 与 featuredBuildings 缺失。

- [ ] **Step 3: 实现事实字段映射与严格契约**

  增加纯函数从 fact groups 读取中文事实标签并做非负数、年份和字符串规范化；无法可靠解析时返回 null。缓存为楼盘列表/详情加入楼盘语义 tag。房源详情精简 building 没有 listingCount 时不得写 0，改为可空计数或补真实聚合。

- [ ] **Step 4: 运行两端定向测试和类型检查**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-api-mappers.test.ts tests/mini-api-catalog-service.test.ts tests/mini-api-cached-queries.test.ts && pnpm typecheck'`
  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/catalog-contracts.test.ts tests/home-model.test.ts && pnpm typecheck'`
  Expected: 全部 PASS。

- [ ] **Step 5: 提交**

  显式暂存上述文件并提交：`fix(miniprogram): 修复楼盘与首页 DTO 真实性`。

### Task 3: 新增服务端 Mini 用户资产集合与收藏/我的门面

**Files:**
- Create: `payload-office-platform/src/collections/MiniUserAssets.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/src/domain/mini-program/user-assets.ts`
- Create: `payload-office-platform/src/app/api/mini/v1/favorites/route.ts`
- Create: `payload-office-platform/src/app/api/mini/v1/me/route.ts`
- Generate: `payload-office-platform/src/migrations/*_mp109_mini_user_assets.*`
- Modify generated: `payload-office-platform/src/migrations/index.ts` only through generator
- Test: `payload-office-platform/tests/mini-user-assets-domain.test.ts`
- Test: `payload-office-platform/tests/mini-api-favorites-route.test.ts`
- Test: `payload-office-platform/tests/mini-api-me-route.test.ts`

**Interfaces:**
- Produces: `verifyMiniBearer(request): {ok:true; subject:string}|{ok:false; response:Response}` 供三个用户资产路由复用。
- Produces: `PUT/DELETE /api/mini/v1/favorites` body `{targetType:'listing'|'building', targetSlug:string}`。
- Produces: `GET /api/mini/v1/me` 严格白名单响应。

- [ ] **Step 1: 写领域与路由失败测试**

  覆盖稳定 assetKey、不同 subject 隔离、重复收藏幂等、精确取消、无 Bearer/过期 Bearer 401、无效/失效供给拒绝、跨 subject 不可读、响应递归白名单、禁止 PII/Lead ID/idempotencyKey 字段。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-user-assets-domain.test.ts tests/mini-api-favorites-route.test.ts tests/mini-api-me-route.test.ts'`
  Expected: FAIL，原因为集合、领域模块和路由不存在。

- [ ] **Step 3: 实现私有集合、领域服务与路由**

  collection 的 read/create/update/delete access 全部返回 false；API 通过 `overrideAccess:true` 操作。assetKey 由服务端 SHA-256 计算。收藏目标先调用 Public Catalog 有效供给断言；GET 只映射公开卡片和安全状态。

- [ ] **Step 4: 生成迁移**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm payload migrate:create mp109_mini_user_assets'`
  Expected: 新增迁移文件并更新迁移索引；不得手改生成正文。

- [ ] **Step 5: 运行定向测试、类型检查和迁移检查**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-user-assets-domain.test.ts tests/mini-api-favorites-route.test.ts tests/mini-api-me-route.test.ts && pnpm typecheck && pnpm migrate:dry-run'`
  Expected: 测试和类型检查 PASS；dry-run 不指向生产且迁移可解析。

- [ ] **Step 6: 提交**

  显式暂存集合、配置、领域模块、路由、测试及生成迁移，提交：`feat(miniprogram): 增加登录用户收藏与我的资产门面`。

### Task 4: 咨询目标联合合同与服务端 inquiry link

**Files:**
- Modify: `payload-office-platform/src/domain/mini-program/inquiry-schema.ts`
- Modify: `payload-office-platform/src/domain/mini-program/inquiry-idempotency.ts`
- Modify: `payload-office-platform/src/app/api/mini/v1/inquiries/route.ts`
- Modify: `payload-office-platform/src/domain/mini-program/user-assets.ts`
- Modify: `sbh-miniprogram/miniprogram/services/inquiry.ts`
- Modify: `sbh-miniprogram/miniprogram/components/inquiry-sheet/controller.ts`
- Test: `payload-office-platform/tests/mini-api-inquiry-route.test.ts`
- Test: `payload-office-platform/tests/mini-inquiry-idempotency.test.ts`
- Test: `sbh-miniprogram/tests/inquiry-service.test.ts`
- Test: `sbh-miniprogram/tests/inquiry-sheet.test.ts`

**Interfaces:**
- Produces: `MiniInquiryTarget`/`InquiryTarget` 联合：listing、building、general。
- Produces: regular Mini inquiry 强制有效 session；acceptance candidate 保持现有受保护 listing-only 合同。
- Produces: 成功/幂等命中后 `linkInquiry(subject, lead, target)`，重试可修复缺失 link。

- [ ] **Step 1: 写三类目标与归属失败测试**

  覆盖 exact-key 校验、互斥 slug、无 session 401、listing/building/general 有效供给解析、同 submission 幂等、不同 subject 隔离、Lead 已存在但 link 缺失时重试修复、link 失败时不返回成功。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-api-inquiry-route.test.ts tests/mini-inquiry-idempotency.test.ts'`
  Expected: FAIL，原因为 schema 仅支持 listing 且不保存 subject link。

- [ ] **Step 3: 实现服务端联合合同和 link 修复路径**

  regular 路径先验证 Bearer 并取得 subject；幂等键包含规范化 target descriptor。提交成功后读取 Lead 的内部 ID 并 upsert inquiry asset。任何 link 未确认不得返回 accepted。acceptance 路径不创建用户资产且继续严格受 permit 限制。

- [ ] **Step 4: 更新客户端 inquiry service/controller**

  `InquirySheetContext` 改为 `{target, title, facts, policyVersion}`；提交体序列化联合 target。成功文案仅使用服务端 `targetResolution`，不出现“已接单/已分配/30 分钟内”。

- [ ] **Step 5: 运行两端定向测试与类型检查**

  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/mini-api-inquiry-route.test.ts tests/mini-inquiry-idempotency.test.ts && pnpm typecheck'`
  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/inquiry-service.test.ts tests/inquiry-sheet.test.ts && pnpm typecheck'`
  Expected: 全部 PASS。

- [ ] **Step 6: 提交**

  显式暂存修改并提交：`feat(miniprogram): 接通楼盘与通用需求咨询归属`。

### Task 5: 小程序服务端收藏、咨询记录与个人中心闭环

**Files:**
- Replace: `sbh-miniprogram/miniprogram/services/favorites.ts`
- Replace: `sbh-miniprogram/miniprogram/services/inquiry-tracker.ts`
- Create: `sbh-miniprogram/miniprogram/services/user-assets.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `sbh-miniprogram/miniprogram/pages/listing-detail/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/building-detail/index.ts`
- Test: `sbh-miniprogram/tests/favorites-service.test.ts`
- Test: `sbh-miniprogram/tests/inquiry-tracker.test.ts`
- Test: `sbh-miniprogram/tests/profile-page-contract.test.ts`

**Interfaces:**
- Produces: async `loadUserAssets()`, `setFavorite(target, favorite)`, `refreshUserAssets()`；本地内存只作不可见缓存，不作为成功来源。
- Consumes: Task 3 的 `/favorites` 和 `/me`，Task 4 的联合咨询合同。

- [ ] **Step 1: 写客户端失败测试**

  覆盖 session 缺失、网络失败不显示成功、服务端重载恢复收藏、不同 service 实例读取同一服务端状态、profile 不展示 PII、楼盘咨询按 building 跳转、general 不伪造详情、收藏点击只展示收藏集合。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/favorites-service.test.ts tests/inquiry-tracker.test.ts tests/profile-page-contract.test.ts'`
  Expected: FAIL，原因为现有实现依赖 Storage 且页面统一跳普通列表/房源详情。

- [ ] **Step 3: 实现服务端资产客户端与页面投影**

  所有请求通过现有 request client 和 session Bearer；Storage 数据只做一次性迁移候选，未获服务端确认不显示成功。删除 `Record<string, any>` 与演示注入方法。profile 状态使用 loading/ready/error，失败可重试。

- [ ] **Step 4: 接通详情收藏与真实咨询结果刷新**

  listing/building 收藏按钮改为 async；按钮 busy 时防重复。咨询成功后触发 `/me` refresh，不本地编造状态。

- [ ] **Step 5: 运行定向测试、全 Mini 测试和类型检查**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/favorites-service.test.ts tests/inquiry-tracker.test.ts tests/profile-page-contract.test.ts tests/listing-detail-page-contract.test.ts && pnpm test && pnpm typecheck'`
  Expected: 全部 PASS。

- [ ] **Step 6: 提交**

  显式暂存修改并提交：`feat(miniprogram): 完成服务端收藏与咨询记录闭环`。

### Task 6: 修复搜索排序、首页真实楼盘和误导入口

**Files:**
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/home/model.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.wxss`
- Modify: `sbh-miniprogram/miniprogram/pages/buildings/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/building-detail/index.wxml`
- Test: `sbh-miniprogram/tests/listings-page-contract.test.ts`
- Test: `sbh-miniprogram/tests/home-model.test.ts`
- Test: `sbh-miniprogram/tests/home-page-contract.test.ts`
- Test: `sbh-miniprogram/tests/buildings-page-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 必填 `featuredBuildings`。
- Produces: 搜索字段 `q`；价格排序只在 `priceUnit` 存在时为 `price-asc/price-desc`。

- [ ] **Step 1: 写页面行为失败测试**

  断言搜索提交写 q；无单位排序保持推荐并提示选择单位；有单位时在 asc/desc 间切换；首页楼盘由 model 数据循环渲染；不存在硬编码 slug/套数/售价、实时同步、逐条实勘、商办认证/可注册和虚构物业文案；地图占位入口被移除。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/listings-page-contract.test.ts tests/home-model.test.ts tests/home-page-contract.test.ts tests/buildings-page-contract.test.ts'`
  Expected: FAIL，命中 keyword、硬编码首页、假文案和地图占位。

- [ ] **Step 3: 实现真实页面投影与交互**

  首页循环 `featuredBuildings`；缺图使用中性品牌占位且不写“图”字；售卖专区若无独立真实 DTO 则移除。楼盘资质/物业/商圈仅在 DTO 有值时显示，缺失显示 `—` 或隐藏。

- [ ] **Step 4: 运行定向测试、Mini 全量和类型检查**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/listings-page-contract.test.ts tests/home-model.test.ts tests/home-page-contract.test.ts tests/buildings-page-contract.test.ts && pnpm test && pnpm typecheck'`
  Expected: 全部 PASS。

- [ ] **Step 5: 提交**

  显式暂存修改并提交：`fix(miniprogram): 修复搜索排序与首页真实数据`。

### Task 7: 重构筛选与咨询抽屉交互视觉

**Files:**
- Modify: `sbh-miniprogram/miniprogram/styles/tokens.wxss`
- Modify: `sbh-miniprogram/miniprogram/components/filter-sheet/index.ts`
- Modify: `sbh-miniprogram/miniprogram/components/filter-sheet/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/components/filter-sheet/index.wxss`
- Modify: `sbh-miniprogram/miniprogram/components/inquiry-sheet/index.ts`
- Modify: `sbh-miniprogram/miniprogram/components/inquiry-sheet/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/components/inquiry-sheet/index.wxss`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.json`
- Modify: `sbh-miniprogram/miniprogram/pages/buildings/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/buildings/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/buildings/index.json`
- Modify: `sbh-miniprogram/miniprogram/pages/building-detail/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/building-detail/index.wxml`
- Modify: `sbh-miniprogram/miniprogram/pages/building-detail/index.json`
- Modify: `sbh-miniprogram/miniprogram/pages/listing-detail/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/listing-detail/index.wxml`
- Create: `sbh-miniprogram/scripts/mp109-sheet-acceptance-runner.mjs`
- Test: `sbh-miniprogram/tests/filter-components.test.ts`
- Test: `sbh-miniprogram/tests/inquiry-sheet.test.ts`
- Test: `sbh-miniprogram/tests/sheet-visual-contract.test.ts`
- Test: `sbh-miniprogram/tests/tooling-scripts.test.ts`

**Interfaces:**
- Produces: `showModalTabBarBoundary()`/`restoreModalTabBarBoundary()` 页面生命周期 helper，保证 hide/show 成对。
- Produces: MP-109 runner 报告含 `filterPrice`、`filterAll`、`inquiryWechat`、`inquiryManual`、`inquiryError`、`inquirySubmitting`、`inquirySuccess`，每项必须 `passed:true`。

- [ ] **Step 1: 写打开态结构和生命周期失败测试**

  断言共享 sheet tokens、遮罩、grabber、44pt 关闭区、固定 footer、安全区、内部 scroll、页面背景锁、筛选页 hide/show TabBar 成对、提交中禁止关闭、非 busy 遮罩可关闭。通过 automator runner helper 测试缺 selector/几何越界/TabBar 可见都会失败。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/filter-components.test.ts tests/inquiry-sheet.test.ts tests/sheet-visual-contract.test.ts tests/tooling-scripts.test.ts'`
  Expected: FAIL，原因为旧结构无 shared tokens/sticky footer/TabBar boundary/MP-109 runner。

- [ ] **Step 3: 实现 Token 与两类抽屉结构**

  增加独立遮罩、面板、grabber、header、body、footer component tokens；筛选 footer 固定“清除/查看 N 套”，咨询 footer 固定当前主动作。移除红色收藏和 emoji 产品图标。只用 160–200ms opacity/translateY 进入动画。

- [ ] **Step 4: 实现 TabBar/背景/键盘边界**

  筛选打开后隐藏原生 TabBar；close/apply/onHide/onUnload 都恢复。页面用 `page-meta` 锁背景，面板 scroll-view 保持滚动；输入 `adjust-position` 与 `cursor-spacing` 保证键盘态可见。

- [ ] **Step 5: 运行定向测试并生成真实打开态证据**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/filter-components.test.ts tests/inquiry-sheet.test.ts tests/sheet-visual-contract.test.ts tests/tooling-scripts.test.ts && pnpm typecheck && pnpm project:check'`
  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'`
  Expected: 所有静态测试 PASS；DevTools 可用时 runner exit 0 且七种打开态均 `passed:true`。若 DevTools/端口不可用，报告明确 environment-unavailable，不得写“通过”。

- [ ] **Step 6: 视觉复核并提交**

  人工查看生成截图：TabBar 不可见、主 CTA 在安全区上方、无横向裁切、价格抽屉只显示价格分区、关闭后页面可滚动。显式暂存后提交：`feat(miniprogram): 重构筛选与咨询抽屉交互视觉`。

### Task 8: 工作项回写、全量验证与交付

**Files:**
- Create: `specs/work-items/MP-107-favorites-and-inquiry-history-plan.md`
- Create: `specs/work-items/MP-109-miniprogram-closure-and-sheet-plan.md`
- Modify: `specs/work-items/MP-002-miniprogram-delivery-roadmap.md`
- Modify: `specs/work-items/MP-106-building-closed-loop-and-ui-reconstruction-plan.md`
- Modify: `sbh-miniprogram/README.md`
- Create: `artifacts/verification/MP-109/README.md`
- Create: `artifacts/verification/MP-109/acceptance-report.json` when runner executes
- Create: `artifacts/verification/MP-109/screenshots/*` when runner executes

**Interfaces:**
- Produces: 审计可追踪的 MP-106/107/109 状态；原 MP-108 定义不变。

- [ ] **Step 1: 写工作项和证据一致性失败测试**

  扩展现有文档合同测试，断言 MP-107/109 task packet 存在、MP-108 仍是上线加固、README 不声称 mock 等于真实、报告内不得有 passed=false 或空必需 interactions。

- [ ] **Step 2: 运行文档合同测试并确认 RED**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm exec vitest run tests/tooling-scripts.test.ts tests/project-structure.test.ts'`
  Expected: FAIL，原因为 MP-107/109 文件或证据状态尚未回写。

- [ ] **Step 3: 回写真实状态与剩余环境门**

  MP-106/107/109 只标记“代码完成/环境验收待完成”中实际成立的部分；MP-105 的 trial、iOS/Android、隐私、图片/COS 与回滚未验证项保持未完成，不以本轮 Mock 证据覆盖。

- [ ] **Step 4: 运行全量验证**

  Run: `cd sbh-miniprogram && npx --yes --package=node@22 -c 'pnpm test && pnpm typecheck && pnpm project:check'`
  Run: `cd payload-office-platform && npx --yes --package=node@22 -c 'pnpm test && pnpm typecheck && pnpm lint && pnpm build'`
  Expected: 全部 exit 0；lint 允许仓库已知 warning 但不允许 error。构建自动改写 `next-env.d.ts` 时只恢复该生成变化并再次确认工作树。

- [ ] **Step 5: 独立全分支审查与修复波次**

  对本计划起始 commit 到 HEAD 生成 review package；高级模型检查设计一致性、安全、隐私、迁移、API 白名单、UI 抽屉和测试真实性。所有 Critical/Important 必须由单一修复波次解决并复审清零。

- [ ] **Step 6: 提交与推送**

  显式暂存工作项、README 和 MP-109 证据，提交：`docs(miniprogram): 归档 MP-109 闭环与抽屉验收`。确认分支无未提交变化后执行 `git push -u origin feat/miniprogram-mvp-59f9`；不得创建正式发布或部署生产。
