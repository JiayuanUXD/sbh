# 权限、安全与字段脱敏规则

## 四层权限

权限由菜单、操作、数据和字段四层共同决定。五个内置角色固定为 ADM、OPS、MGR、BRK、CSR，不得删除、改码或增加第六种内置角色。

## 服务端边界

- Payload access、endpoint 或领域服务执行最终权限。
- 客户端角色、城市、团队、负责人和 URL 范围均不可信。
- UI 隐藏只改善体验，直接 API 无权必须返回 403。
- 旧版本写入返回 409，不静默覆盖。
- Custom View 也必须通过统一登录和权限守卫。

## 数据范围

- ADM：全局。
- OPS：授权城市的运营对象。
- MGR：所属团队和授权城市。
- BRK：本人负责的 Lead/Customer/Follow-up；授权范围内有效房源。
- CSR：授权城市咨询 Lead，不具审核/团队管理权限。

与 `src/domain` / collection `access` 中的实现不一致时，以更严格的一方为准，并在工作项中记录差异。

## 字段与导出

- 手机、IP、设备、坐标、审计前后值按字段权限脱敏。
- 经纪人只在职责范围内查看完整手机号；敏感导出需要独立权限。
- 导出继承当前筛选、数据权限和字段权限，并记录审计。
- 公开 DTO 默认不含内部电话、资质、审核、举报、权限或审计字段。

### 「只给后台看」的字段怎么写（有先例了，照抄）

**前台 DTO 不映射 ≠ 外部读不到。** 普通字段会原样出现在 `/api/<collection>` 与 GraphQL
的匿名响应里——不映射只保证不渲染。真要挡住得用**字段级 `access.read`**：

```ts
// src/collections/Listings.ts 的 roomNumber（OPT-063，本仓库第一处）
access: { read: ({ req }) => Boolean(req.user) }
```

三点边界，照抄前先确认适用：

- **只拦匿名 REST / GraphQL**。Local API 默认 `overrideAccess: true`，C 端 Server
  Component 与后台自定义列表视图都仍读得到（后者往往正需要读到）。
- **GraphQL 是「键在、值为 null」**，不是像 REST 那样整个键消失（schema 是静态的）。
  写断言时别只判 `hasOwnProperty`。
- 配一条守卫单测断言这段 `access` 还在。删掉它不会让任何别的测试变红。

论证与实测记录见 `artifacts/verification/api-exposure/影响清单.md`。

### 「有草稿 / 未上架状态的公开集合」怎么写（有先例了，照抄）

`read: () => true` + 「状态过滤由前台查询层承担」**不成立**：C 端走 Local API（`overrideAccess`
默认 true）本来就不经 access，而 Payload 自带的 REST / GraphQL 不经任何查询层——匿名
`GET /api/<collection>?where[status][equals]=draft` 就能枚举并读完整正文，`?trash=true` 还能读回收站。
`status` 若只是普通 select 字段（没开 `versions.drafts`），Payload 一点都不会替你拦。

写法：集合级 `read` 返回 `true`（管理者）或 Where（其余人），Where 是**前台同一份可见性判据**：

- `Listings` / `Buildings`（OPT-104）：`isStaffRequest(req) ? true : <有效供给 Where>`。
- `Articles`：`createArticleReadAccess(canManageArticle)`（`domain/public-catalog/article-read-access.ts`）——
  与写侧**同一道门**，持资讯菜单码者全读，其余只读「已发布且 `deletedAt` 不存在」。
  启用 `trash` 的集合，Where 里必须带 `deletedAt: { exists: false }`，否则 `?trash=true` 绕得过去。

依赖这类集合「匿名读得到草稿」的脚本会被一并收紧：`news:publish` 的 slug 占用检查与草稿读回改为带专用账号 token。
守卫：`tests/articles-read-access.test.ts`（调 access 函数）+ `tests/articles-read-access-postgres.test.ts`（穿过 REST / GraphQL 处理器）。

## 高风险操作

审核、发布、举报、分配、认领、转派、导出敏感数据和角色权限变化必须二次校验权限，并记录请求 ID、操作者、对象、结果和必要前后事实。

