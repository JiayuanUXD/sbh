# OPT-037 Task 11e：证明「只改预取行为，不改渲染输出」这条硬约束**成立**（实测，不是断言）。
#
# 做法（沿用 11d）：同机、同 env、同端口 3805，分别用「改前」「改后」的 next build
# 起 next start，对同一批 URL 各 curl 一份 HTML，然后：
#   - 剥掉 <script>（Next 的 RSC flight payload 与 chunk 引用都在里面，且带 build hash；
#     本轮的改动**只落在这里**，所以必须剥掉才能看「渲染进 DOM 的标记」有没有变）
#   - 剥掉 <link>（同样带 build hash）
#   - 归一 data-supply-as-of="..."（服务端渲染时刻戳，每次请求都不同）
#
# `--mask-poi` 额外把楼盘/房源详情页的「周边配套 POI 面板」整块换成占位再比：
# 该面板依赖高德 web service，冷启动/限流时整块拿不到数据，会比出一个与本次改动
# 完全无关的巨大 diff。11d 已踩过一次，本轮直接把遮罩做成常规手段，不再赌预热次数。
#
# 用法：python task11e-domdiff.py <before 目录> <after 目录> [--mask-poi]
import re
import sys
import pathlib
import difflib
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

PAGES = [
    "news-detail-related.html",
    "news-detail-plain.html",
    "news.html",
    "building-detail.html",
    "listing-detail.html",
]

MASK_POI = "--mask-poi" in sys.argv[3:]


def dom_only(path: pathlib.Path) -> str:
    s = path.read_text(encoding="utf-8", errors="replace")
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<script[^>]*/?>", "", s)
    s = re.sub(r"<link[^>]*>", "", s)
    s = re.sub(r'data-supply-as-of="[^"]*"', 'data-supply-as-of="<ts>"', s)
    if MASK_POI:
        s = re.sub(
            r'<div class="location-panel__poi-panel".*?</section>',
            "<POI-PANEL-MASKED/>",
            s,
            flags=re.S,
        )
    return s


before_dir = pathlib.Path(sys.argv[1])
after_dir = pathlib.Path(sys.argv[2])
exit_code = 0
tag = "（已遮罩 POI 面板）" if MASK_POI else ""

for name in PAGES:
    a = dom_only(before_dir / name)
    b = dom_only(after_dir / name)
    if a == b:
        print(f"{name:28s} DOM 完全一致{tag}  len={len(a)}")
        continue
    exit_code = 1
    print(f"{name:28s} DOM 有差异{tag}  before={len(a)} after={len(b)}")
    diff = difflib.unified_diff(
        a.replace("><", ">\n<").splitlines(),
        b.replace("><", ">\n<").splitlines(),
        lineterm="",
        n=1,
    )
    for line in list(diff)[:40]:
        print(line[:200])

sys.exit(exit_code)
