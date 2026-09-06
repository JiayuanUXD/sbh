# Task Packet：OPT-074 后台地理选择改级联组件（城市 → 行政区 → 商圈）

> 状态：**已实施**（2026-09-07）
> 创建日期：2026-09-06
> 验证证据：`artifacts/verification/OPT-074/`（回归取证 + 浏览器走查记录）
> 来源：用户「后台涉及到商圈/区域选择的时候是否可以用级联选择组件实现，比如商圈的时候是"城市--区域--商圈"」
> 范围：行政链 8 处表单。**地铁链不在本工作项内**（理由见 §2.3）。

---

## 1. 一句话

后台所有行政区 / 商圈选择目前都是平铺的 `relationship` 下拉，候选只按 `type` + `status`
过滤、**不按父级收窄**；改成「城市 → 行政区 → 商圈」级联选择，并把父子一致性校验补到服务端。

## 2. 摸底结论（2026-09-06 实测生产库）

工作项开工前对生产库跑了 30 项一致性检查（只读 SELECT）。结论直接决定了下面的设计，
**改设计前先读这一节**。

### 2.1 存量数据是干净的 —— 不需要数据清洗

30 项检查全部为 0。覆盖度如实标注：

| 覆盖情况 | 项数 | 依据 |
|---|---|---|
| 有效覆盖，确认为 0 | 19 | `buildings` 83 条 / `articles` 100 篇 / `city_site_profiles` 7 个 / `locations` 1680 节点 |
| 样本过小，参考价值有限 | 5 | `leads` 只有 4 条、`brokers` 只有 1 个 |
| **零覆盖，无从检验** | 6 | `supply_submissions`、`business_area_extensions`、`location_aliases` 三张表都是空的 |

「引用已停用节点」是**真正有效的 0**：生产确有 3 个 `disabled` 行政区，且确实无人引用。
那 3 个是上海重复建档的残留（`SH-JINGANQU` / `SH-PUDONGQU` / `SH-PUDONGXINQU`，
各 0 子节点 0 引用），来历见 `scripts/merge-duplicate-districts.ts`。

推论：**加上父级收窄不会把任何现存记录变成"存不下去"**，本工作项不需要配套数据迁移。

### 2.2 `filterOptions` 对历史已存值同样生效 —— 现存的线上隐患

`src/collections/Buildings.ts:311` 注释称「历史已存值不受影响（filterOptions 仅约束下拉候选）」。
**这句是错的**，已实测证伪：

```
[必填 district]         停用楼盘 #7 正在引用的行政区「浦东新区」
  ❌ 保存被拦：位置交通 > 行政区 · 该字段有以下无效的选择： 3
[选填 businessDistrict] 停用楼盘 #6 正在引用的商圈「虹桥」
  ❌ 保存被拦：位置交通 > 商圈 · 该字段有以下无效的选择： 11
```

机制在 `payload/dist/fields/validations.js:404` 的 `validateFilterOptions`：它把 `filterOptions`
返回的 `where` 拿去查库比对，值不在结果里就报 validation error，`relationship` 与 `upload`
的 validate 都会调它（`event === 'onChange'` 时跳过，保存时执行）。

后果：运营在地理管理里停用任何一个正被引用的商圈，所有引用它的楼盘立刻变成改不动 ——
哪怕只是想换张照片，而且报错文案「该字段有以下无效的选择：11」运营完全看不懂。
生产目前没炸，纯粹因为那 3 个停用节点恰好零引用。

**这个隐患与级联改造是同一处代码，本工作项一并修掉**（§4）。

### 2.3 四条硬约束（全部来自实测数据）

| 约束 | 数据依据 |
|---|---|
| **级联必须允许停在第二级** | 74 个启用行政区中 **14 个（19%）没有任何启用商圈**，强制选到叶子会让这些区的楼盘录不进去 |
| **不得按 `frontendVisible` 过滤** | 行政区 65/74、商圈 279/294 都是 `false`。它是前台展示开关，不是后台可用性开关；现有 `activeLocationFilter` 不管它，是对的 |
| **历史值必须能回显** | 已存值可能指向停用节点（不在候选树里），组件要显示出来并标注「已停用」，不能空白 |
| **只吃行政链** | 行政链 378 节点（7 城 + 77 区 + 294 商圈，约 40KB JSON）可一次拉全；地铁链 1302 节点（66 线 + 1236 站）必须按需分层，是另一套取数逻辑 |

收窄的收益也量化了：上海一城独占 212 个商圈（全国 294 的 72%）。不收窄要在 294 个里翻，
按区收窄后最大的浦东新区也只有 32 个。

---

## 3. 三层分工

`filterOptions` **不能**兼任服务端校验 —— 它分不清「用户这次选的新值」和「文档里躺着的旧值」，
一刀切必然误伤后者（§2.2 已实测）。因此职责这样切：

| 层 | 职责 | 载体 |
|---|---|---|
| 数据层 | 供给整棵行政树 | 新 endpoint `GET /api/locations/tree` |
| 组件层 | 级联交互、按父级收窄候选、停用值回显 | `LocationCascadeField` |
| 校验层 | 「启用 + 父子一致 + 类型正确」硬校验，**只管本次改动的值** | `beforeChange` hook |

`filterOptions` 降级为**只收窄 `type`**。type 是不变量，历史值不可能违反它，所以不会误伤；
`status` 与父子一致性全部下沉到 hook。

**已知代价**：级联组件覆盖不到的入口（Payload 原生 list view 的关系筛选、relationship drawer）
会开始出现停用节点。8 处表单全部接了组件，所以退化只影响这些非表单入口，可接受。

---

## 4. 校验层（修掉 §2.2 的隐患）

新建 `src/domain/geography/location-field-guard.ts`，导出工厂函数供各 collection 的
`beforeChange` 复用：

```ts
createLocationFieldGuard([
  { field: 'city',             type: 'city' },
  { field: 'district',         type: 'district',      parentField: 'city' },
  { field: 'businessDistrict', type: 'business_area',  parentField: 'district' },
])
```

判定逻辑：

```
对每个地理字段：
  值 === originalDoc[field]  → 放行，不做任何校验
  值变了 / 新建文档          → 严格校验：类型正确 + status=active + 父级与 parentField 的值一致
```

于是：

| 场景 | 结果 |
|---|---|
| 改楼盘照片，其商圈恰好被停用了 | **存得下去**（值没变）—— 修掉了现存隐患 |
| 主动改选一个已停用的商圈 | **拦住** |
| API 直传跨城混搭（上海 + 朝阳区） | **拦住** —— 比现状严格，现状根本不校验父子一致 |

`hasMany` 字段（`featuredRegions`、`relatedDistricts`、`serviceBusinessAreas`）逐元素套同一判定，
差集比对 `originalDoc` 的数组：只校验本次新增的元素。

错误信息必须说人话，不能沿用 Payload 的「该字段有以下无效的选择：11」。
抛 `InvalidOperationError`（`src/domain/shared/errors.ts`），文案形如
**「商圈『虹桥』不属于所选行政区『长宁区』」**。

> hook 里禁止 try/catch 吞异常 —— 会连带回滚调用方的 req 事务，
> 原因与实测见 `src/domain/shared/transaction-safety.ts`。查父级用 `findByIdSafe`。

---

## 5. 数据层

`GET /api/locations/tree`，注册在 Locations collection 的 `endpoints` 上
（**不能放顶层 `config.endpoints`，会被 slug 路由遮蔽 → 404**，见 `Locations.ts` 既有注释）。

- 响应：行政链摊平节点数组（`FlatLocationNode[]`，复用 `src/domain/geography/location-tree.ts` 的既有类型），
  由客户端用同文件的 `buildChildrenIndex` 组装成森林。**纯函数层已经有了，不要重写。**
- 只返回行政链（`city` / `district` / `business_area`），不含地铁链。
- 含 `status`，**不按 status 过滤** —— 组件要靠它把停用的历史值标出来。
- 权限口径抄 `src/endpoints/location-search-endpoint.ts`：必须登录 + `overrideAccess: false`
  继承数据权限 + 需 `locations` 或 `business-areas` 菜单权限之一。
- 服务端 `unstable_cache` 缓存，失效标签接进 `src/domain/city-site-profile/cache-invalidator.ts`
  既有的 location 变更通道。

---

## 6. 组件

`src/components/admin/LocationCascadeField.tsx`（+ `Client` 后缀文件，遵循仓库既有的
server/client 拆分惯例，如 `BuildingAggregateCard` / `ListingMediaManager`）。

基于 Arco `Cascader`（`@arco-design/web-react` 已在依赖里，仓库尚未用过 Cascader）。

**两种挂载形态**

| 形态 | 用于 | 行为 |
|---|---|---|
| **多字段控制器** | Buildings、SupplySubmissions | 一个 Cascader 写回 2~3 个真实字段，走 `useForm().dispatchFields`；原字段 `admin.hidden` |
| **单字段** | 其余 6 处 | Cascader 读写单个字段，按各处配置可选层级 |

多字段控制器**落库形态完全不变** → C 端查询、`src/domain/public-catalog/` 的 facade / adapter /
mappers、既有迁移全部零改动。

**必须处理的行为**

1. `changeOnSelect`：允许停在中间层（§2.3 的 14 个无商圈行政区）。
2. 停用值回显：当前值不在候选树里时仍渲染其路径，加「已停用」标记且不可再次选中。
3. `showSearch`：跨层搜索，378 节点全在客户端，无需请求。
4. 暗色主题：仓库有 `ThemeToggle`，Arco 组件需确认两套主题下都可读。

**实施时必须先实测的两个未知** —— 已于 2026-09-06 在浏览器里验完，结论如下：

1. **field 级 `admin.hidden` 不影响 required 校验**（与 Global 的 `admin.hidden` 不同，后者
   会连路由一起排除）。新建楼盘直接保存，toast 照常报「以下字段是无效的：…位置交通 > 行政区」，
   tab 徽标也正确计数。唯一 caveat：hidden 字段的行内错误看不见，用户只能靠 toast 定位，
   故级联框的 label 必须能让人把「行政区」这个报错对应上去。
2. **`dispatchFields` 不置脏**——这是真正的坑，而且不是 required 刷新的问题。多字段写回后
   级联框显示已变、form state 也变了，但右上角「保存」按钮始终 `btn--disabled`，改动根本
   提交不出去。`useField().setValue` 会自己置脏，`dispatchFields` 不会，**必须显式
   `setModified(true)`**。

退路（联动下拉）因此没有启用。

**另外两条只有真机点击才暴露的**：

3. **Arco Cascader 的 `disabled` 向下继承**。原设计用 `disabled` 同时表达「节点停用」与
   「该层不可选」，结果城市/行政区一旦标 disabled，它们底下的商圈全被连带禁用——
   「只能选商圈」的配置反而一个商圈都点不了。改为 `disabled` 只表达 status，
   层级策略交给 `changeOnSelect`。status 维度上的这种继承恰好是对的（停用区下的商圈本就不该选）。
4. **JS `document.click()` 触发不了 Arco 列表项的选择逻辑**（console 里没有 onChange 日志），
   必须用真实鼠标事件。上面第 2、3 条都是换成真实点击后才暴露的——用 JS 模拟点击走查，
   会得到「一切正常」的假象。

---

## 7. 八处接入

| 位置 | 形态 | 可选层级 | 附带修复 |
|---|---|---|---|
| `Buildings.ts:296-320` | 控制器 → `city`/`district`/`businessDistrict` | 城市→区→商圈，可停在区 | 补父子一致校验 |
| `SupplySubmissions.ts:246-260` | 控制器 → `city`/`district` | 同上 | **补缺失的 `filterOptions`** |
| `Leads.ts:181` 意向区域 | 单字段 | 城市 / 区 / 商圈任一层 | — |
| `CitySiteProfiles.ts:299` 精选区域 | 单字段多选（≤12） | 区 / 商圈，**限定在该 profile 的城市内** | 补同城校验 |
| `Articles.ts:153` 关联商圈 | 单字段多选 | 区 / 商圈 | **补缺失的 `filterOptions`** |
| `LocationAliases.ts:64` 指向区域 | 单字段 | 四类，**与旁边的 `kind` 字段联动** | **补缺失的 `filterOptions`** |
| `Brokers.ts:87` 服务商圈 | 单字段多选 | 商圈，按 `serviceCities` 收窄 | 补校验 |
| `BusinessAreaExtensions.ts:38` 所属商圈 | 单字段 | 商圈 | — |

`Brokers.serviceCities`、`Merchants.serviceCities`、`Teams.cityScope`、`Users.cityScope`、
`Leads.city`、`CitySiteProfiles.city`、`CityPartnerApplications.city`、`SupplyImportBatches.city`
共 8 处是**单级城市选择，不动** —— 级联对单层没有收益。

---

## 8. 还要改的地方

- `src/domain/geography/location-hierarchy.ts`：`activeLocationFilter` 拆出「只按 type」的变体，
  或新增可选的父级参数。既有调用点全部跟改。
- `src/domain/geography/location-field-guard.ts`：新建（§4）。
- `src/endpoints/location-tree-endpoint.ts`：新建（§5），在 `Locations.ts` 的 `endpoints` 注册。
- `src/components/admin/LocationCascadeField.tsx` + `Client`：新建（§6）。
- 8 个 collection 文件：接组件 + 改 `filterOptions` + 挂 hook（§7）。
- `payload-types.ts` 重新生成（不跟踪，`pnpm generate:types`）。
- **无迁移**：不改字段形态、不改列（§2.1 已确认无需数据清洗）。
- `.agent/backend.md`、`.agent/supply.md`：若有「地理字段用原生 relationship」的表述需订正。

---

## 9. 测试

`pnpm test` 新增覆盖：

1. **`location-field-guard` 纯逻辑**：值未变 → 放行；值变为停用节点 → 拦；值变为跨城节点 → 拦；
   新建文档 → 严格校验；`hasMany` 只校验新增元素。
2. **树组装**：378 节点规模下 `buildChildrenIndex` 的森林正确性（复用既有单测夹具）。
3. **回归专项（对应 §2.2 的隐患）**：造一条引用停用节点的楼盘，
   断言「改无关字段能存」+「改选停用节点被拦」。**这条是本工作项的核心回归，不可省。**
4. **endpoint 权限**：未登录 401；登录但无地理菜单权限 403；有权限返回行政链且不含地铁节点。

`tests/e2e/` 需自查：改了后台表单结构，而 **E2E 不在本地 pre-push 闸门里**（只跑 typecheck + test），
本地全绿 CI 仍可能红。本地不要跑全量 E2E（会被 SIGKILL），按目录挑相关用例跑。

---

## 10. 验收判据

1. `typecheck` + `pnpm test` 全绿。
2. **浏览器实测**（`CLAUDE.md`「完成前必须在浏览器里实际走一遍」，不可用 CI 全绿顶替）：
   用 `scripts/seed.ts` 的 E2E 夹具账号登录后台，**8 处逐个点一遍**，逐项确认：
   - 选完城市后，行政区候选确实收窄到该城
   - 选完行政区后，商圈候选确实收窄到该区
   - 在 14 个无商圈行政区之一停在第二级能正常保存
   - 停用节点的历史值能回显并标注
3. 回归：手工停用一个正被引用的商圈，确认引用它的楼盘**改无关字段仍能保存**
   （这正是 §2.2 隐患的修复证明）。
4. 本地验证前先 `pnpm exec payload migrate` 确认本地库不落后于 `src/migrations/`，
   否则会看到与代码无关的假象。
5. 证据（截图 / 日志）存 `artifacts/verification/OPT-074/`，不粘进对话或 PR 正文。
