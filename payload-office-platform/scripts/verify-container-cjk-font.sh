#!/usr/bin/env bash
#
# OPT-069 生产容器中文字体验收
#
# 存在的理由：水印靠 sharp/librsvg 把中文画进 SVG 再栅格化，容器缺中文字体时
# librsvg 渲染成方框或空白且**不报错**——typecheck / 单测 / build / CI 全绿、
# 容器正常启动、页面照常 200，唯一能看出问题的是图片本身。这个脚本把
# 「镜像里到底有没有中文字体」和「烘出来的图到底长什么样」变成可执行的判据。
#
# 用法（需要 Docker；在 payload-office-platform/ 下跑）：
#   bash scripts/verify-container-cjk-font.sh
#
# 产出：artifacts/verification/OPT-069/container-bake/ 下的水印图 + fc-list 输出。
# 判据：fc-list 非空，且烘出来的图里中文清晰可读（不是方框 / 不是空白）。
#
set -eo pipefail

IMAGE="${IMAGE:-sbh-watermark-check}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HERE/../artifacts/verification/OPT-069/container-bake"

command -v docker >/dev/null 2>&1 || {
  echo "没有 docker，这个脚本跑不了。字体状况的无 Docker 取证方式见" >&2
  echo "artifacts/verification/OPT-069/container-cjk-font-verification.md" >&2
  exit 1
}

mkdir -p "$OUT"

echo "==> 1/3 构建镜像 $IMAGE"
docker build -t "$IMAGE" "$HERE"

echo
echo "==> 2/3 容器内 fc-list :lang=zh"
# fc-list 由 fontconfig 包提供。装 fonts-wqy-zenhei 时它随 Depends 一起进来；
# 若换成 fonts-noto-cjk（无任何 Depends），得显式加装 fontconfig 才有这个命令。
if docker run --rm "$IMAGE" sh -c 'command -v fc-list >/dev/null 2>&1'; then
  docker run --rm "$IMAGE" fc-list :lang=zh | tee "$OUT/fc-list-zh.txt"
  if [ ! -s "$OUT/fc-list-zh.txt" ]; then
    echo "!! fc-list 返回空：镜像里没有中文字体，水印会渲染成方框。" >&2
    exit 1
  fi
else
  echo "!! 容器里没有 fc-list（fontconfig 未安装）。" >&2
  echo "   这不一定等于没字体——sharp 自带静态链接的 fontconfig 库，" >&2
  echo "   但没有 /etc/fonts 时它会退到无别名的 fallback。改用下一步的烘图判据。" >&2
fi

echo
echo "==> 3/3 容器内用真实的 buildTiledOverlay 烘一张图"
cat > "$OUT/.bake.ts" <<'BAKE'
// 在容器里跑：用生产镜像自己的 sharp + 自己的字体，烘一张含中文的水印图。
import sharp from 'sharp'
import { buildTiledOverlay, DEFAULT_WATERMARK_CONFIG } from '/app/src/domain/media/watermark.ts'

const W = 1200
const H = 800
const overlay = buildTiledOverlay({
  width: W,
  height: H,
  config: { ...DEFAULT_WATERMARK_CONFIG.tiled, density: 4 },
})
const bg = await sharp({
  create: { width: W, height: H, channels: 3, background: { r: 96, g: 104, b: 112 } },
})
  .png()
  .toBuffer()
const out = await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer()
await sharp(out).toFile('/out/container-tiled-watermark.png')

// 客观判据：偏离底色的像素占比。全是方框或空白时这个数会塌到 1% 以下。
const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
let ink = 0
for (let i = 0; i < data.length; i += info.channels) {
  if (Math.abs(data[i] - 96) > 18 || Math.abs(data[i + 1] - 104) > 18 || Math.abs(data[i + 2] - 112) > 18) ink++
}
const pct = (ink / (info.width * info.height)) * 100
console.log(`ink=${pct.toFixed(3)}%`)
if (pct < 3) {
  console.error('!! 墨量过低：几乎可以肯定渲染成了方框或空白，字体没生效。')
  process.exit(1)
}
BAKE

docker run --rm \
  -v "$OUT:/out" \
  "$IMAGE" \
  sh -c 'cp /out/.bake.ts /tmp/bake.ts && pnpm exec tsx /tmp/bake.ts'

rm -f "$OUT/.bake.ts"

echo
echo "==> 完成。肉眼确认这张图里的中文清晰可读、不是方框："
echo "    $OUT/container-tiled-watermark.png"
