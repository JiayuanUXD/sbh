# MP-107 旧验收证据退役说明

> 状态：legacy / non-authoritative / incomplete

MP-107 的旧报告和截图仅来自微信开发者工具 `develop` 与受控 Mock。旧 runner 读取已删除的 `profileData.summary` 合同，Mock 也不覆盖当前服务端 session、favorites 与 `/me` 用户资产链路；旧报告的 `interactions` 为空，并缺少 `requiredInteractions`、明确环境、limitations 和源码证据指纹。因此它既不是当前代码的可重跑证据，也不能证明真实持久化或真实供给。

为避免旧“全绿”结果继续被误用：

- 旧 `acceptance-report.json` 和 7 张截图已经删除；
- `scripts/mp107-acceptance-runner.mjs` 已退役，启动会先删除同名旧报告并以非零状态退出；
- 当前没有 MP-107 的权威环境证据。MP-109 只能作为当前本地可视交互基线，不能替代 trial、真机、网络 revision、真实 session 或服务端资产持久化验收。

若未来重建验收，必须匹配当前服务端用户资产合同，声明 develop/trial 与 controlled Mock/真实环境边界，记录源码和 fixture 指纹、limitations、非空 `requiredInteractions`，并让任何缺失或失败状态 fail-closed。
