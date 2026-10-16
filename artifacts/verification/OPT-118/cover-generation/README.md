# 封面图生成记录（OPT-118）

8 张封面由 Codex CLI 的内置图片生成工具（`image_generation` 功能，Codex 0.153.4）生成，统一风格见 `style.txt`，成品压缩为 1600×900 JPEG 放在 `payload-office-platform/content/articles/covers/`。

## 复现

```bash
cd <工作目录>
arch -arm64 codex exec -s workspace-write -C . --skip-git-repo-check \
  -c 'model="gpt-6-astra"' -c 'model_reasoning_effort="low"' \
  "Use your built-in image generation tool to create exactly ONE image and save it as a PNG at ./<slug>.png ... Subject: <主题> $(cat style.txt)"
```

## 踩过的坑

1. **本机 `~/.codex/config.toml` 默认模型 `gpt-6.1-sol` 不被当前账号支持**：`codex exec` 会返回 HTTP 400，而且前台没有任何输出、进程一直挂着，看起来像卡死。必须显式 `-c 'model="gpt-6-astra"'`。
2. **要用 `arch -arm64` 启动**：用 `timeout` 等 x86 工具包一层会让 node 以 x64 运行，找不到 `@openai/codex-darwin-x64`。
3. 提示词里写明「NO text / NO letters / NO numbers / NO logos / no faces」：图里的中文文字不可靠，也避免版权与肖像问题。

## 各篇主题

| slug | 画面 |
|---|---|
| shanghai-office-rent-by-district-2026-10 | 14 块等距街区瓦片，每块一座高低不同的蓝色写字楼，像租金热力图 |
| shanghai-business-area-rent-ranking-2026-10 | 一排由低到高的玻璃写字楼，像排行榜领奖台 |
| shanghai-small-office-under-100sqm-guide | 等距剖面的小办公室，三张办公桌和一盆绿植 |
| how-office-rent-is-calculated-shanghai | 写字楼楼层、蓝色计算器、尺寸标注线与硬币 |
| office-lease-contract-checklist-shanghai | 租赁合同、钢笔、印章、钥匙与对勾徽章 |
| how-much-office-space-do-you-need | 办公室平面布局：工位区、会议室、茶水间 |
| coworking-vs-traditional-office-cost | 左开放共享办公、右封闭独立办公室的对角分割对比 |
| office-budget-to-location-shanghai | 写字楼群前的预算滑块与地图定位标记 |

## 使用与版权

图片由 AI 生成，不含真实建筑复刻、文字、标志和人脸。上线前请确认你的使用条款允许商用，并在后台「素材库」里按需要调整用途标记（导入脚本已把用途设为「文章配图」，不会被当成房源实景打水印）。
