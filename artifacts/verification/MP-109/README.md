# MP-109 验收证据索引

> 状态：代码完成，环境验收待完成
> 更新日期：2026-09-05
> 环境：`local-wechat-devtools-develop-with-controlled-mock`
> 源码证据指纹：`cc0822e1138988b8`

## 证据文件

- `sheet-acceptance-small.json`：375 宽档的结构化报告。
- `sheet-acceptance-large.json`：430 宽档的结构化报告。
- `sheet-acceptance-report.json`：两档聚合报告。
- `sheet-screenshots/small/`：小屏 10 张权威截图。
- `sheet-screenshots/large/`：大屏 10 张权威截图。
- 生成器：`sbh-miniprogram/scripts/mp109-sheet-acceptance-runner.mjs`。

旧的根级、无视口身份截图已经删除；只有 `small/` 与 `large/` 是本轮权威截图目录。

## 结果摘要

| 状态 | small | large | 结论 |
|---|---:|---:|---|
| 价格筛选 | 通过 | 通过 | 真实点击，抽屉分区与内部几何通过 |
| 全部筛选 | 通过 | 通过 | 真实点击、内部滚动、固定 footer 通过 |
| 首页委托找房 | 通过 | 通过 | 真实点击，原生 TabBar 不穿透 |
| 楼盘页委托找房 | 通过 | 通过 | 真实点击，原生 TabBar 不穿透 |
| 微信手机号入口 | 通过 | 通过 | 控件结构与几何通过 |
| 手工手机号入口 | 通过 | 通过 | 分段控件与输入布局通过 |
| 软键盘避让 | 未通过 | 未通过 | 桌面 DevTools 未显示可审计软键盘，留待真机 |
| 错误态 | 通过 | 通过 | 错误文案可见且几何通过 |
| 提交中 | 通过 | 通过 | busy 态不可由遮罩关闭 |
| 成功态 | 通过 | 通过 | 成功状态结构与几何通过 |

两档均为 9/10，通过项一致且指纹相同。因为 `inquiryKeyboard` 没有可靠证据，两份 profile 明确为 `failed`，聚合报告明确为 `incomplete`；这不是全绿报告。

## 证据边界

- runner 在微信开发者工具 develop 模式运行，数据来自受控 Mock；不等同于 trial 或真实 staging API。
- 错误、提交中、成功仅验证真实页面打开后的视觉状态；未执行真实业务写入。
- 本证据不证明 `wx.cloud.callContainer` 命中目标 deployment revision。
- 本证据不证明图片/COS、微信隐私配置、iOS/Android 真机、服务端持久化、上传、提审或正式发布。
- 软键盘必须在 iOS 与 Android 真机分别验证焦点、输入法、安全区、滚动和 CTA 可达性。

## 重跑

在 `sbh-miniprogram/` 目录分别执行：

```sh
MP109_VIEWPORT_PROFILE=small WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'
MP109_VIEWPORT_PROFILE=large WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'
```

任一档失败会使命令退出非零，这是预期的 fail-closed 行为。当前桌面环境重跑会因软键盘无法审计而保持非零；不得通过手改 JSON 或跳过 `inquiryKeyboard` 制造通过。
