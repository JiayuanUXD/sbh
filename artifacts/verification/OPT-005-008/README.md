# OPT-005～OPT-008 验证证据

## 自动化

- 全量测试：93 files / 1873 tests passed。
- TypeScript：通过。
- Next.js 生产构建：通过。
- Node.js engine 警告：本机 24.14.0，项目要求 22.x；正式验收应在 Node.js 22.x 复跑。

## 新增关键回归

- 1000 条后仍继续读取暂停记录。
- 暂停记录第二页查询失败时拒绝返回部分结果。
- 关系商户覆盖 Listing 冗余 merchant，防止混合快照。
- 重叠有效关系 fail-closed。
- 关系查询携带统一 `asOf`、半开区间条件、`limit=2` 和关系 merchant 深度。

## 运行时

- `/listings`：200，显示“共 8 套在租房源”。
- `/listings/jingan-serviced-office-42-seats`：详情标题和咨询入口正常。
- `/sitemap.xml`：200，包含 listing、building、page 三类 URL。

## 未完成

- sitemap 已消除固定 200/500 条截断，但尚未为 50,000+ URL 生成 sitemap index 和分片，因此 OPT-008 仍保留未完成状态。
