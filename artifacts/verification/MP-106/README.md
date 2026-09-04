# MP-106 旧验收证据退役说明

> 状态：legacy / non-authoritative / incomplete

MP-106 的旧报告和截图来自微信开发者工具 `develop` 与受控 Mock，不是 trial、真实 staging 供给或真实持久化证据。旧报告自身记录 `interactions.sortToggle.passed=false`，却曾被 README 错写为“全绿/自动化闭环”；报告还缺少当前合同要求的 `requiredInteractions`、明确环境与源码证据指纹。

旧 runner 没有启动并探测 3717 fixture identity，不能证明请求命中了预期 Mock 或版本。为避免旧结果继续被误用：

- 旧 `acceptance-report.json` 和截图已经删除；
- `scripts/mp106-acceptance-runner.mjs` 已退役，启动会先删除同名旧报告并以非零状态退出；
- 当前页面交互以 MP-109 的本地可视验收为后续基线，但 MP-109 仍明确保留键盘交互缺口，不能替代真实 trial、真机、网络 revision 或持久化验收。

如需重新建立 MP-106 权威证据，必须使用当前源码与接口合同，声明运行环境和 `requiredInteractions`，记录源码指纹、fixture identity、limitations，并让任何缺失或失败状态 fail-closed。
