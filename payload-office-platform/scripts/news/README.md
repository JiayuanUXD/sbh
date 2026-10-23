# 资讯日更流水线（OPT-124）

给「每天写一篇资讯」的执行方（人或外部 agent）用的三条命令。确定性的步骤（取数、对账、核对、发布、验收）都在这里，执行方只负责选题和写稿。

| 步骤 | 命令 | 需要什么 |
| --- | --- | --- |
| 取数 + 对账 + 快照 | `pnpm news:data --out=<目录> --archive=<快照目录>` | 什么都不要（只读公开接口，约 2–4 分钟） |
| 发布前检查 | `pnpm news:check --slug=<slug> --numbers=<numbers.json>` | 什么都不要（只读） |
| 发布 | `pnpm news:publish --slug=<slug> --numbers=<numbers.json> [--status=published]` | 专用后台账号的 `SBH_BOT_EMAIL` / `SBH_BOT_PASSWORD` |

本机 node 有时会被以 x64 拉起、报缺 `darwin-x64` 绑定，命令前加 `arch -arm64`。

## 一篇文章怎么走

1. **取数**：`news:data` 拉在租房源（发布 + 审核通过 + 租赁 + 供给正常），算全市 / 行政区 / 商圈的条数与「元/㎡/天」分位数，然后和前台逐项对账：列表页总数、各区计数，抽查落地页的报价样本数、P25、中位数、P75。**对不上退出码 1，这批数字不能用**（拉取的几分钟里供给在变也会这样，隔几分钟重跑）。`--archive` 每天存一份快照，月报做环比靠它，库里没有历史。
2. **分析**：针对选题写分析脚本，读 `<out>/listings.json` 等原始数据，产出本篇的 `numbers.json`。文章要用的派生数（百分比、差值、月租估算、几个区合计）都在脚本里算好写进去，正文里不心算。
3. **写稿**：`content/articles/<slug>.md` + `content/articles/covers/<slug>.jpg`，格式与规则见 `scripts/lib/article-content.ts`（和 `tests/article-content-files.test.ts` 同一份）。关联商圈 / 楼盘写在 frontmatter：

   ```
   relatedDistricts: lujiazui, pudong
   relatedBuildings: qian-tan-zhong-xin-248
   ```

   商圈落地页的「相关资讯」、文章详情页的「相关推荐」都靠这两个字段。落地页不公开的区域（2026-10-22 实测有外滩、新天地、北外滩等）能关联，但详情页只显示名称、落地页上也看不到这篇，`news:check` 会提醒。
4. **检查**：`news:check` 跑内容规则、封面规格、数字核对、关联是否存在、站内链接是否 200。有问题退出码 1。
5. **发布**：`news:publish` 先把第 4 步全部重跑一遍，不通过不发；然后登录 → 上传封面（用途 `article`，否则会被当房源图打水印）→ 新建文章（带关联）→ 验收（已发布看详情页，草稿读回接口）。**只新建不覆盖**，同 slug 已存在（含回收站）直接停下。`--dry-run` 只做检查和只读准备。

已经在库里的文章要改，走后台；要从 Markdown 整篇覆盖，用有数据库权限的 `scripts/import-articles.ts --execute --only=<slug>`（不带 `--only` 会动到目录里所有文章）。

## numbers.json

```json
{
  "asOf": "2026-10-22T08:50:00.000Z",
  "numbers": [
    { "key": "huangpu.median", "value": 5.36, "basis": "黄浦区 元/㎡/天 挂牌价中位数", "sample": 6730 },
    { "key": "estimate.area", "value": 100, "basis": "月租估算假设面积" }
  ]
}
```

- `asOf` 是取数时刻，默认超过 36 小时就不让过（`--max-age-hours` 可调）。
- 每个数一条，`basis` 写口径；筛选参数、估算假设（100㎡、30 天）也要列，它们同样会出现在正文里。
- 匹配规则：小数按写出来的位数取整（4.7 ↔ 4.68）；条数等整数必须完全相等，前面带「约 / 近」才按末尾的 0 取整（近 2,900 ↔ 2,865）；「X 万」「X%」按位数取整，「X 多万」要落在区间里。年月日、时刻、「N 号线」、「第 N」、Q4 / P25 这类和不带单位的 0–10 计数不核对（`--strict` 连小整数也核）。细节见 `scripts/lib/news-numbers.ts`。

## 专用账号

后台「角色」新建一个只有「资讯中心」「素材库」两个菜单权限的角色，再建一个只挂这个角色的账号。凭据只放在执行环境的环境变量里，不要写进仓库或任何 `.env` 文件。这条链路**不需要、也不应该**拿生产库连接串、`PAYLOAD_SECRET`、COS 密钥。

本地实测用的是种子里的运营夹具账号（`e2e-ops@example.com`，有这两个菜单权限），结果见 `artifacts/verification/OPT-124/`。
