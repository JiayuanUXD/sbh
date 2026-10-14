#!/usr/bin/env bash
# OPT-111 本地对照实验的夹具准备（只动本地库，幂等）。在起 server 之前跑。
#
# 种子里杭州是 coming-soon（城市页走「即将开城」视图，不读首页缓存，量不到），
# 也没有草稿房源。这里把杭州置为 live、把一条上海房源改成草稿。
# 用法：DATABASE_URL=postgres://... ./setup-fixtures.sh
set -euo pipefail
: "${DATABASE_URL:?需要 DATABASE_URL（本地库，绝不能是生产）}"
case "$DATABASE_URL" in *127.0.0.1*|*localhost*) ;; *) echo "拒绝：DATABASE_URL 不是本地库" >&2; exit 1 ;; esac

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
update city_site_profiles set service_status = 'live'
  where city_id = (select id from locations where slug = 'hangzhou' and type = 'city');
update listings set publication_status = 'draft'
  where id = (select max(l.id) from listings l
              join buildings b on b.id = l.building_id
              join locations c on c.id = b.city_id
              where c.slug = 'shanghai');
select 'hangzhou=' || p.service_status from city_site_profiles p join locations l on l.id = p.city_id where l.slug = 'hangzhou';
select 'draft_listing_id=' || max(id) from listings where publication_status = 'draft';
SQL
