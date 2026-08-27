# MP-105 验收证据索引

> 状态：未通过；当前仅有本地安全收口与环境诊断证据
> 更新日期：2026-08-27

## 证据身份

- 分支：`feat/miniprogram-mvp-59f9`
- 目标代码 commit：`f490b19`（`feat: 接入小程序验收许可写入口`，包含此前短时许可与安全闸门）
- 验证时工作树：交付文件已提交；仅保留用户未跟踪的 `docs/SBH小程序页面设计/`，不属于交付物
- staging API host：未提供
- staging deployment revision：未提供
- staging 数据库指纹：未提供
- acceptance run ID：未创建

## 已执行

### Node 自动化

- 运行时：Node 22.23.2
- Task 1/2 定向测试（trial manifest + 本地预检）：70/70 通过
- 小程序全量：28 个测试文件、471 项通过
- 小程序双 TypeScript：通过
- 小程序 `project:check`：通过
- Web Task 3a 定向合同测试（runtime config + attestation route）：15/15 通过；Web typecheck 与相关 lint 通过。
- Web Task 3b-1 permit 定向合同测试（签发/验证 + route）：52/52 通过；与 Task 3a 合计 68/68。Sol 首轮发现多段 token 解析与跨 run 假阳性后退回，修复并补回归，第二轮 APPROVE，无遗留 P1/P2。
- Web Task 3b-2 定向合同测试（permit intrinsic verifier + run 隔离幂等键 + Mini inquiry route）：105/105 通过。Sol 首轮发现 acceptance 与普通/跨 run 共用幂等键会错归属，修复为独立 run-domain-separated key 后复验 APPROVE，无遗留 P1/P2。
- Web 全量：304 个测试文件中 299 通过、5 个既有跳过；4180 项中 4155 通过、25 项既有跳过。
- Web lint：0 错误、23 条既有 warning；production build：退出成功。构建期记录既有 COS fail-closed 日志并按现有城市静态参数降级完成，不视为 staging attestation 证据。
- 结论范围：只证明 trial 缺少独立配置时 fail-closed、部署 manifest 生成边界、本地预检结构/脱敏合同，以及在 mock Payload/数据库探针下的服务端 attestation、10 分钟 permit 与 Mini inquiry acceptance 分支合同。普通无 header 请求保持原路径；acceptance 使用 run 隔离幂等域并返回 Lead `leadLocator`，但 locator 不是本轮 ownership 证明。自动 runner、精确 ownership manifest 与清理尚未实现，本地预检仍明确返回 `writeAuthorized=false`，因此不证明真实预发布部署、真实数据库隔离、真实写授权或微信运行时可用。

### 微信开发者工具诊断

- 版本：Stable 1.06.2409140
- 基础库：3.17.2
- 工具服务端口：当前已开启，端口 31431
- 项目结果：能编译并打开首页；自动化连接成功后，develop API `http://127.0.0.1:3717` 被 request 合法域名校验拒绝，未到达 `#home-ready`。
- 结论范围：这是阻断证据，不是冒烟通过。没有关闭合法域名校验，没有预览、上传、部署或咨询写入。

## 未执行与阻断

| 验收项 | 状态 | 阻断条件 |
|---|---|---|
| trial 独立 HTTPS API | 未执行 | 未提供 staging origin 与部署 revision |
| 服务端 attestation | 真实环境未执行 | 本地 mock 合同已实现并通过；独立部署、真实 revision 与数据库指纹尚未交付 |
| 隔离数据库咨询写入 | 未执行 | permit 已接入服务端咨询合同，但无自动 runner、受控真实数据库指纹、fixture ownership manifest 与精确清理证据 |
| iOS 真机 | 未执行 | 无可验收 trial 包与安全写环境 |
| Android 真机 | 未执行 | 无可验收 trial 包与安全写环境 |
| 微信后台合法域名/隐私 | 未执行 | 需要管理员在明确目标上配置并留回滚证据 |
| 预览/上传/部署 | 未执行 | 不在当前授权范围 |

## 安全说明

- 本证据不保存 AppSecret、上传私钥、token、手机号、openid、数据库连接串或完整业务对象 ID。
- 本地关闭合法域名校验即使未来获批，也只能算 develop 调试，不能替代微信后台合法域名验收。
- MP-105 全部门通过前，MP-106/107 不进入实现、集成或合并。
