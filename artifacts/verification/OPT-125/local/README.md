# OPT-125 本地验证（2026-10-22）

库：`sbh_dev_metro`（迁移 + `pnpm seed` + `import-geography.ts --file seed/geography/shanghai.json --apply`，394 个上海站点）。

1. `buildings:nearest-metro:plan --max-distance=2000`：只读连接生效（`SHOW default_transaction_read_only` = on），8 栋楼里 5 栋有坐标，全部在 600m 内 → `plan-summary.md` / `plan.json`。
2. `execute --max-distance=3000`：被拒（比计划阈值宽）。
3. `execute --max-distance=300`：写入 3 栋（南京西路 ×2、陆家嘴 ×1）→ `applied.jsonl`；全表其它列（去掉 updated_at / version / nearest_metro_id 后的整行 JSON）执行前后逐字节一致，version 1 → 2。
4. 再跑一次 execute：3 栋全部「已有最近地铁」跳过 → `execute-skipped-second-run.json`。
5. 浏览器：楼盘详情「地铁 南京西路」；房源列表卡片「近南京西路」；`/shanghai/listings?metro=shanghai-metro-nanjing-xilu` 共 4 套，`?metro=shanghai-metro-lujiazui` 0 套（300m 内只回填了没有房源的国金中心）→ `listings-metro-filter-lujiazui.jpg`。
6. 回滚前把楼盘 2 手工改成陆家嘴站，`rollback`：1、8 改回空，2「当前值已不是当时写入的站，不动」→ `rollback.jsonl`；回滚后其它列与执行前逐字节一致。
