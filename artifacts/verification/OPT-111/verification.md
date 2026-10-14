# OPT-111 验证证据（2026-10-14）

工作项：`specs/work-items/OPT-111-cache-invalidation-scope.md`。全部在本地生产构建（`next start`）上取得；线上复测待合并后补。

## 闸门

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 通过（lint 0 error，35 条既有 warning） |
| `pnpm test`（无 `DATABASE_URL`，postgres 套件按设计不收集） | 444 文件 / 6022 条全绿 |
| `pnpm build` | 通过（改动前 `origin/master` 与改动后两棵树各构建一次） |

## 本地前后对照：写入后两城首页缓存是否未命中

脚本：`setup-fixtures.sh`（只动本地库：杭州置 live、一条上海房源改草稿）+ `probe-home-misses.sh`。
观测量：生产模式下首页缓存未命中打 `[public-catalog:home-cache] {"city":...,"phase":"start"}`。
同一个库、同一个脚本，先跑改动前（`origin/master`）、再跑改动后；每次起 server 前删 `.next/cache/fetch-cache`。
页面先过 OPT-037 共享哨兵（状态码 200 + `hm-home` / `hm-hero` 标记），预热必须真触发过一次回源，否则脚本拒绝出结论。

| 写入 | 改动前 上海 / 杭州 | 改动后 上海 / 杭州 | 期望 |
| --- | --- | --- | --- |
| a 已上架房源改租金 | 未命中 / 未命中 | 未命中 / **命中** | ✓ |
| b 已上架房源只改房号 | 未命中 / 未命中 | **命中 / 命中** | ✓ |
| c 草稿房源改租金 | 未命中 / 未命中 | **命中 / 命中** | ✓ |
| d 资讯改标题（正对照） | 未命中 / 未命中 | 未命中 / 未命中 | ✓ 观测手段在改动后仍灵敏 |

原始数据：`before.json`、`after.json`。服务端日志里对应两行跳过记录：
`{ collection: 'listings', id: 1, reason: 'internal_fields_only' }`、`{ collection: 'listings', id: 11, reason: 'never_public' }`。

### 对照实验中途发现并修复的缺陷

`after-first-attempt.json` 是修复前的改动后结果：b 行（只改房号）上海仍未命中。
根因（向真实 Payload 注入诊断 afterChange hook 取证，脚本未入库）：

1. Listings 的 beforeChange 每次保存都由 `mediaItems` 重建 `gallery`，数组行 id 每次都换；
2. `previousDoc` 恒为 depth 0，`doc` 随调用方 depth（Local API 默认 `defaultDepth=2`）展开关系。

逐键深比较因此恒判「有变化」。修复（提交 `fix(cache): OPT-111 比较前归一化…`）：比较前把带 id 与
时间戳的展开文档收成 id、去掉数组元素的行 id，顺序与内容照常比较。真实 Payload 复核：depth 0 与默认
depth 下只改房号均跳过，改租金照常失效；单测 `gallery-rows-rebuilt` / `default-depth` 先红后绿。

## 浏览器走查（`browser-walk.mjs` → `browser-walk.json`）

1440×900，生产模式 server，上海已上架房源 `huangpu-bund-coworking`：

1. 前台详情与列表各预热两次（200，列表含该房源链接）。
2. 后台真实表单（`/admin/collections/listings/4`）改「租金」输入（字段为 `price.amount`），保存：
   `PATCH /api/listings/4?depth=0` → 200，请求体含新值。
3. 前台刷新：详情立即显示新值 4721（`detail-after-rent-edit.png`），列表仍含该房源。
4. 调用后台下架按钮的同一端点 `POST /api/listings/4/publish {action:'unpublish'}` → 200；
   前台刷新：详情 **404**，列表**不再**含该房源——硬过期语义未变。

控制台：两条 `ERR_TUNNEL_CONNECTION_FAILED` 是本云端会话代理拦外部主机（后台页的外部资源），
一条 404 是第 4 步预期的已下架详情页；无改动引入的错误。

## 未验证

- **线上复测**（工作项 Task 4 Step 4）：合并即上线后，按小时统计运行日志 `[public-catalog:home-cache]`
  `phase:start` 次数与上线前同时段对比，并统计 `[supply-cache-invalidation] skipped` 的 `reason` 分布。
- **采集发布（Task 3）只有单测**：本地没有采集批次夹具，未跑真实的整轮发布。
- **多实例**：本项不改变 OPT-042 的跨实例传播缺口。
