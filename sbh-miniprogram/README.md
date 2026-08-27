# SBH 微信小程序工程

这是 SBH 商办租赁项目的原生微信小程序工程，与 Web 应用共用仓库，但拥有独立的依赖、锁文件和微信项目配置。MP-103 已把首页、搜索与房源列表接成首个匿名用户浏览闭环；MP-104 继续接入真实房源详情、月度成本展示、微信或手工手机号咨询，以及服务端幂等写入。预发布与微信环境验收状态见本文末尾的证据链接。

## 业务入口与范围

- `pages/home/index` 是应用首路由，`pages/listings/index` 是找房列表，`pages/listing-detail/index` 是房源详情与咨询入口。原 `pages/foundation/index` 仅作为工程基础诊断页保留，不在 tabBar 中。
- 当前 tabBar 只有“首页”和“找房”两项。楼盘和“我的”分别属于 MP-106、MP-107 后续范围，本阶段不创建无功能空页。
- 当前不实现收藏、地图、咨询记录或顾问排期；这些能力按后续工作项独立建设，不在详情页放置无功能按钮。

## Codex 与微信开发者工具的职责

- Codex 负责修改代码、运行 Node 侧类型检查与测试、执行纯本地工程检查，并准备可显式调用的自动化脚本。
- 微信开发者工具负责编译微信运行时代码、模拟器和网络面板、账号与合法域名校验、预览码以及真机调试。Node 测试通过不能替代微信开发者工具或真机验收。
- `miniprogram-ci` 会联系微信服务生成预览，仅在操作者明确执行 `pnpm ci:preview` 时运行；它不会挂在安装、测试或普通 CI 流程中。

## 本地准备

1. 安装稳定版 Node.js `>=22.12 <23`（版本字符串必须是 `x.y.z`）与 pnpm `8.6.1`。
2. 在本目录执行 `pnpm install --frozen-lockfile`。
3. 执行 `pnpm project:check`、`pnpm typecheck`、`pnpm test`。
4. 在微信开发者工具中打开 `sbh-miniprogram/`，不要打开 `miniprogram/` 子目录；工具会按 `project.config.json` 找到实际源码目录。

仓库中的 `project.config.json` 固定使用 `touristappid`，便于无账号的静态检查。正式 AppID 只应放入被忽略的 `project.private.config.json` 或本机环境，不得提交。

## 开发者工具自动化冒烟

设置微信开发者工具 CLI 的绝对路径后执行：

```sh
export WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
pnpm devtools:smoke
```

CLI 文件必须具有执行权限。脚本会先校验 CLI，再加载自动化依赖；它以可信工程模式打开当前工程，先进入首页并等待 `#home-ready`，再进入找房页并从首条页面层 `[data-listing-slug]` 标记读取真实 slug，最后进入对应详情页并等待 `#listing-detail-ready`。启动、三次路由、三个 ready、房源标记轮询、查询参数、每页验收窗口与关闭都有超时或严格校验，任一阶段的运行时异常都使结果失败。成功或失败都会尝试关闭连接，关闭失败时再安全断开；即使启动已超时，迟到建立的连接也会尝试被回收。它不预览、上传或部署代码。

如果 IDE 服务端口关闭、本机尚未登录，或其他微信环境条件不满足，应将模拟器自动化记录为“未执行 + 具体原因”。Node 测试不能替代开发者工具或真机验收。MP-103 与 MP-104 当前证据分别在 `artifacts/verification/MP-103/README.md`、`artifacts/verification/MP-104/README.md`。

## 显式生成预览

仅在已获准生成微信预览、且本机具有 CI 私钥时设置以下变量：

| 变量 | 要求 |
|---|---|
| `WECHAT_MINIPROGRAM_APPID` | `wx` 加 16 位小写十六进制字符的正式 AppID |
| `WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH` | 仓外普通文件的绝对路径；不接受符号链接，权限必须为 `0400` 或 `0600` |
| `WECHAT_MINIPROGRAM_ROBOT` | `1` 到 `30` 的整数 |
| `WECHAT_MINIPROGRAM_VERSION` | 严格 SemVer，例如 `0.1.0` 或 `1.2.3-rc.1+build.5` |
| `WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH` | 仓外 `.jpg/.jpeg` 新文件的绝对路径；父目录须已存在、非符号链接、可写且不得允许 group/other 写入；不覆盖现有文件或符号链接 |

`miniprogram-ci@2.1.31` 的 preview 内部版本固定为 `0.0.1`；脚本只把 `WECHAT_MINIPROGRAM_VERSION` 写入预览描述，若要作为文件标签，应由操作者把版本写进显式二维码文件名。它不会改变内部版本，也不是正式上传版本号。

确认后手工执行 `pnpm ci:preview`。脚本先完成配置校验，再加载微信 CI；私钥以禁止跟随符号链接的只读文件描述符打开，复核文件身份后只把私钥内容交给 CI，不传私钥路径。

微信 CI 不会接触操作者填写的最终二维码路径：它只写入系统临时目录中随机创建、权限为 `0700` 的私有目录。脚本随后通过禁止跟随符号链接的只读文件描述符校验暂存图必须为非空、最多 5 MiB 的普通文件，再以 `O_EXCL` 和 `0600` 权限原子创建最终文件并复制内容。因此 CI 运行期间最终路径保持不存在，竞态占用不会被覆盖。失败时只删除本次创建且身份未变化的最终文件；无论成功失败都会清理本次私有暂存目录。成功文件查看完成后由操作者自行删除。

脚本不会打印私钥内容或私钥路径，也不会被 `prepare`、`test` 或普通 CI 隐式调用。本工程没有自动“正式上传”命令。

## 持续集成质量门

`.github/workflows/miniprogram-quality.yml` 仅在 `sbh-miniprogram/**` 或工作流自身变化时运行。它使用 Node 22 与 pnpm 8.6.1，只执行冻结锁文件安装、测试、类型检查和纯本地工程检查；不读取微信密钥，也不预览、上传或部署。

## API 域名与真机边界

- 开发版允许 `http://127.0.0.1` 或 `http://localhost`，用于桌面模拟器联调。
- trial/release 只接受公开 HTTPS 根域名；正式联调还需在微信公众平台配置 Mini API 的 request 合法域名。
- 房源封面使用 API DTO 返回的真实 HTTPS URL。图片 URL 的 origin 必须按实际返回值单独核对并配置为 downloadFile 合法域名；request 合法域名不代表图片域名已通过。
- 手机无法把电脑自身的 `127.0.0.1` 当作开发服务。真机需要可访问的 HTTPS 环境、合法域名、真实 AppID、微信账号权限和相应隐私配置。
- Node 自动化、开发者工具模拟器、真机、request 合法域名和图片域名是五类独立证据，必须分别记录。

## 敏感文件规则

`.gitignore` 已覆盖 `project.private.config.json`、`*.key`、`*.pem` 和 `*.p12`。AppSecret、CI 私钥、数据库配置、预览二维码和上传产物都不得进入仓库；提交前仍需核对 `git status`。

当前 MP-103 完成的是业务代码与 Node 侧可重复验证入口。微信开发者工具模拟器、真机、request 合法域名与图片域名的真实结果由具备对应环境和账号权限的验收步骤分别补录。
