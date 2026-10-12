# 首页 Hero 兜底图更新

## 范围

线上 Hero 当前视频为 `/api/media/file/sbh-hero-10s.mp4?prefix=media`，但 img 和 video poster 均引用构建打包的旧 `src/assets/hero-poster.jpg`。仅将该图片替换为当前视频 0.5 秒的原始帧，1920x1080，保留视频内标识。不改播放闸门、城市自定义图片、数据库或 COS 原对象。

工作树 `E:/wt-pub`，分支 `codex/catalog-full-publish-71a4`；保留 PR #207 的既有容量修复，避免从旧 master 部署而覆盖已验收修复。当前生产版本不因本地图片替换而改变。

## 复现

`extract-poster.ps1 -Ffmpeg <本机 FFmpeg 路径>` 从实际线上视频抽取；原图片由 Git 保留，生产视频未修改。当前采用既有 imageio_ffmpeg 包内的 FFmpeg 7.1。

## 验证状态

- 已在真实浏览器确认当前视频和旧 poster 的不同来源，检查旧图和新截图像素。
- 图像 SHA256：`4056D6C37D04F1E8F4A2A4104E4F9B1AD15F635F728B3CAFBC12DF76A362EEBF`，重复抽取逐字节相同。新尺寸由 sharp 实际读取确认。
- 相关 8 项 Hero 测试、typecheck、438 文件 / 5,968 项全量测试与构建通过。四档视口 resize 后 reload，新 poster 实际加载且无横向溢出；375 不挂载视频，显示新截图。读数见 `local-browser.json`，截图以 `local-` 开头。
- 本地隔离库缺少原有 logo、楼盘和默认视频文件，这些请求返回 500；只核验构建静态 poster，不将本地控制台记为全站无错误。生产验收会检查实际新视频和控制台。未改 COS 或补造本地媒体。
- 本地脚本保持 ASCII，避免 Windows PowerShell 按系统代码页解释 UTF8 注释影响执行；最终抽帧脚本重跑通过。
- 用户已确认提交、推送和部署候选；PR 合并仍另行确认。新图尚未上线。
