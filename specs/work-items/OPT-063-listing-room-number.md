# Task Packet：OPT-063 房源「房间号」字段（仅后台可见 · 同楼盘唯一）

> 状态：**已实现**（分支 `feat/opt-063-listing-room-number-4c31`；验收证据见
> `artifacts/verification/OPT-063/本地验收.md`）
> 创建日期：2026-08-31
> 来源：用户提出——同一栋楼内常有多套「同楼层、同面积」的房源，业务员推进业务时
> 无法在后台把它们区分开
> 编号核对：`specs/work-items/` 最大到 OPT-062；`git branch -a` + `gh pr list`
> 全量扫过，无在建分支占用 063（吸取 OPT-058 / OPT-061 撞号教训）

---

## 1. 一句话

给 `listings` 加一个 `roomNumber`（房间号）文本字段：**后台可填、可搜、进列表列，
同一楼盘内不允许重复；前台不展示，且匿名 REST / GraphQL 读不到。**

## 2. 为什么（谁受影响、现在什么样、为什么是现在）

- **谁**：内部业务员 / 运营。不是 C 端访客——这个字段对访客既不展示也不该可读。
- **现在什么样**：`Listings` 有 `floor`（楼层，文本，`Listings.ts:558`）和 `area`
  （面积），但**没有任何字段能区分同层同面积的两套房源**。后台列表
  （`ListingsListViewClient.tsx:242` 起的列定义）只有标题 / 类型 / 审核状态 /
  发布状态 / 面积 / 首页推荐 / 更新时间——两条「XX大厦 12层 120㎡」在列表里
  长得一模一样，只能靠点进去看图猜。
- **为什么是现在**：这是纯增量字段，没有依赖；且 `fix/api-exposure-hardening`
  刚把 `listings` 的匿名读收窄（见 §3.2），**字段级权限的写法此刻要一次定成范式**，
  否则下一个「只给后台看」的字段又会重新发明一遍。

## 3. 事实核查（2026-08-31，均已核到代码）

### 3.1 表单与列表的现状

| 事实 | 位置 |
|---|---|
| `floor` 是 `text` + `markPublishRequired`，在 area 行第 3 位，`width: COL_4` | `src/collections/Listings.ts:558` |
| area 行已满 4 格：`area` / `seats` / `floor` / `minimumLeaseMonths` | `src/collections/Listings.ts:545-590` |
| `building` 是 `relationship` → `buildings`，**`required: true`**（所以「同楼盘内唯一」有良定义） | `src/collections/Listings.ts:355-361` |
| `admin.defaultColumns`（`:188`）对房源列表**是死配置**——OPT-056 已整页替换列表视图 | `src/collections/Listings.ts:195-200` |
| 后台列表列真正定义在客户端组件里 | `src/components/admin/ListingsListViewClient.tsx:242` |
| 后台搜索**只搜标题一个字段**：`if (q) conditions.push({ title: { like: q } })` | `src/components/admin/ListingsListView.tsx:79` |
| 列表视图的 `payload.find()` 未传 `overrideAccess: false` → 走 Local API 默认 `true`，字段级权限不生效（后台永远看得到） | `src/components/admin/ListingsListView.tsx:88-95` |
| `trash: true`，软删列为 `listings.deleted_at` | `Listings.ts:203`、`migrations/20260725_103653_m0_schema_sync.ts:356` |

### 3.2 「前台不展示」≠「外部读不到」

`artifacts/verification/api-exposure/影响清单.md` 记的就是这件事的起因：

- 普通字段会**原样出现在 `/api/listings` 与 GraphQL 的匿名响应里**。前台 DTO
  （`src/domain/public-catalog/mappers.ts:735`、`:847`）不映射它只能保证「不渲染」，
  保证不了「读不到」。
- 对口机制是**字段级 `access.read`**。Payload 在 `afterRead` 遍历字段时判定，
  返回 `false` 就把该字段整条从响应里剥掉；REST / GraphQL 匿名请求都吃这条。
- **本仓库目前零字段级 access 先例**——`grep -n "^      access:" src/collections/*.ts`
  无匹配，所有 `access:` 都在 collection 顶层。`.agent/permissions.md:27` 写过
  「手机…按字段权限脱敏」的原则但从未落地。本项是第一处，**注释要按范式来写**。
- Local API 默认 `overrideAccess: true`，所以 C 端 Server Component 与后台列表视图
  **行为零变化**；真正被拦的只有匿名 REST / GraphQL。

### 3.3 复合唯一索引：Payload 3.86 确实支持，且能带关系字段

- 先例：`src/collections/LocationAliases.ts:66`
  `indexes: [{ fields: ['normalizedAlias', 'kind'], unique: true }]`。
- 关系字段能不能进复合索引，已读源码确认（不是推测）：
  `@payloadcms/drizzle@3.86.0/dist/schema/traverseFields.js:744` 把 relationship 的列
  以**字段名**为 key 挂在表上（`targetTable['building'] = { name: 'building_id', ... }`），
  而 `dist/schema/build.js:208` 的存在性校验查的正是这个 key。
  所以 `fields: ['building', 'roomNumber']` 能过校验，落库落到 `building_id`。
- **PG 的 NULL 在唯一索引里互不冲突**，所以「不填房间号」的房源可以有任意多条。
  但**空串会互相冲突**——后台文本框提交的正是空串，所以归一化 hook 是必需项，
  不是锦上添花（见 §4.2）。

### 3.4 已知坑（写代码前必读）

- **唯一冲突的报错拿不到 `23505`**：Payload 3.86 + drizzle 把所有唯一冲突转成
  `ValidationError`，按 `err.cause.code === '23505'` 判定**恒为 false**。
  本仓库已因此写过 7 处死兜底。→ 所以本项的友好报错**必须由 hook 主动查重产生**，
  不能靠 catch 数据库错误（§4.3）。
- 改 `src/collections/` 必带迁移，`.githooks/pre-commit` 会拦；生产是共享
  TencentDB、`push: false`，只走显式迁移。

## 4. 实现细节（无待定项）

### 4.1 字段定义

放进 area 行，**同时把 `minimumLeaseMonths` 下移**到它下面那个「租赁专属」行
（`paymentTerms` / `availableFrom`）。理由：那一行的 `condition` 与
`minimumLeaseMonths` 的 `condition` 字面相同（`businessType !== 'sale'`），
合并后「切到出售整行干净收起」这句注释才真正成立，而且 area 行恒定 4 格不留空档。
`Listings.ts:592` 那条注释要一并改成「三个租赁专属字段」。

```ts
{
  name: 'roomNumber',
  label: '房间号',
  type: 'text',
  maxLength: 30,
  admin: {
    width: COL_4,
    description: '仅后台可见，前台不展示。同一楼盘内不可重复，用于区分同层同面积的房源。',
  },
  access: {
    // 本仓库第一处字段级权限，写法范式：
    //
    // 为什么不是「前台不渲染就行」：前台 DTO 不映射只保证不渲染，普通字段仍会
    // 原样出现在 /api/listings 与 GraphQL 的匿名响应里（见
    // artifacts/verification/api-exposure/影响清单.md）。
    //
    // 为什么不是把 collection 的 read 再收窄：collection 级读权限管的是
    // 「哪些文档可读」，这里要的是「同一份文档里哪些字段可读」，粒度不同。
    //
    // 边界：Local API 默认 overrideAccess: true，所以 C 端 Server Component 与
    // 后台自定义列表视图都读得到（后者正需要读到）；真正被拦的只有匿名
    // REST / GraphQL。
    read: ({ req }) => Boolean(req.user),
  },
},
```

不加 `markPublishRequired`：这是内部字段，缺它不该拦发布。

### 4.2 归一化（必需，不是可选）

在 `Listings` 已有的 `beforeChange` hook 链里加一步（或新增一个小 hook 函数，
与 `src/collections/Listings.ts` 顶部既有 hook 同级）：

```
roomNumber = String(v ?? '').trim() || null
```

不做这步会有两个真实后果：① 多条「没填房间号」的房源因为都是空串
而互相顶掉唯一索引；② 搜索 `like` 会被空串污染。

### 4.3 唯一性：hook 查重（报错文案）+ 数据库唯一索引（兜底）

两层都要，各司其职：

**第一层 · `beforeValidate` 查重**，产出人话报错：

- 条件：`roomNumber` 非 null 且 `building` 有值时才查。
- 查询：`payload.find({ collection: 'listings', where: { and: [{ building: { equals } }, { roomNumber: { equals } }, { id: { not_equals: 当前 id } }] }, limit: 1 })`。
- **必须把软删房源也算进来**（`trash: true` 或等价写法）——因为数据库唯一索引
  覆盖软删行，hook 不查软删就会出现「hook 放行、数据库拒绝、用户看到一句
  看不懂的 ValidationError」。
- 命中软删的：报错文案要明确指路「该房间号已被一条**已删除**的房源占用，
  请到回收站恢复或彻底删除后再试」。命中未删的：报错带上冲突房源的标题。
- 抛 `ValidationError`，字段路径指向 `roomNumber`，让后台高亮到框上。

**第二层 · collection 级唯一索引**，兜住并发：

```ts
indexes: [{ fields: ['building', 'roomNumber'], unique: true }],
```

明确记下取舍：索引覆盖软删行（PG 唯一索引无法在 Payload 配置里带
`WHERE deleted_at IS NULL` 谓词，而手写偏索引要么改生成的迁移正文——仓库明令
禁止，要么留一个 drizzle 快照看不见的影子 schema）。所以策略统一为
**「软删也占号」**，由第一层给出可操作的指路文案。这是有意选择，不是遗漏。

### 4.4 后台搜索

`src/components/admin/ListingsListView.tsx:79`：

```ts
if (q) conditions.push({ or: [{ title: { like: q } }, { roomNumber: { like: q } }] })
```

搜索框 placeholder（`ListingsListViewClient.tsx` 内）同步改成「搜索标题 / 房间号」，
否则用户不知道能这么搜。

### 4.5 后台列表列

三处一起改，漏一处就是空列：

1. `ListingsListViewClient.tsx:29` 的 `ListingRow` 加 `roomNumber: string | null`；
2. `ListingsListView.tsx` 的行映射（`:105` 起）加 `roomNumber: doc.roomNumber ?? null`；
3. `ListingsListViewClient.tsx:242` 的 `columns` 加一列，**插在「面积」之后**
   （楼层信息与面积相邻，读起来是一组），`width: 96`，空值渲染破折号而不是空白。

### 4.6 前台不展示（负向保证）

- **不要**碰 `src/domain/public-catalog/contracts.ts` 的 `ListingDetailViewModel`；
- **不要**在 `mappers.ts:735` 附近映射它；
- **不要**加进 `mappers.ts:847` 的 `fact('房源楼层', ...)` 那组详情事实。
- 由 §5 的守卫测试把这三条锁死（光靠「记得别加」会漂）。

### 4.7 迁移

```bash
pnpm generate:types && pnpm payload generate:importmap
pnpm exec payload migrate:create opt_063_listing_room_number
```

生成物正文**不得手改**。生成后核对：应包含 `listings` 加 `room_number varchar`
与一条 `building_id, room_number` 的 unique index；`src/payload-types.ts` 里
`roomNumber?: string | null`，且 `grep -c "prefix" src/payload-types.ts` 仍为 2。

## 5. 验收标准（逐条可判定）

1. 后台房源编辑页「基本信息」区，area 行显示 **面积 / 建议工位数 / 楼层 / 房间号** 四格；
   `businessType` 切到「出售」时该行仍是 4 格不塌陷，「最短租期 / 付款条件 / 可入驻日期」整行消失。
2. 填入房间号并保存，强刷页面后值仍在（按 `.agent/testing.md` 的表单三步铁证：
   抓包看 PATCH body 含 `roomNumber` → 响应 200 → reload 回显一致）。
3. 同一楼盘下再建一条相同房间号的房源，保存被拒，`roomNumber` 输入框高亮，
   错误文案含冲突房源标题。
4. 把上一条冲突房源移入回收站后，再次尝试同房间号仍被拒，且文案明确提示「已删除的房源占用 / 去回收站」。
5. **不同**楼盘下使用相同房间号，保存成功。
6. 两条房间号都留空的房源可以共存（空串已归一为 null）。
7. 后台列表出现「房间号」列（面积之后），无值显示破折号。
8. 后台列表搜索框输入房间号可命中；输入标题片段仍能命中（原行为不回归）。
9. 匿名 `curl "$SITE/api/listings?limit=1"` 的响应 JSON **不含 `roomNumber` 键**；
   匿名 GraphQL 查 `Listings { docs { roomNumber } }` 同样取不到。
10. 带后台登录 cookie 请求同一 REST 端点，`roomNumber` **在**响应里。
11. C 端房源详情页 / 列表页 HTML 全文搜不到该房间号字符串。
12. `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm migrate:dry-run` / `pnpm build` 全绿。
13. 迁移在**空库**与**已有存量数据的库**上都能跑通（存量库里若已有同楼盘重复的
    「空房间号」不受影响，因为全为 NULL）。

## 6. 测试计划

| 层 | 测什么 | 新增 |
|---|---|---|
| 单元 | 归一化：带空格的值 trim、空串转 null、null 保持 null | +3 |
| 单元 | 查重 hook：同楼盘冲突拒 / 跨楼盘放行 / 排除自身 id / 命中软删走另一套文案 | +4 |
| 单元 | 字段级 access：`req.user` 存在返回 true，匿名返回 false | +2 |
| 单元（守卫） | 前台 DTO 不含 `roomNumber`：断言详情 mapper 的返回对象无该键，且 facts 里查不到 | +2 |
| 单元（守卫） | collection 配置里 `roomNumber` 字段带 `access.read`（防止将来有人顺手删掉） | +1 |
| 单元 | 列表搜索条件构造：`q` 存在时产出 `or: [title, roomNumber]` | +1 |
| E2E | 后台登录 → 建房源填房间号 → 保存 → reload 回显 → 列表列可见 → 搜索命中 | +1 |
| E2E | 匿名 `/api/listings` 响应不含 `roomNumber`（用 `request` fixture 直接打 API） | +1 |

守卫测试用 TDD：先在**未加字段**的代码上确认第 9 / 11 条对应的断言是红的
（否则又是一条「恒真的死守卫」，本仓库刚在 `sale-channel.spec.ts` 踩过）。

## 7. 回滚

- 代码：revert PR。
- 数据库：迁移的 `down()` 会 `DROP COLUMN room_number`（**连同已录入的房间号一起丢**）。
  若已在生产录过数据，回滚前先导出 `SELECT id, building_id, room_number FROM listings
  WHERE room_number IS NOT NULL`，存到 `artifacts/verification/OPT-063/`。
- 注意本仓库「合并到 master 即全量上线」，回滚等于再走一次完整发布链路。

## 8. 工时

| 部分 | 估时 |
|---|---|
| 字段 + 归一化 + 字段级 access（含范式注释） | 1.0h |
| 查重 hook（含软删分支与文案） | 1.0h |
| 后台搜索 + 列表列（三处） | 0.75h |
| 表单行重排（`minimumLeaseMonths` 下移 + 改注释） | 0.25h |
| 迁移生成与核对 | 0.5h |
| 测试（14 单测 + 2 E2E） | 2.0h |
| 浏览器实测与证据留存 | 1.0h |
| **合计** | **~6.5h** |

## 9. 文件清单

| 文件 | 改什么 |
|---|---|
| `src/collections/Listings.ts:545-600` | 新增 `roomNumber` 字段；`minimumLeaseMonths` 下移；改行注释 |
| `src/collections/Listings.ts`（collection 顶层） | 新增 `indexes: [{ fields: ['building','roomNumber'], unique: true }]` |
| `src/collections/Listings.ts`（hooks） | 归一化 + 同楼盘查重 |
| `src/components/admin/ListingsListView.tsx:79` | 搜索条件改 `or` |
| `src/components/admin/ListingsListView.tsx:105+` | 行映射补 `roomNumber` |
| `src/components/admin/ListingsListViewClient.tsx:29` | `ListingRow` 加字段 |
| `src/components/admin/ListingsListViewClient.tsx:242+` | 加「房间号」列；搜索框 placeholder |
| `src/migrations/2026xxxx_opt_063_listing_room_number.{ts,json}` | 生成物，不手改 |
| `src/payload-types.ts` | 生成物 |
| `tests/listing-room-number.test.ts` | 新建（归一化 / 查重 / access / 守卫） |
| `tests/e2e/listing-room-number.spec.ts` | 新建 |
| `.agent/permissions.md` | 把字段级 access 从「原则」升级为「有先例，见 Listings.roomNumber」 |

## 10. 不在范围内

- **不与 `floor` 合并**（用户明确要求独立）。楼层是对外展示信息，房间号是对内标识，
  合并会让「前台展示楼层」和「房间号不外露」两个需求打架。
- 不做房间号的批量导入映射（`supply-import` 那条链路单独评估）。
- 不做按房间号的 C 端筛选 / 搜索——它对访客根本不可读。
- 不动 §3.2 提到的其它集合暴露面（`merchants` / `brokers` /
  `building-merchant-relations` 收紧是独立一批，见影响清单 §5 方向 3）。
- 不做房间号的历史变更审计（`audit-logs` 已覆盖房源整体变更）。

## 11. 风险与已知边界

| 风险 | 判断 |
|---|---|
| 复合唯一索引在生产存量 2219 条上建失败 | 低。新列全为 NULL，PG 唯一索引不约束 NULL，建索引必然成功 |
| 软删房源占号造成困惑 | **会发生**，已由 §4.3 的专门文案兜住；这是有意选择，不是 bug |
| 并发双写绕过 hook 查重 | 窗口极小（同秒、同楼盘、同房间号），且被数据库索引挡住；用户看到的是不友好的 ValidationError，可接受 |
| 字段级 access 是仓库首例，行为判断出错 | 用第 9 / 10 条验收（匿名 vs 带 cookie 的真实 HTTP 对照）实测，不靠推理 |
| 后台自定义列表视图走 `overrideAccess: true`，将来若有人改成 `false` 会让列变空 | 已在 §3.1 记下；`ListingsListView.tsx` 加一行注释说明这条依赖 |

## 12. 关联

- `artifacts/verification/api-exposure/影响清单.md` — 本项的起因与字段级 access 的论证
- `specs/work-items/OPT-056-admin-ux-batch.md` — 房源列表被整页替换（本项改列表必须改它，不是改 `defaultColumns`）
- `specs/work-items/OPT-051-listings-buildings-missing-delete-access.md` — 房源软删 / 硬删语义
- `.agent/permissions.md`、`.agent/migrations.md`、`.agent/testing.md`

---

## 13. 实施记录（与本 spec 的差异）

计划基本照做，四处在动手时才发现的补充：

1. **新增列把「房源标题」列挤塌了。** 固定宽列合计 884px，1280 视口下弹性的标题列
   被压到几十像素、中文一行一字。给 Arco Table 加了 `scroll={{ x: 1180 }}`
   （884 固定列 + 约 300 的标题列下限），宽度不够时整表横向滚动而不是牺牲标题列。
   spec 里没预见到这条。
2. **搜索条件构造抽成了独立模块** `src/components/admin/listings-list-conditions.ts`。
   原本内联在 Server Component 里，而那个文件会连带 import 客户端的 Arco 表格，
   vitest 跑不起来——「搜索搜了哪几个字段」这条最容易悄悄退化的行为因此一直没有守卫。
3. **报错文案不能写 markdown。** 初版写了 `**已删除**`，Payload 把校验消息当纯文本
   渲染，后台原样显示成星号。已去掉，并加了 `not.toContain('**')` 的断言。
4. **`tests/preflight-migrations.test.ts` 的迁移计数守卫 70 → 71。**
   那条守卫本就是为「加迁移必须留说明」设计的，按文件既有格式补了本份迁移的说明。

另外实测确认了一条 spec 里没写的差异：**字段级 access 在 REST 与 GraphQL 上表现不同**
——REST 把键整个删掉，GraphQL 是键在、值为 null（schema 是静态的）。值都没泄露，
但写断言时别只判 `hasOwnProperty`。已写进 `.agent/permissions.md`。

守卫做了变异验证（逐条改坏被守护的东西，确认断言真的会红），六条全部生效，
明细见验收文档 §七。

## 14. 顺带发现的既有问题（未修，值得单开）

`scripts/seed.ts` 的 `upsertBySlug`（`:60`）查重不带 `trash`，看不见软删行 →
走 `create` → 撞 slug 唯一 → **整个 seed 失败**，报一句看不出原因的
`ValidationError: 下面的字段是无效的： slug`。只要有人在本地软删过任何一条 seed
覆盖的记录就会踩到。与本项无关，但排查成本很高。
