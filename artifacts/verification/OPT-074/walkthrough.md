# OPT-074 浏览器走查记录

> 环境：本地 dev（`pnpm dev`，端口 3717），本地 PG 已 `payload migrate` 至最新（`migrate:status` 全 Yes）
> 账号：`e2e-adm@example.com`（`scripts/seed.ts` 的公开夹具）
> 日期：2026-09-06 ~ 09-07

## 一、八处入口渲染

| 入口 | 结果 | 备注 |
|---|---|---|
| 楼盘（Buildings） | ✅ 级联框 1，回显「上海 / 长宁 / 虹桥」 | 多字段控制器 |
| 投放申请（SupplySubmissions） | ✅ 级联框 1，回显「上海 / 崇明区」 | 后台不允许 create（access 拒绝，设计如此），造了一条测试数据后验证，验完已删 |
| 线索（Leads） | ✅ 级联框 1 | 单字段，三层任选 |
| 城市站点配置（CitySiteProfiles） | ✅ 级联框 1 | 多选 + 按 profile 城市裁剪 |
| 资讯（Articles） | ✅ 级联框 1 | 多选 |
| 经纪人（Brokers） | ✅ 级联框 1 | 多选 + 按服务城市裁剪 |
| 地理别名（LocationAliases） | ✅ 无级联框（设计如此），4 个字段正常 | kind 含 metro_station，级联数据源只有行政链，故只补 filterOptions + guard |
| 商圈扩展（BusinessAreaExtensions） | ⚠️ 页面不可达 | **既有缺陷**，非本次引入，见下 |

## 二、既有缺陷：collection 级 `admin.hidden` 会杀掉路由

`BusinessAreaExtensions` 的注释写着「直接 URL 仍可访问用于排障」。实测访问
`/admin/collections/business-area-extensions/create` 得到「没有找到任何东西」。

对照实验：把 `hidden` 临时改为 `false` → 页面立刻正常（6 个字段、级联框 1 个）；改回 `true` → 又 404。

结论：Payload 3.86 的 **collection 级 `admin.hidden: true` 会连 `/admin/collections/<slug>/*` 路由一起排除**，
与 OPT-053 里 Global 的 `admin.hidden` 是同一个坑。

本工作项只订正了那句错误注释，未改行为（改导航超出范围）。已另开工作项跟踪。

## 三、级联交互

- 三列逐级展开正常，第一列按 `scopeCityField` 收窄到单个城市
- 「上海 / 长宁 / 古北」→ 保存 → 库中 `city_id=1, district_id=8, business_district_id=806`，三个字段全部正确写入
- 修复前后对照见 `regression-proof.txt`

### 两个只有真机点击才暴露的问题

1. **Arco Cascader 的 `disabled` 向下继承**：原本用 `disabled` 同时表达「节点停用」和「该层不可选」，
   结果把城市/行政区标 disabled 后，它们底下的商圈全被连带禁用 ——「只能选商圈」的配置反而一个商圈都点不了。
   改为 `disabled` 只表达 status，层级策略交给 `changeOnSelect`。
2. **`dispatchFields` 不置脏**：多字段写回后级联框显示已变、form state 也变了，
   但右上角「保存」按钮始终 `btn--disabled`，改动提交不出去。`useField().setValue` 会自己置脏，
   `dispatchFields` 不会，必须显式调 `setModified(true)`。

> 方法论备注：JS `document.click()` 触发不了 Arco 列表项的选择逻辑（console 无 onChange 日志），
> 必须用真实鼠标事件。上面两个问题都是换成真实点击后才暴露的。

## 四、回归取证

见同目录 `regression-proof.txt`。四个场景全部通过：

1. 停用被引用的商圈后改楼盘摘要 → **保存成功**（改动前会被拦，报「该字段有以下无效的选择：11」）
2. 主动改选已停用商圈 → 被拦，报「商圈『虹桥』已停用，不能选用」
3. 跨城混搭（上海楼盘 + 外市行政区）→ 被拦，报「行政区『测试滨江区』不属于所选城市『上海』」（改动前**存得进去**）
4. 同城合法改动 → 正常保存，无误杀

## 五、自动化闸门

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 干净 |
| `pnpm lint` | 0 errors（22 个既有 `<img>` warning，与本次无关） |
| `pnpm test` | 4625 项通过 |
| `pnpm migrate:dry-run` | 通过（4 条既有 warning） |
| `pnpm build` | 通过 |
