# OPT-083 验证证据：详情页参数字段后台可配

> 环境：worktree `E:\wt-082`（分支 `feat/opt-083-detail-spec-config-7511`），
> 独立库 `sbh_dev_opt082`（从主树夹具库 `postgres` TEMPLATE 克隆），
> `next dev -p 3719`，账号 `e2e-adm@example.com`（`scripts/seed.ts` 的公开夹具）。
> 日期：2026-09-10

---

## 0. 一句话结论

**数据层 → Global → 缓存失效 → registry → 面板 → 页面 HTML 这条链路全程验通。**
唯一没验到的是**后台表单里那 47 个勾选框的视觉渲染**，原因与代码无关，见 §5。

---

## 1. 上线零变化（默认配置 = 改造前现状）

`GET /api/globals/site-settings`：

| | 键数 | 值 |
| --- | --- | --- |
| `detailSpecFieldsBuilding` | 23 | 全部 `true` |
| `detailSpecFieldsListing` | 24 | 22 个 `true`，`verifiedAt` / `priceVerifiedAt` 为 `false` |

楼盘详情页 `/shanghai/buildings/lujiazui-grade-a-river-view` 渲染出的行清单：

| 组 | 行数 | 行 |
| --- | --- | --- |
| 建筑 | 8 | 物业类型 / 楼盘等级 / 竣工年份 / 总建筑面积 / 总楼层 / 标准层面积 / 层高 · 净高 / 得房率 |
| 机电与设施 | 7 | 客梯 · 货梯 / 空调 / 供电 / 网络 / 门禁 / 电梯分区 / 服务时间 |
| 费用与管理 | 5 | 物业费 / 物业公司 / 开发商 / 停车位 / 停车费 |
| 资质与运营 | 3 | 认证 / 可注册 / 最小可租面积 |

合计 **4 组 23 行**，与改造前那份硬编码清单逐字一致。

## 2. 逐行隐藏 + 整组收起

把 `efficiencyRate`（得房率）、`parkingFee`（停车费）关掉，并把「资质与运营」三项
（`certifications` / `registrationCapability` / `minLeasableArea`）全关：

| | 关闭前 | 关闭后 |
| --- | --- | --- |
| 组数 | 4 | **3**（「资质与运营」连组标题一起消失） |
| 建筑组行数 | 8 | 7（少了「得房率」） |
| 费用与管理行数 | 5 | 4（少了「停车费」） |
| 机电与设施 | 7 | 7（未受影响） |

**立即生效**，没有等 60 秒 TTL —— `SiteSettings.hooks.afterChange` 的
`invalidateSiteSettingsPublicCache()` 确实被触发了。

## 3. 「信息时效」组与日期格式化

默认下该组不出现（两项 `defaultVisible: false`）。打开后：

| 行 | 值 |
| --- | --- |
| 信息核验时间 | `2026-06-02` |
| 价格核验时间 | `2026-08-01` |

**不是 ISO 串**——`formatSpecDate` 生效。这是把这两条纳入候选池的前置条件
（`mapListingFactGroups` 对 `verification` 组没做展示格式化）。

## 4. 整块收起

- **房源**：24 项全关 → `#overview` 整个 section 消失，`<h2>房源概况</h2>` 一并不渲染，
  页面其余部分正常（`<h1>` 仍在）。这是本工作项**新增**的守卫，改造前该 section 无条件渲染。
- **楼盘**：23 项全关 → 4 个参数组全消失，但 `.dt-building-spec` 面板与 `#params` 区段仍在，
  内容是「楼盘特色」5 个标签（精装带家具 / 近地铁 / 中央空调 / 新风系统 / 智能电梯）。
  **这是正确行为**：楼盘特色不属于可配参数，`hasSpecPanel = hasSpecValues || hasFeatures`。

## 5. 没验到的部分（不要当成已验证）

**后台「站点设置 → 详情页参数」页签里 47 个勾选框的视觉渲染没有验到。**

原因：Browser 面板处于隐藏状态，页面 `document.visibilityState === "hidden"` 且
`requestAnimationFrame` **不执行**，React 提交不了帧。表现是「group 外壳渲染了、
子字段一个不出」，而且**既有的「图片水印」group 表现完全相同**——对照实验证明这与本次
改动无关，是取证环境的限制。

期间踩过的坑（记下来免得重复）：

1. 一度把「子字段不渲染」误判成「Payload 3.86 不渲染嵌套 group」，并据此改了字段结构。
   **对照组当时没验**——补上对照实验（既有 watermark group）后结论立刻被推翻。
   同一族教训：CLAUDE.md「做对照实验时先确认对照组真的是未修复状态」。
2. `next start`（NODE_ENV=production）下 `Users.auth.cookies.secure = true`，
   http 上 cookie 存不住，登录恒失败。本地走 `next dev`。
3. worktree 建在 `.claude/worktrees/` 下路径 68 字符，Turbopack
   `Module not found: '@nouance/payload-better-fields-plugin/Number'`，
   webpack 则静默只渲染外壳。搬到 `E:\wt-082` 后 dev / build 都正常。
   **搬完必须 `rm -rf node_modules && pnpm install`**——pnpm 的内部符号链接是指向旧路径的
   绝对链接，`--frozen-lockfile` 因 lockfile 未变而空转，不会修复它们。

**要补的一步**：请在 Browser 面板可见的情况下打开
`http://localhost:3719/admin/globals/site-settings` →「详情页参数」，核对：
两个 group（楼盘 / 房源）、9 个语义折叠段、47 个勾选框、默认勾选状态
（楼盘 23 全勾 / 房源 22 勾 + 信息时效 2 项不勾）、以及费用披露三项带
「关闭前请确认合规口径」说明。

## 6. 自动化闸门

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 干净 |
| `pnpm lint` | 0 errors（23 warnings，均为既有 `<img>` 提示） |
| `pnpm test` | **4747 passed / 41 skipped，0 failed** |
| `pnpm migrate:dry-run` | 本迁移 `no forbidden patterns`（4 条 warning 全在历史迁移上） |
| `pnpm build` | 通过 |
| `pnpm exec payload migrate` | 47 列干净落库 |
