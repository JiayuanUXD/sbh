# Task Packet：MP-109 小程序真实闭环与交互抽屉修复

> 状态：代码完成，环境验收待完成
> 更新日期：2026-09-05
> 分支：`feat/miniprogram-mvp-59f9`
> 设计规格：`docs/superpowers/specs/2026-09-04-mp-109-miniprogram-closure-and-sheet-design.md`
> 实施计划：`docs/superpowers/plans/2026-09-04-mp-109-miniprogram-closure-and-sheet.md`
> 发布边界：未部署、未上传、未提审、未触碰生产环境

## 1. 收口目标

MP-109 负责把 MP-106/107 已有页面从“能展示”收口为可审计的真实业务闭环，并直接修复用户交互后才出现的筛选、委托找房和咨询抽屉。它不占用 MP-108；MP-108 继续专门负责上线加固与正式发布。

## 2. 已完成范围

- 验收 runner 对缺 selector、空必需交互、任意嵌套 `passed:false` 和源码指纹变化 fail-closed。
- 楼盘与首页 DTO 使用真实字段；未知库存、面积、地铁或事实不伪造为 `0` 或宣传文案。
- 收藏、咨询记录与“我的”改为服务端用户资产；客户端本地状态不再作为成功来源。
- 咨询支持 listing、building、general 三类严格联合目标，并保存可信用户归属。
- 搜索使用 `q`；价格排序只在存在计价单位时启用；首页使用真实 `featuredBuildings`。
- 移除硬编码楼盘、库存、价格、售卖专区、地图占位和无数据支撑的认证、时效、顾问承诺。
- 筛选与咨询抽屉由真实用户点击打开，使用统一灰底白卡、内部滚动、固定 footer、安全区和 44pt 命中区。
- 首页、找房、楼盘三个原生 tab 页在抽屉打开时隐藏 TabBar；连续点击、切页、快速关闭重开与原生 hide/show 失败均由可重试状态机处理。
- 375 与 430 两档 DevTools 视觉证据覆盖价格筛选、全部筛选、首页/楼盘咨询、微信授权、手工输入、错误、提交中和成功态。

## 3. 本地抽屉验收命令

在 `sbh-miniprogram/` 目录执行，两档必须分别运行，不能省略视口参数：

```sh
MP109_VIEWPORT_PROFILE=small \
WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'

MP109_VIEWPORT_PROFILE=large \
WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'
```

runner 启动时会立即使当前档旧报告失效、清空该档旧截图，并对源码计算指纹；任一档缺失、指纹不同或状态失败时，聚合报告保持 `incomplete` 且退出非零。

## 4. 当前证据结论

- 环境：`local-wechat-devtools-develop-with-controlled-mock`。
- 小屏 375 与大屏 430 使用同一源码指纹 `b8aa5f48bb13cabe`。
- 每档 10 个状态中 9 个通过；唯一未通过的是 `inquiryKeyboard`。
- 桌面微信开发者工具点击输入框后没有出现可审计软键盘，焦点字段和视口收缩均不足以证明键盘避让，因此两档 profile 为 `failed`，聚合为 `incomplete`。
- 该证据验证真实页面点击、原生 TabBar 边界、抽屉结构与几何；咨询的错误/提交/成功展示由受控视觉夹具驱动，未执行真实业务写入。
- 本地 develop + Mock 不等同于 trial、真实 staging revision、隐私后台、iOS/Android 真机或生产验收。

证据索引：`artifacts/verification/MP-109/README.md`。

## 5. 环境验收待完成

- [ ] iOS 与 Android 真机分别验证软键盘、焦点、输入法切换、安全区和滚动避让。
- [ ] trial 环境通过 `wx.cloud.callContainer` 验证首页、列表、详情、收藏、咨询和“我的”的真实网络与目标 revision。
- [ ] 核对真实图片/COS 来源、正常图、坏图和加载失败。
- [ ] 验证微信隐私配置、手机号授权拒绝与手工输入。
- [ ] 在受控 staging 执行用户资产显式迁移及真实写入、幂等、跨会话和精确清理。
- [ ] 完成 MP-105 尚未闭环的异常矩阵与回滚证据。

## 6. 与 MP-108 的边界

MP-109 只交付代码、合同测试、开发者工具本地视觉证据和环境验收清单。监控、风控、埋点、上传、提审、灰度、回滚演练与正式发布仍属于 MP-108，当前状态保持“待执行”。
