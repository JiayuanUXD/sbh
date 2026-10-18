# OPT-121 楼宇等级规范化验证

## 改动与数据边界

- 规范选项为超甲级、甲级、乙级、未评级，对应 `super-grade-a`、`grade-a`、`grade-b`、`ungraded`。
- 后台、公开卡片/详情、SQL/内存筛选与分面/排序、导入和小程序口径一致。旧 `creative-park` / `serviced-office` 及空值读取为未评级，物业类型独立保留。
- 仅主动提交等级时规范化保存。真实 Payload 字段管道回归及 REST + PostgreSQL 验证了省略等级的 PATCH 不改原始等级；标记以每次操作的 data 对象隔离。
- 使用统一等级语义版本更新 Web 11 条与 Mini 4 条 DTO 缓存键，避免持久化缓存继续返回旧分面或等级。未手动清缓存。
- 保留已完成的 OPT-120 楼盘 URL 自动生成改动。当前分支 `codex/building-auto-slug-b7e41a`，本项未提交、推送、创建 PR 或部署。

## 显式迁移

生成并在环回地址的本地 PostgreSQL 应用了 `20261017_160929_opt_121_building_grade_options_expand`。迁移正文与 JSON 均由 Payload 生成，未手改。

- [迁移快照对比](./migration-snapshot-diff.json)：除快照 ID，仅有 grade 枚举扩展；保留两个旧枚举，无业务数据回填。
- [迁移前](./db-before.json) / [迁移后](./db-after.json)：已有 9 行的 ID、原始等级、删除时间逐条一致；无待应用迁移，共 96 项已应用。
- 默认未评级采用应用层函数默认值。初次生成发现固定数据库默认值会导致自动 down 的 enum 依赖错误，故调整配置后重新生成了尚未应用的本项迁移；最终生成物无数据库默认值。
- `migrate:dry-run`：通过，8 条警告（含历史迁移及本次枚举类型转换），无阻断。
- `migrate:drift`：通过，配置与最新快照一致。
- `migrate:verify`：339 项检查，0 失败、26 警告（现有数据与迁移历史提示）。日志见同目录。
- 未执行 down。已有新等级数据时不能直接缩回旧枚举；后续回滚代码保留扩展枚举，是否回填/收缩另行评估。

## 自动化与运行时

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 实现目标回归 | 10 文件、283 项通过 | `payload-targeted-green.log` |
| Payload 字段管道与缓存收尾 | 6 文件、63 项通过 | `payload-final-regression.log` |
| 首轮应用全量 | 477 文件、6,531 项通过 | `payload-test.log` |
| 最终应用全量及发现关闭 | 478 文件中 476 通过、2 失败；6,541 项通过、1 项失败、5 项因前置超时未执行。两处测试问题修正后分别 2/2、5/5 通过，见下文 | `payload-test-final.log`、`payload-navigation-contract.log`、`payload-cache-scope-node22-green.log` |
| PostgreSQL SQL/内存逐项对比 | 63 项通过，使用事务内临时表 | `postgres-parity.log` |
| 类型检查与定向 ESLint | 退出码 0 | `payload-final-typecheck.log`、实现报告中的 lint 日志 |
| 最终构建 | Node 22.22.2 下通过，退出码 0 | `build.log` |
| 小程序相关行为测试 | Node 22.22.2 下 58 项通过 | `miniprogram.md` |
| 小程序类型与工程检查 | Node 22.22.2 下通过 | `miniprogram.md` |

[运行时结果](./runtime-results.json)包含 14 项真实 REST + PostgreSQL 断言：旧两值/null 展示为未评级但省略 grade 的 PATCH 保持 raw 原值；显式新四值/旧两值/null 保存并刷新一致；4 类非法输入返回 400 且原始等级未变。修复前 `runtime-red.log` 已实际复现仅改名称误写等级，修复后 `runtime-green.log` 全部通过。

最终全量发现两处测试维护问题，后续未再修改应用实现：导航源码守卫仍按旧缓存键匹配且仅支持 LF，现明确验证资源键、城市、共享语义版本、tags 和 300 秒阈值，并兼容 CRLF；缓存 tag 测试在 beforeAll 导入 sitemap 的无关依赖重图导致 Node 22 超时，现仅 mock 不会执行的城市上下文和静态 URL 回调提供者，保留真实 sitemap 缓存模块、全部断言及原 10 秒门槛。Node 22 下复跑缓存 5 项仅需 731ms。最终全量日志保留原始失败，不将定向修复后的结果写成另一轮全量通过。

小程序全量的 47 文件 / 971 项中，859 通过、112 失败。失败限于 4 份既有发布工具测试，Windows 缺少 `process.getuid` / `O_NOFOLLOW`；本项未修改或跳过这些测试。最初 Node 24 工程检查失败，改用机器已有 Node 22 后工程检查通过。尚未做微信开发者工具或实机验收，详见 [小程序报告](./miniprogram.md)。

## 浏览器与页面

- 使用真实浏览器在本地创建草稿 1762；[请求与响应](./browser-requests.jsonl)记录 POST `grade-b` 返回 201，以及 PATCH `ungraded` 返回 200。两次均完整刷新确认回显。
- 后台四选项和深浅色展开浮层已截图。未评级后台筛选命中旧值楼盘、空等级楼盘及本项草稿，共 3 条。
- 前台旧值楼盘详情显示未评级，物业类型仍为联合办公。未评级筛选找到 2 个公开楼盘，分别覆盖旧业态值与空值。
- [四档视口](./viewports.json)覆盖 375×812、768×1024、1440×900、1920×1080；移动端展开筛选抽屉后确认未评级，结果楼盘一致。
- [页面检查](./page-results.json)覆盖 health、首页、默认目录、未评级筛选、详情与 Mini API，均 200；默认目录直接取得新等级分面和当前 slug。构建后已重启本地服务，再次检查均通过，日志 `page-check-final.log`。
- [浏览器错误日志](./browser-errors.json)：0 条错误。
- [清理结果](./cleanup.json)：本项草稿已软删除，无关联房源；迁移前已有 9 行数据仍逐条一致。
- 最终本地服务运行于 `http://localhost:3717`（Node 22.22.2）；临时取证代理 3720 已停止。浏览器已重新打开正式本地端口的创建表单并确认四选项，见 `final-options.png`。

## 提交与发布兼容补验（2026-10-18）

用户已授权提交并在 CI 全绿后合并。已补 URL 参数 `gradeSchema=quality-v1` 的明确能力协商：未声明或未知版本将乙级/未评级降为旧客户端可解析的 null，规范缓存不变；新版统一请求层追加唯一参数。覆盖首页、楼盘列表/详情/推荐、房源详情关联楼盘和 me 收藏，旧业态等级筛选归一为未评级。

Node22 服务端相关 86 项、新客户端 168 项测试、类型检查与工程检查均通过。`shipping/check-client-compat.mjs` 使用冻结提交 4067918 中的真实旧客户端解析器，验证实际 HTTP 的旧请求、新请求、未知版本、再旧请求均符合对应契约；输出 `shipping/client-compat-local.json`。最终 Payload 全量 479 文件、6,556 项全通过；lint 0 错误/37 既有警告；迁移 dry-run 通过，证据均在 `shipping/`。

发布预检发现 master 上一次部署因 3,611,991 字节代码包超过既有 3MB 门槛失败。仅将供本地资讯导入脚本使用的 content 原稿/封面设为 export-ignore，保留运行时源码、public、src/assets、迁移和 migrate-locked；基线估算降至 2,484,034 字节，最终提交仍须重新归档核验。未放宽部署阈值。小程序仍不自动提审或发布微信版本。

独立审查及问题闭环见 [审查报告](./review.md)；具体实现与红绿过程见 [实现报告](./implementation.md)。
