# Task Packet：OPT-025 首页访问楼盘列表性能优化

> 状态：实施中  
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
- 风险：事件未覆盖时最多存在五分钟陈旧窗口。

## 6. 实施清单

- [ ] 建立失败缓存与页面接入合同测试。
- [ ] 增加双标签、300 秒兜底的楼盘搜索缓存封装。
- [ ] 楼盘列表改用缓存查询，保持筛选和分页语义。
- [ ] 相关测试、TypeScript 和生产构建通过。
- [ ] HTTP 对比与真实浏览器验收完成。
- [ ] 更新证据、风险和回滚说明。

## 7. 验收

- 自动化：新增合同测试与公开目录缓存相关测试。
- 性能：缓存命中请求不再稳定承担约 818–834ms 聚合耗时。
- 浏览器：首页 → 楼盘列表、筛选/分页、相邻 `/listings`、四档视口与控制台。
- 数据/迁移：无数据写入，无迁移。

## 8. 结果

实施完成后填写实际修改、自动化结果、TTFB、浏览器证据、未验证项和剩余风险。
