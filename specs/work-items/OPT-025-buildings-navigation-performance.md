# Task Packet：OPT-025 首页访问楼盘列表性能优化

> 状态：已完成  
> 创建日期：2026-08-07  
> 最后更新：2026-08-07

## 1. 目标

让首页进入楼盘列表以及楼盘筛选、分页的缓存命中请求复用楼盘公开目录结果，不再每次执行约 0.82 秒的在租面积聚合 SQL。

## 2. 非目标

- 不重写 SQL，不增加索引、物化视图、Collection 或迁移。
- 不改变楼盘列表视觉、公开 DTO、URL 筛选、分页、SEO 或权限。
- 不扩大到房源列表或其他前台缓存路径。

## 3. 权威上下文

- Design：`docs/superpowers/specs/2026-08-07-buildings-navigation-performance-design.md`
- Plan：`docs/superpowers/plans/2026-08-07-buildings-navigation-performance.md`
- Agent：`payload-office-platform/FRONTEND_AGENT.md`、`.agent/frontend.md`、`.agent/supply.md`、`.agent/testing.md`

## 4. 当前行为与证据

- `/buildings` 热态 TTFB 约 1.2 秒。
- 热态楼盘基础读取约 21–22ms；在租面积聚合约 818–834ms。
- 页面每次直接调用 `searchBuildings`，尚未使用既有公开目录缓存体系。

## 5. 影响范围

- 预计修改：前台缓存封装、楼盘列表路由、合同测试、验证文档。
- 缓存：`public:buildings` + `public:listings`，`revalidate: 300`。
- 数据模型/迁移：无。
- 风险：领域事件 tag 是主要即时失效机制；事件未覆盖时，`revalidate: 300` 只表示重新验证阈值。超过阈值的首个请求可能返回旧值并后台刷新，后续请求才获得新值，不存在严格五分钟陈旧硬上限；用户已选择优先访问速度并接受该权衡。

## 6. 实施清单

- [x] 建立失败缓存与页面接入合同测试。
- [x] 增加双标签、300 秒兜底的楼盘搜索缓存封装。
- [x] 楼盘列表改用缓存查询，保持筛选和分页语义。
- [x] 相关测试、TypeScript 和生产构建通过。
- [x] HTTP 对比与真实浏览器验收完成。
- [x] 更新证据、风险和回滚说明。

## 7. 验收

- 自动化：新增合同测试与公开目录缓存相关测试。
- 性能：缓存命中请求不再稳定承担约 818–834ms 聚合耗时。
- 浏览器：首页 → 楼盘列表、筛选/分页、相邻 `/listings`、四档视口与控制台。
- 数据/迁移：无数据写入，无迁移。

## 8. 结果

实际修改：`getCachedSearchBuildings()` 复用 `public:buildings` 与 `public:listings` 两标签、300 秒重新验证阈值的公开目录缓存；`/buildings` 使用该缓存，保留 URL 区域/等级筛选和内存分页语义；新增缓存固定键、双标签、重新验证阈值与页面接入合同测试。领域事件 tag 负责主要即时失效；无事件命中时采用 stale-while-revalidate，不承诺严格五分钟陈旧上限。

自动化：Node 22.23.2 / pnpm 8.6.1 下，`public-catalog-cache-invalidator`、`cache-next-adapter-integration`、`f7-4-6-performance-data-equivalence` 与 OPT-025 合同测试共 38/38 通过；fresh `pnpm exec tsc --noEmit --pretty false` exit 0。使用项目 config-guard 测试认可的安全占位 `NEXT_PUBLIC_SITE_URL=https://sbh.example.com` 后生产构建 exit 0，`/buildings` 构建成功；隔离环境原本缺此变量会使 `/robots.txt` 构建失败。

TTFB：Node 22 服务的 `/buildings` 连续缓存命中为 0.006181s、0.006084s，`/buildings?page=2` 为 0.005814s，不再稳定承担设计记录的 818–834ms 聚合耗时。在有效 HTTPS 非 localhost 占位 URL 的 clean 服务中，`/`、`/buildings`、`/listings` 的首请求均为 200，分别为 0.846162s、0.018179s、1.197365s TTFB。此前首页 500 已定位为将本地访问 URL 错设为生产站点 URL 的验证配置错误。

浏览器：有效配置的 Node 22 服务中首页主标题正常，点击“找写字楼”进入 `/buildings`（共 26 个楼盘），点击前后 console error 为空；此前已验证黄浦筛选（2 项）、第 2 页（25–26 / 共 26）、`/listings`（24 个链接）及 375×812、768×1024、1440×900、1920×1080 无水平溢出。

详细命令、实测值、未验证项、环境限制、剩余缓存风险和回滚方式见 `artifacts/verification/OPT-025/README.md`。
