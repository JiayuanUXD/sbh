# OPT-037 Task 11c：证明「只改预取行为，不改渲染输出」这条硬约束**成立**（实测，不是断言）。
#
# 做法：同一台机、同一套 env、同一个端口 3805，分别用「改前」与「改后」的
# `next build` 起 `next start`，对同一批 URL 各 curl 一份 HTML，然后：
#   - 剥掉 <script>（Next 的 RSC flight payload 与 chunk 引用都在里面，且带 build hash）
#   - 剥掉 <link>（同样带 build hash）
#   - 归一 `data-supply-as-of="..."`（服务端渲染时刻戳，每次请求都不同）
# 剩下的就是**真正渲染进 DOM 的标记**，逐字节比对。
#
# 两个必须注意的取样陷阱（我第一次就踩了，记下来免得下一个人以为是回归）：
#   1. 楼盘详情页的「周边配套 POI 面板」依赖高德 web service。**冷启动后的第一次请求
#      常常拿不到 POI**，于是整块面板不渲染，HTML 少 6KB。必须先预热再取样，否则会
#      比出一个与本次改动无关的巨大 diff。
#   2. `data-supply-as-of` 是 asOf 快照时刻，两次取样必然不同，须归一。
#
# 用法：python task11c-domdiff.py <before 目录> <after 目录>
import re
import sys
import pathlib
import difflib
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

PAGES = [
    "listings.html",
    "listings-row.html",
    "buildings.html",
    "listing-detail.html",
    "building-detail.html",
]


def dom_only(path: pathlib.Path) -> str:
    s = path.read_text(encoding="utf-8", errors="replace")
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<script[^>]*/?>", "", s)
    s = re.sub(r"<link[^>]*>", "", s)
    s = re.sub(r'data-supply-as-of="[^"]*"', 'data-supply-as-of="<ts>"', s)
    return s


before_dir = pathlib.Path(sys.argv[1])
after_dir = pathlib.Path(sys.argv[2])
exit_code = 0

for name in PAGES:
    a = dom_only(before_dir / name)
    b = dom_only(after_dir / name)
    if a == b:
        print(f"{name:24s} DOM 完全一致  len={len(a)}")
        continue
    exit_code = 1
    print(f"{name:24s} DOM 有差异  before={len(a)} after={len(b)}")
    diff = difflib.unified_diff(
        a.replace("><", ">\n<").splitlines(),
        b.replace("><", ">\n<").splitlines(),
        lineterm="",
        n=1,
    )
    for line in list(diff)[:40]:
        print(line[:200])

sys.exit(exit_code)
