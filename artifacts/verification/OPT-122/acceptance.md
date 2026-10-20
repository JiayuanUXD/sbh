# OPT-122 验收报告

- 日期：2026-10-20 初验 + 当日整改复验（本版为复验结论，初验记录见文末）
- 验收人：独立复测（不复用实施自述结论，逐项实测）
- 分支：`feat/opt-122-site-search-6912`（worktree `E:\wt-opt122`，基线 `4af9531d`，未提交）
- 验收依据：`specs/work-items/OPT-122-site-search-and-search-quality.md` §16 验收清单
- 环境：dev server（`next dev -p 3721`）+ 生产构建；库 `sbh_dev_opt122`（种子数据：11 房源 / 8 楼盘 / 0 资讯）

## 结论：**通过（PASS，附 5 项不阻塞偏差）**

初验为「有条件通过」：A2/A3/A4/A5 部分达成、Phase 3 输入联想未实现、3 个证据文件缺失。
当日完成整改并复验，**12 项验收全部通过，范围缺口与证据缺口补齐**。

## 复验结果（整改项）

| 初验项 | 初验 | 整改动作 | 复验 |
|---|---|---|---|
| A2 分页器运行时验证 | PARTIAL（种子数据无第 2 页） | 向 dev 库临时插入 30 条有效房源（验证后删除，库恢复 11 条种子） | **PASS**：page=1 共 30 条 / 24 张卡 / 分页链接带 `aria-current`；page=2 余 6 张 |
| A3 房源 tab 楼盘出口 | PARTIAL（无出口） | `SiteSearchView` 新增分类型零结果：楼盘命中时出「暂无在租房源 + N 个相关楼盘 + 查看全部」 | **PASS**：`q=静安待租楼盘&tab=listings` E2E 断言出口与链接 |
| A4 `shzx`/`IFC` 解析 | PARTIAL（种子库无对应楼盘） | seed 新增「上海中心」「上海国金中心」（0 在租，位于陆家嘴） | **PASS**：`shzx`/`IFC`/`上海中心` 均 → 楼盘 1 命中，E2E 断言直达 |
| A5 放宽标注 | PARTIAL（未点名忽略词） | 接线既有 `relaxQuery.dropped` → `relaxedTerms`，标注「已忽略『游泳池』」 | **PASS**：`q=静安 游泳池` E2E 断言；`q=静安 整层` 有完美匹配则不触发放宽（符合预期） |
| 范围缺口：输入联想 | ❌ 未实现 | `suggestions.ts` 纯函数（15 单测）+ 建议路由 + combobox hook/list + 顶栏与搜索页双接入 | **PASS**：E2E 4 条（键盘直达 / 点击直达 / 加载不自动展开 / 拼音别名直达） |
| 证据缺口 | ❌ 缺 3 文件 | 新增 `query-count.md` / `pinyin-audit.md` / `a11y.md`（`metadata.txt` 初验已补） | **PASS** |

### 输入联想实现要点

- 跨层级匹配（名称/别名/全拼/首字母精确 + 名称/全拼前缀），tier → kind → 名称长度排序；中文单字允许前缀、拉丁单字不前缀；**当前城市不进联想**。
- 焦点门控：仅输入框聚焦过才发请求——修复了初验未发现的「带 q 落地时联想自动展开」（375 下顶栏与页面表单两个 listbox 同现）。
- 键盘：↑/↓/Esc/Enter 统一处理；Esc 两段式（先收联想再收顶栏搜索层）；无 JS 时原生 GET 表单兜底保留。
- 建议路由只读按城市缓存的词表（**0 条 SQL**），`no-store`，未知城市返回空列表而非 404。

## 门禁复跑（整改后）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error / 37 warning（既有） |
| 搜索单测 | 73 passed（58 + 联想 15） |
| `pnpm test`（全量） | 6627 passed / 2 failed |
| `pnpm test:e2e tests/e2e/search.spec.ts` | **10 passed**（dev 与 `next start` 生产模式各一遍） |
| `pnpm build` | 通过；产物含 `/[city]/search`、`/search`、`/[city]/search/suggestions` |

### 关于全量测试的 2 个失败

| 失败 | 判定 |
|---|---|
| `staging-cloudrun-package`（5s 超时） | **既有环境问题**：Batch 0 基线（干净 master）同样失败；本机 tmpdir 在 C 盘、仓库在 E 盘 |
| `supply-sync-chunk`（5s 超时） | **并发抖动，与 OPT-122 无关（已用主树对照证明）**：单跑 9/9 通过（3.1s）；在**不含任何 OPT-122 代码的主树**（docs 分支 = master 代码）上跑全量，同样失败这两个测试（6554 passed / 2 failed，失败项完全一致）。根因是套件并发负载下该测试自设的 5s 超时被击穿 |

## 初验 12 项清单（复验后全部通过）

1. ✅ `/[city]/search?q=虹桥` 三区块、tab 计数与实际一致（全部 2 = 1+1+0，资讯 0 不渲染）
2. ✅ 切 tab 重置页码、改 q 回 all、all 忽略 page（URL 语义 + E2E）；分页器运行时已验证
3. ✅ 零在租楼盘给实体出口（all 页楼盘区块 + 房源 tab 分类型零结果），不落全局零结果
4. ✅ `lujiazui` / `shzx` / `IFC` 端到端解析（seed 补齐后）
5. ✅ 「静安 游泳池」AND=0 → drop-last 放宽 + 「已忽略『游泳池』」标注
6. ✅ 全局零结果页 = 3 个兜底块 + 留资 CTA
7. ✅ `/search` 与 `/listings?q=` 均 `noindex, follow`；`/search` 307 保留 q/tab/page
8. ✅ `site_search` 含三类计数 / 零结果 / 放宽标记，不含 q 原文
9. ✅ 1440/375 截图（含联想展开态）；键盘完成搜索 / 联想 / 切 tab；结果数 `aria-live`
10. ✅ typecheck / lint / test / build 通过（2 个失败为既有 / 抖动，见上）
11. ✅ 证据齐全：baseline / implementation / acceptance / metadata / query-count / pinyin-audit / a11y / 8 张截图
12. ✅ Phase 1+2+3 范围完整（did-you-mean 相似度为 spec 已声明的已知偏差，L3 需 pg_trgm 权限）

## 剩余偏差（不阻塞合并）

1. **顶栏占位文案未更新**：仍写「搜索商圈、楼盘或地址」，房源 `q` 匹配字段不含地址（spec 方案 A 遗留）。
2. **搜索页 canonical 指向站点根**：未显式设置，输出来自根布局默认值；noindex 下无搜索语义影响。
3. **dev 模式 `unstable_cache` 跨重启持久 + 裸 SQL 不触发失效**：验收时换关键词才测到新鲜结果。环境特性而非代码问题，调试时需知。
4. **资讯链路无种子数据**：articles 为空，资讯 tab 仅单测覆盖；需要时可跑 `seed-articles.ts`。
5. **`all` 房源区块仍水合 24 张卡展示 8 张**（`Pagination.pageSize` 字面量）；did-you-mean 无相似度；兜底块点击埋点未接——均为实施记录已登记的后续项。

## 复测命令留痕

```text
pnpm typecheck / pnpm lint                       # 0 error；0 error / 37 warning
pnpm vitest run tests/search-*.test.ts           # 73 passed
pnpm test                                        # 6627 passed / 2 failed（既有 + 抖动）
pnpm exec next dev -p 3721                       # 运行时实测
PORT=3721 pnpm test:e2e tests/e2e/search.spec.ts # 10 passed
pnpm build                                       # 通过
```

---

## 附：初验记录（2026-10-20 上午，已被上文复验取代）

初验结论「有条件通过」：A1/A6/A7/A8/A9/A10 PASS；A2/A3/A4/A5 PARTIAL（分页无运行时数据、
房源 tab 无楼盘出口、别名楼盘不在种子库、放宽标注未点名）；Phase 3 输入联想未实现；
query-count / a11y / pinyin-audit 三个证据文件缺失。上述问题当日全部整改完毕。
