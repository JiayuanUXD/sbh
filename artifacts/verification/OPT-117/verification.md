# OPT-117 验证记录

> 工作项：`specs/work-items/OPT-117-miniprogram-user-copy.md`
> 分支：`fix/opt-117-miniprogram-user-copy-2c1d`
> 日期：2026-10-15，本机 macOS，Node v24.14.0

## 1. 生产可配文案只读核查（用户授权）

只读连接（`default_transaction_read_only=on`，10 s 语句超时，连接串不落输出），扫 `site_settings*`、`city_site_profiles*` 全部文本列中 ≥8 字的中文：

- `city_site_profiles.seo_description`：7 个城市均以「由运营团队核验后跟进」结尾（与本地一致，来源是种子迁移）→ 只给建议：后台「城市站点配置」逐城改为「由专业顾问跟进」或删去。未改库。
- `site_settings`（首页标题 / 标语已被运营改成「把找办公室变成一件简单的事」等）、免责声明、页脚、`site_settings_type_cards`、`site_settings_value_props`：均为用户语言。

## 2. 改动

- **M1 咨询记录状态**
  - 服务端：新增 `src/domain/mini-program/inquiry-status.ts`（`MINI_INQUIRY_STATUS_LABELS`），`/api/mini/v1/me` 的咨询状态改用它，不再复用 CRM `LEAD_STAGE_LABELS`（后台不受影响）。
  - 小程序：`services/user-assets.ts` 同表；解析时只校验 `status.value` 与 label 非空，展示一律取本地表。原测试「拒绝合法 value 携带不一致 label」是有意设计，改写为新语义：不一致 / 伪造 label **不上屏**，但不再判整份响应无效；形状校验（label 非空）保留并加测。
- **M2 成功文案按最初咨询对象区分**（顺带修正既有问题）：直接在楼盘页咨询时服务端同样返回 `building`，此前一律说「已转为该楼盘需求」。现在：从房源转到楼盘 →「这套房源刚有变动，已为您记下对该楼盘的需求」；直接问楼盘 →「已收到该楼盘咨询」。
- M3–M13：见工作项 §2。

## 3. 自动化

| 项 | 结果 |
|---|---|
| 服务端新测 `tests/opt117-mini-inquiry-status.test.ts` | 先红（模块不存在）后绿；覆盖全部线索阶段、映射、不含销售侧术语 |
| 服务端 `tests/mini-api-me-route.test.ts` | 期望 label「跟进中」→「顾问跟进中」，先红后绿 |
| Web `pnpm typecheck` / `lint` / `test` | 通过 / 0 error（35 warning 既有）/ **455 文件 6218 条全过** |
| 小程序 `tests/inquiry-tracker.test.ts`、`profile-page-behavior.test.ts` | 改为新文案与新语义，先红（4 条）后绿 |
| 小程序 `tests/inquiry-sheet.test.ts`、`profile-page-contract.test.ts` | 成功文案、号码未更新提示、找房需求 toast 同步；新增「直接咨询楼盘」用例；先红（4 条）后绿 |
| 小程序 `pnpm typecheck` | 通过 |
| 小程序 `pnpm test` | **944 / 945**，唯一失败 `tooling-scripts.test.ts > project:check > 在受支持的 Node 22 下完成纯本地工程检查` |
| 小程序 `pnpm project:check` | **未能执行**：脚本要求 Node `>=22.12 <23`，本机 v24.14.0 且未装 Node 22 |

上面两项是同一个环境原因（该测试就是调用 `project:check`），与改动无关；`.github/workflows/miniprogram-quality.yml` 在 Node 22 下对改动 `sbh-miniprogram/**` 的 PR 运行，会补上。

## 4. 未执行

- **微信开发者工具冒烟 / 真机**：本机装有开发者工具，但 `pnpm devtools:smoke` 需开启服务端口、已登录并会打开 IDE 窗口，且只验证三页能进入、不核对文案。按 README，Node 测试不能替代开发者工具或真机验收——文案在模拟器与真机上的实际显示**未验证**。
- **`/api/mini/v1/me` 实机请求**：需小程序匿名会话签名，本地未配置；由路由测试（mock payload）覆盖投影结果。

## 5. 发布注意

小程序尚未对外发布（MP-108 执行中）。客户端改为按值校验后，服务端与小程序谁先发布都不会让「咨询记录」加载失败；预发 / 体验版在 Web 发布后照常重新上传即可显示新文案。
