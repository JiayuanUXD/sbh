# OPT-037 验证脚本共享「HTML DOM 逐字节比对」——`task11{c,d,e}-domdiff.py` 的公共实现。
#
# 为什么抽出来：三支 domdiff 原本是三份逐行相同的副本，**三份都缺同一个哨兵**
# （两侧都是 404/500 页会打印「DOM 完全一致」）。同一逻辑多处 = 补一处漏两处，
# 本批已经栽过 8 次。现在判据只有这一份，三支脚本只提供 PAGES 与遮罩开关。
#
# 归一化（剥掉与代码无关的部分）：
#   - `<script>`：Next 的 RSC flight payload 与 chunk 引用都在里面，且带 build hash。
#     **prefetch 一族的改动只落在这里**，所以必须剥掉才能看「渲染进 DOM 的标记」有没有变。
#   - `<link>`：同样带 build hash。
#   - `data-supply-as-of="..."`：服务端渲染时刻戳，逐请求不同。
#
# 哨兵（本轮新增，见 `sentinel.json`）：比对前先证明两侧都真的渲染了
#   —— 状态码在 okStatus 内（读同目录 `status.json`）+ 该路由族的关键标记全中。
#
# `mask_poi=True`（周边配套 POI 面板遮罩）**必须配对照**：面板走高德 Web 服务，
# 冷启动/限流时整块不渲染。遮罩是对的解药，但它同时会吞掉真发生在面板内部的回归。
# 所以遮罩模式下逐页打印两侧的「面板是否存在 / 一级 tab 数」，并分三种处置：
#   两侧都有 → 遮罩生效，只吃面板**内部**差异（这正是它该干的）；
#   两侧都没有（列表页一族）→ 遮罩是空操作，照常比；
#   一侧有一侧没有 → **判不通过**。冷抓与「面板被代码改没了」在遮罩下不可区分，
#                    这时候出「一致」的结论就是掩盖，必须重新预热重抓。
import difflib
import io
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import sentinel  # noqa: E402


def dom_only(path: pathlib.Path, mask_poi: bool = False) -> str:
    s = path.read_text(encoding="utf-8", errors="replace")
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<script[^>]*/?>", "", s)
    s = re.sub(r"<link[^>]*>", "", s)
    s = re.sub(r'data-supply-as-of="[^"]*"', 'data-supply-as-of="<ts>"', s)
    if mask_poi:
        s = re.sub(
            r'<div class="location-panel__poi-panel".*?</section>',
            "<POI-PANEL-MASKED/>",
            s,
            flags=re.S,
        )
    return s


def run(pages, argv, mask_poi=False, task=""):
    """
    pages: ["listings.html", ...]
    argv:  sys.argv（读 <before 目录> <after 目录> [--mask-poi] [--allow-missing-status]）
    返回退出码：0 全部一致；1 有差异或哨兵不通过；2 一致但状态码不可复核（历史产物）。
    """
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    before_dir = pathlib.Path(argv[1])
    after_dir = pathlib.Path(argv[2])
    flags = argv[3:]
    mask_poi = mask_poi or "--mask-poi" in flags
    allow_missing = "--allow-missing-status" in flags

    st_b = sentinel.load_status(before_dir)
    st_a = sentinel.load_status(after_dir)
    if (st_b is None or st_a is None) and not allow_missing:
        print(
            "!! 缺 status.json：抓取脚本没记 HTTP 状态码，本次比对不可能证明「页面真的渲染了」。\n"
            "   要么用 final-fix-3/capture-html.mjs 重抓，要么显式加 --allow-missing-status\n"
            "   （届时退出码恒为 2，关键标记仍然必须全中，结论按「状态码不可复核」记）。"
        )
        return 1

    tag = "（已遮罩 POI 面板）" if mask_poi else ""
    print(f"=== {task or 'domdiff'}  {before_dir.name} vs {after_dir.name}{tag} ===")
    exit_code = 0
    degraded = False
    for name in pages:
        stem = name[:-5] if name.endswith(".html") else name
        fb, fa = before_dir / name, after_dir / name
        if not fb.exists() or not fa.exists():
            print(f"{name:30s} 缺文件")
            exit_code = 1
            continue
        raw_b = fb.read_text(encoding="utf-8", errors="replace")
        raw_a = fa.read_text(encoding="utf-8", errors="replace")
        ok_b, why_b, abs_b = sentinel.check(before_dir, stem, raw_b, st_b, allow_missing)
        ok_a, why_a, abs_a = sentinel.check(after_dir, stem, raw_a, st_a, allow_missing)
        degraded = degraded or abs_b or abs_a
        if not (ok_b and ok_a):
            print(f"{name:30s} 哨兵未通过  before：{why_b}  after：{why_a}")
            exit_code = 1
            continue
        page_mask = mask_poi
        if mask_poi:
            pb, pa = sentinel.poi_panel_stats(raw_b), sentinel.poi_panel_stats(raw_a)
            if not pb["present"] and not pa["present"]:
                # 本页本来就没有 POI 面板（列表页一族）：遮罩是空操作，照常比，不当成问题。
                page_mask = False
                print(f"{'':30s} 本页无 POI 面板，遮罩为空操作")
            elif pb["present"] != pa["present"]:
                # 一侧有一侧没有：可能是高德冷抓，也可能是代码把整块面板弄没了。
                # **遮罩恰好会把这两种情况抹成同一个「一致」**，所以这里必须拒绝出结论。
                print(
                    f"{name:30s} 两侧 POI 面板存在性不一致 before={pb} after={pa}\n"
                    f"{'':30s} 冷抓与「面板被改没了」在遮罩下不可区分 —— 重新预热重抓，别用遮罩结论"
                )
                exit_code = 1
                continue
            else:
                print(f"{'':30s} POI 面板对照 before={pb} after={pa}（两侧都在，遮罩只吃面板内部差异）")
        b = dom_only(fb, page_mask)
        a = dom_only(fa, page_mask)
        page_tag = "（已遮罩 POI 面板）" if page_mask else ""
        if a == b:
            print(f"{name:30s} DOM 完全一致{page_tag}  len={len(a)}  (before: {why_b})")
            continue
        exit_code = 1
        lb = b.replace("><", ">\n<").splitlines()
        la = a.replace("><", ">\n<").splitlines()
        changed = [
            ln
            for ln in difflib.unified_diff(lb, la, lineterm="", n=0)
            if ln[:1] in "+-" and ln[:3] not in ("+++", "---")
        ]
        print(f"{name:30s} DOM 有差异{page_tag}  before={len(b)} after={len(a)}  diff 行数={len(changed)}")
        for ln in changed[:40]:
            print("    " + ln[:200])

    if exit_code == 0 and degraded:
        print("\n⚠️ 全部一致，但**状态码不可复核**（历史产物无 status.json）：退出码记 2，不是干净的 PASS。")
        return 2
    return exit_code
