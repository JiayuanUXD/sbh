# MP-105 验收证据索引

> 状态：未通过；当前仅有本地安全收口与环境诊断证据
> 更新日期：2026-08-27

## 证据身份

- 分支：`feat/miniprogram-mvp-59f9`
- 目标代码 commit：`e3b44d4`（`feat: 增加小程序预发布安全闸门`）
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
- Web 全量：302 个测试文件中 297 通过、5 个既有跳过；4113 项中 4088 通过、25 项既有跳过。
- Web lint：0 错误、23 条既有 warning；production build：退出成功。构建期记录既有 COS fail-closed 日志并按现有城市静态参数降级完成，不视为 staging attestation 证据。
- 结论范围：只证明 trial 缺少独立配置时 fail-closed、部署 manifest 生成边界、本地预检结构/脱敏合同，以及在 mock Payload/数据库探针下的服务端 attestation 合同；本地预检明确返回 `writeAuthorized=false`，不证明真实预发布部署、真实数据库隔离、写授权或微信运行时可用。

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
| 隔离数据库咨询写入 | 未执行 | 无受控数据库指纹、写许可和 fixture ownership |
| iOS 真机 | 未执行 | 无可验收 trial 包与安全写环境 |
| Android 真机 | 未执行 | 无可验收 trial 包与安全写环境 |
| 微信后台合法域名/隐私 | 未执行 | 需要管理员在明确目标上配置并留回滚证据 |
| 预览/上传/部署 | 未执行 | 不在当前授权范围 |

## 安全说明

- 本证据不保存 AppSecret、上传私钥、token、手机号、openid、数据库连接串或完整业务对象 ID。
- 本地关闭合法域名校验即使未来获批，也只能算 develop 调试，不能替代微信后台合法域名验收。
- MP-105 全部门通过前，MP-106/107 不进入实现、集成或合并。
