# docs/superpowers 的留存规则

这里是 agent 生成实施计划与设计文档的落脚处。**它们是过程产物，一律不入库**——本目录已在仓库根 `.gitignore` 里排除（`docs/superpowers/*`，只放行本文件）。

## 规则不靠文档留存，靠提炼

计划/设计里若有**仍在生效**的规则，不要靠"保留文档"来留存，而要提炼到它该待的地方，然后删掉文档：

| 内容类型 | 该去哪 |
|---|---|
| 领域业务规则 | `payload-office-platform/.agent/<域>.md` |
| 数据命名 / 导入口径 | `docs/<主题>.md`（如 `docs/geography-code-convention.md`） |
| 生产数据变更的执行记录 | `DEPLOYMENT.md` |
| 某段代码"为什么这么写" | 该文件的头部注释，指向上面三处之一 |

理由很简单：过程文档没人会去读第二遍，而 `.agent/` 与 `CLAUDE.md` 每次任务都会被读到。规则放错地方 = 规则不存在。

## 2026-08-15 的清理

共移除 43 份零引用或已提炼的计划 / 设计 / 子代理任务报告。提炼去向：

- 七城地理导入口径（商圈配额、换乘站归属首开线路、在建线路不导入）→ `docs/geography-code-convention.md`「导入口径」
- 生产地理数据导入记录与 `legacyCodes` 别名陷阱 → `DEPLOYMENT.md`「生产地理数据导入记录」
- SupplySubmissions 字段分级、幂等键、导航口径 → `.agent/supply.md`「房源投放申请」

规则若与仓库根 `CLAUDE.md` 冲突，以 `CLAUDE.md` 为准。
