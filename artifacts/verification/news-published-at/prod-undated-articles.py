#!/usr/bin/env python3
"""只读核查线上哪些资讯缺发布时间（只发 GET，打公开页面与公开 REST，不碰库、不带任何凭据）。

用法：python3 prod-undated-articles.py [站点根，默认 https://shangban.cc]

输出：
  1. 公开 REST /api/articles 里每篇文章的 status / publishedAt / createdAt / updatedAt；
  2. 前台 /news 列表每张卡片有没有日期节点（SSR 的 DOM，剔除 flight 载荷里的 script）。
2026-11-11 首次跑出的结果见同目录 README.md。
"""
import json
import re
import sys
import urllib.parse
import urllib.request

base = (sys.argv[1] if len(sys.argv) > 1 else "https://shangban.cc").rstrip("/")


def get(path: str) -> str:
    req = urllib.request.Request(base + path, headers={"User-Agent": "news-date-check/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read().decode("utf-8", "ignore")


select = "".join(f"&select[{k}]=true" for k in ("slug", "status", "publishedAt", "createdAt", "updatedAt"))
rest = json.loads(get("/api/articles?limit=100&depth=0&sort=-createdAt" + urllib.parse.quote(select, safe="=&[]")))
docs = rest.get("docs", [])
print(f"== REST：共 {rest.get('totalDocs')} 篇")
for d in docs:
    flag = "缺日期" if (d.get("status") == "published" and not d.get("publishedAt")) else "     "
    print(f"{flag} id={d.get('id'):<4} {d.get('status'):<9} pub={d.get('publishedAt')} created={d.get('createdAt')} {d.get('slug')}")
undated = [d for d in docs if d.get("status") == "published" and not d.get("publishedAt")]
print(f"== 已发布且缺发布时间：{len(undated)} 篇；草稿 {sum(1 for d in docs if d.get('status') == 'draft')} 篇")

html = re.sub(r"<script[^>]*>.*?</script>", "", get("/news"), flags=re.S)
cards = re.findall(r'<article class="sf-card article-card">(.*?)</article>', html, flags=re.S)
print(f"== /news 第 1 页 {len(cards)} 张卡片")
for c in cards:
    title = re.search(r'article-card__title">([^<]*)<', c)
    date = re.search(r'article-card__date[^>]*>([^<]*)<', c)
    print(("有日期 " + date.group(1)) if date else "无日期    ", "|", (title.group(1) if title else "?")[:36])
