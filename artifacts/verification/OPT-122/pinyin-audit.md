# OPT-122 拼音多音字审计

- 日期：2026-10-20
- 方法：对 `sbh_dev_opt122` 的公开词表（16 条：楼盘 8 / 商圈 / 行政区 / 地铁 / 城市）逐条检查名称中的地名高频多音字，列出 `pinyin-pro` 为词表选用的默认读音，供人工校对。
- 多音字表（人工维护，非穷举）：长 行 重 乐 会 朝 干 系 只 厦 六 番 燕 蚌 泌 坻

| kind | 名称 | 全拼（词表） | 首字母 | 多音字→库默认读音 | 人工校对 |
|---|---|---|---|---|---|
| district | 长宁 | changning | cn | 长→chang | ✅ 正确（长宁 chángníng） |
| building | 外滩源大厦 | waitanyuandasha | wtyds | 厦→sha | ✅ 正确（大厦 dàshà） |
| building | 徐家汇国际大厦 | xujiahuiguojidasha | xjhgjds | 厦→sha | ✅ 正确（大厦 dàshà） |

**结论：3/16 条含多音字，默认读音全部正确，本期无需人工订正。**

## 边界说明

- 本审计只覆盖 seed 数据规模（16 条）。全量数据上线前应重跑同一脚本；脚本逻辑 = `buildSearchVocabularyQuery` + 名称含多音字过滤 + `pinyin()` 单字默认读音。
- 已知高风险字（真实地名中易错）：重庆(zhòng→chóng 例外)、银行(háng→yín)、厦门(xià→shà 例外)、六安(lù→liù)。当前词表均未出现；`aliases.ts` 若未来收录此类实体，必须同步人工别名，不能只依赖库默认读音。
- 词表构建在缓存层完成（`vocabulary-build.ts`），多音字订正入口是 `src/domain/search/aliases.ts` 的手工别名，不需要改生成逻辑。
