# OPT-037 终审第 2 轮验证证据

结论与逐条说明见 `.superpowers/sdd/2026-08-21-detail-pages-redesign/final-fix-2-report.md`。

## 复现方式

```bash
# 1) 起生产 server（**不要**覆盖 DATABASE_URL；避开 3717）
cd payload-office-platform
CI=1 pnpm build
CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> \
  MULTI_CITY_ROUTING_ENABLED=false PORT=3802 pnpm exec next start -p 3802
# 少了 CI=1 / https 的 NEXT_PUBLIC_SITE_URL，config-guard 会 fail-closed，
# 症状是「房源类路由全线 404、楼盘类照常 200」。

# 2) 预热（必须！否则高德 POI 冷抓会比出假差异）
bash warm.sh http://localhost:3802

# 3) 采样
node capture.mjs      http://localhost:3802 <before|after>   # HTML + 四断点截图 + 死规则运行时扫描
node scan-extra.mjs   http://localhost:3802 <before|after>   # 补充选择器扫描
node deep-measure.mjs http://localhost:3802 <before|after>   # 逐属性 computed style

# 4) 比对
bash html-diff.sh before2-html after2-html
node imgdiff.mjs   before2 after2
node diffrange.mjs before2 after2
```

## 已落盘的比对结果

**入库范围（2026-08-22 终审第 3 轮补齐）**：下表全部文件 + `report-*.json` / `deep-*.json` /
`scan-extra-*.json` / `build-*.log` / `server-*.log` 均已入库。
**未入库**：`*-html/` 六个目录与整页 PNG（体积原因），用上面的脚本可重现。
（第 3 轮之前，本表列出的 JSON 与日志其实都还是未跟踪状态——「已落盘」与「已入库」是两件事。）

| 文件 | 内容 |
|---|---|
| `html-diff-A.txt` | 第 A 轮 热 vs 热 HTML 逐字节比对：19/20 SAME，唯一差异是高德 POI 子树 |
| `html-diff-B.txt` | 第 B 轮 热 vs 热：同样 19/20 SAME，差异页面与方向都与 A 轮不同 → 证明是外部服务不确定性 |
| `html-diff-samebuild-control.txt` | **对照组**：同一个构建两次抓取也会比出同型差异 |
| `imgdiff-A.txt` / `diffrange-A.txt` | 四断点 36 张整页截图逐像素比对与差异 Y 区间 |
| `diffrange-selfcontrol.txt` | **对照组**：同一个 server 连抓两次的像素噪声本底（数值不小于甚至远大于改前改后的差异） |
| `deep-diff.txt` | 47 选择器 × 46 属性 × 4 断点的逐属性差异全集（308 条，逐类归因见报告 §2） |
| `report-*.json` / `deep-*.json` / `scan-extra-*.json` | 结构化产物 |
| `*-html/` | HTML 原文（体积原因未入库，本地保留：`before2/after2` 与 `before3/after3` 为权威热抓，`before/after/after-html-cold` 为冷抓对照） |
