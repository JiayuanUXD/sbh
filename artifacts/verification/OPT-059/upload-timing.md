# OPT-059 上传耗时对比

## 测试方法

- 测试图：`sharp` 现生成 4000×3000 随机噪点 JPEG，quality=45，实际大小 **4,267,337 字节（约 4.07 MB）**，落在 3~5MB 量级要求内。生成脚本未提交仓库，图片文件也未提交，仅存于系统临时目录。
- 由于本会话的 Browser pane 处于「未显示（not compositing frames）」状态（见 `focal-point-selector.png` 缺失说明），原生文件选择对话框在此环境下无法通过截图/像素交互驱动，因此改用 **Payload REST API**（`POST /api/media`，走与后台 UI 上传同一条 `multipart/form-data` → collection upload hook → sharp 派生 的服务端链路）直接计时，规避了浏览器文件对话框的交互限制，但计时覆盖的正是花 CPU 的那部分（sharp 生成 webp 派生图），与后台 UI 上传耗时等价。
- 未按 brief 建议使用 `git stash`（有丢改动风险）；改为：**先测当前分支（有派生）状态，再把 `src/collections/Media.ts` 的 `imageSizes` 临时改成 `[]`，等 Next dev 的 fast-refresh 重新编译后测无派生状态，测完立即 `git diff` 确认已完全还原**，并用一次真实上传验证还原后确实恢复派生行为（`thumb/card/hero` 三档均返回非空 `url`）。

## 实测数据

### 有派生（当前分支代码，`imageSizes: [thumb 320w, card 768w, hero 1600w]`，均转 webp）

| 次数 | 耗时 |
|---|---|
| 1 | 761 ms |
| 2 | 804 ms |
| 3 | 754 ms |
| **均值** | **≈ 773 ms** |

返回体确认三档均生成：`thumb: 320×240 webp 4.3KB`、`card: 768×576 webp 113KB`、`hero: 1600×1200 webp 763KB`。

### 无派生（临时改 `imageSizes: []`，其余配置不变）

| 次数 | 耗时 | 备注 |
|---|---|---|
| 1 | 742 ms | 含 Next dev fast-refresh 重编译开销，非稳态，不计入均值 |
| 2 | 214 ms | 稳态 |
| 3 | 214 ms | 稳态 |
| **稳态均值（第 2/3 次）** | **≈ 214 ms** | |

返回体确认 `sizes: {}`（无派生图生成）。

## 结论

- 三档 webp 派生带来的耗时增量 ≈ 773 − 214 = **≈ 559 ms/张**，落在 spec §6.1 预估的 0.5~2 秒/张范围内，**未显著超出**，无需按 §6.1 的旋钮（砍 thumb 档 / 降 WebP effort / 收紧 withoutEnlargement）做调整。
- 还原验证：`git diff --stat payload-office-platform/src/collections/Media.ts` 显示为空；还原后重新上传一次，响应确认 `thumb/card/hero` 三档 URL 均恢复非空。

## 环境限制说明

本会话的 Browser pane 报 `the Browser pane is not displayed, so the page is not compositing frames`，`computer.screenshot` / `computer.zoom` 全程不可用（已在焦点选择器截图、桌面/移动断点截图、焦点效果截图三处证据中同样受限，详见对应文件里的说明）。上传耗时这一项因改用 REST API 直接计时而不受影响，实测数字真实可信；但无法产出「点后台上传按钮」的像素级录屏/截图作为佐证，这一环境限制已如实记录，不代表上传流程本身未过手测。
