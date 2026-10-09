#!/usr/bin/env node
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {DIR,ROOT,WEB,SHA,identity,assertUpgradeState} from './task5-local.mjs'
const FINAL='20260907_050043_mp108_mini_user_assets'
const PG_FILES=['building-delete','city-partner-details','city-partner-notify','media-delete-cache','media-delete-listing-building','media-delete-type-card-override','supply-import-rollback','supply-import-task'].map(x=>`tests/${x}-postgres.test.ts`)
const TABLES='users roles media locations business_area_extensions city_site_profiles merchants teams brokers amenities buildings building_merchant_relations listings leads customers lead_ownership_history follow_ups pages articles display_tags listing_reviews listing_reports information_corrections supply_submissions city_partner_applications domain_events audit_logs tasks notifications supply_import_batches location_aliases search forms form_submissions exports imports payload_kv payload_jobs payload_locked_documents payload_preferences payload_migrations'.split(' ')
const integer=n=>assert(Number.isSafeInteger(n)&&n>=0,'需要非负整数')
const iso=s=>assert(typeof s==='string'&&new Date(s).toISOString()===s,'无效时间')
const sameSet=(a,b)=>{assert(Array.isArray(a)&&Array.isArray(b));assert.equal(new Set(a).size,a.length);assert.deepEqual([...a].sort(),[...b].sort())}
function one(output,pattern){assert.equal(typeof output,'string');const m=[...output.matchAll(pattern)];assert.equal(m.length,1,'缺少/重复原始输出摘要');return m[0]}
function commands(entries,expected){assert(Array.isArray(entries));assert(expected.length>0);assert.deepEqual(entries.map(x=>x.command),expected);for(const c of entries){assert.equal(c.exitCode,0);assert(typeof c.output==='string'&&c.output.trim());iso(c.startedAt);iso(c.finishedAt);assert(c.startedAt<=c.finishedAt)}}
function migrated(output){assert(output.includes('INFO: Done.'));const names=[...output.matchAll(/INFO: Migrated:\s+(\w+) \(\d+ms\)/g)].map(x=>x[1]);assert.equal(new Set(names).size,names.length);return names}
function applied(output){const m=one(output,/\[migrate:assert-applied\] OK：(\d+) 条已应用，(\d+) 条待应用/g);assert.equal(Number(m[1]),81);assert.equal(Number(m[2]),0);const names=[...output.matchAll(/\[✓ applied\] (\w+)/g)].map(x=>x[1]);assert.equal(names.length,81);assert.equal(new Set(names).size,81);assert.equal(names.at(-1),FINAL);return names}
function migrationVerify(output){const m=one(output,/Total: (\d+) checks \| (\d+) fail \| (\d+) warn/g);assert.equal(Number(m[1]),289);assert.equal(Number(m[2]),0);assert.equal(Number(m[3]),24);assert(!/\[FAIL\]/.test(output));assert(output.includes('mini-user-assets 表存在，行数 0'))}
function baseline(b){assert(b);assert.equal(b.tables.length,TABLES.length);sameSet(b.tables.map(x=>x.table),TABLES);for(const row of b.tables)integer(row.count);assert.equal(b.trueSameTablesTotal,b.tables.reduce((s,x)=>s+x.count,0));assert.equal(b.boundedSameTables,b.tables.reduce((s,x)=>s+Math.min(x.count,3),0));integer(b.legacySnapshotRecords);return Object.fromEntries(b.tables.map(x=>[x.table,x.count]))}
function noDecrease(before,after){const b=baseline(before),a=baseline(after);for(const key of TABLES)assert(a[key]>=b[key],`baseline减少:${key}`)}
function health(h){assert.equal(h.status,'ok');assert.equal(h.version,SHA);assert.deepEqual(h.checks,{payload:'ok',db:'ok'});iso(h.timestamp)}
export function parseSummary(output){
 assert.equal(typeof output,'string');const stats={};for(const [key,label]of Object.entries({passed:'passed',skipped:'skipped',failed:'failed',flaky:'flaky',didNotRun:'did not run'})){
 const m=[...output.matchAll(new RegExp(`(?:^|\\n)\\s+(\\d+) ${label}(?=\\s|$)`,'g'))];assert(m.length<=1,'重复结果摘要');if(key==='passed')assert.equal(m.length,1,'缺少passed摘要');stats[key]=Number(m[0]?.[1]??0)
 }return stats
}
export function assertPassingSummary(stats){sameSet(Object.keys(stats),['passed','skipped','failed','flaky','didNotRun']);Object.values(stats).forEach(integer);assert(stats.passed>0);for(const key of ['failed','flaky','didNotRun'])assert.equal(stats[key],0,`${key}不得计PASS`)}
function accesses(text){return text.split('\n').filter(x=>x.startsWith('[MP108_ACCESS] ')).map(x=>{const r=JSON.parse(x.slice(15));r.requestId=Array.isArray(r.requestId)?r.requestId[0]:r.requestId;return r})}
function logIdentity(text,database){assert(text.split('\n').some(line=>{try{const x=JSON.parse(line);return x.database===database&&x.candidateSha===SHA}catch{return false}}),'服务日志身份缺失')}
function correlate(rows,{requestId,path:route,status,method='GET'},start,end){assert(typeof requestId==='string'&&/^[a-f0-9-]{36}$/.test(requestId));const found=rows.filter(x=>x.requestId===requestId);assert.equal(found.length,1,'requestID不是唯一日志命中');const r=found[0];assert.equal(r.path,new URL(route,'http://127.0.0.1:3717').pathname);assert.equal(r.status,status);assert.equal(r.method,method);iso(r.at);if(start)assert(r.at>=start&&r.at<=end,'请求不在本轮命令窗口')}
export function verifyEvidence({read=n=>JSON.parse(readFileSync(path.join(DIR,n))),readText=n=>readFileSync(path.join(DIR,n),'utf8')}={}){
 const pg=read('local-postgres.json');assert.equal(pg.candidateSha,SHA);assert.equal(pg.task,5)
 const p=pg.preflight,u=pg.upgrade,f=pg.fresh;for(const x of[p,u,f]){assert.equal(x.status,'PASS');iso(x.recordedAt)}
 assert.deepEqual(p.commands,[]);assert.deepEqual(p.databases,['sbh_dev_mp108_prod']);assertUpgradeState(p.upgradeState);assert.equal(p.node,'v22.23.2');assert.equal(p.pnpm,'8.6.1');assert.equal(p.port3717,'free');assert.equal(p.devtoolsCliExists,true)
 baseline(p.baselineBefore);assert.equal(p.baselineBefore.legacySnapshotRecords,49);assert.deepEqual(p.baselineBefore,u.before)
 commands(u.commands,['pnpm exec payload migrate','pnpm migrate:assert-applied','pnpm migrate:verify','pnpm exec payload migrate'])
 assert.deepEqual(migrated(u.commands[0].output),[FINAL]);const migrations=applied(u.commands[1].output);migrationVerify(u.commands[2].output);assert.deepEqual(migrated(u.commands[3].output),[])
 assert.deepEqual(u.afterState,{count:81,last:FINAL,assetTable:'mini_user_assets'});noDecrease(u.before,u.after);assert.equal(u.after.legacySnapshotRecords,49);assert(u.after.boundedSameTables>=49)
 assert.equal(f.provedAbsentBeforeCreate,true);assert.equal(f.created,true)
 commands(f.commands,['pnpm exec payload migrate','pnpm migrate:assert-applied','pnpm migrate:verify','pnpm seed','pnpm seed:media','pnpm exec payload migrate','pnpm migrate:verify','pnpm baseline:capture',`pnpm exec vitest run ${PG_FILES.join(' ')}`])
 assert.deepEqual(migrated(f.commands[0].output),migrations);assert.deepEqual(applied(f.commands[1].output),migrations);migrationVerify(f.commands[2].output);assert(f.commands[3].output.includes('Seed data completed.'));assert(f.commands[4].output.includes('sharp 本地生成'));assert(f.commands[4].output.includes('媒体数据挂载完成。'));assert.deepEqual(migrated(f.commands[5].output),[]);migrationVerify(f.commands[6].output)
 const bm=one(f.commands[7].output,/\[baseline\] tables=(\d+) records=(\d+) db=postgres/g);assert.equal(Number(bm[1]),42);assert.equal(Number(bm[2]),50);assert.equal(f.beforeTests.legacySnapshotRecords,Number(bm[2]));noDecrease(f.beforeTests,f.afterTests)
 assert.deepEqual(f.afterState,{count:81,last:FINAL,assetTable:'mini_user_assets'})
 const output=f.commands[8].output,files=one(output,/Test Files\s+(\d+) passed \((\d+)\)/g),tests=one(output,/Tests\s+(\d+) passed \((\d+)\)/g);assert.equal(Number(files[1]),8);assert.equal(Number(files[2]),8);assert.equal(Number(tests[1]),41);assert.equal(Number(tests[2]),41);assert.deepEqual(f.tests,{filesPassed:8,passed:41,skipped:0,failed:0})
 const build=read('local-build.json');assert.equal(build.candidateSha,SHA);assert.equal(build.status,'PASS');assert.equal(build.buildCommit,SHA);assert.equal(build.temporaryBuildInfoRemoved,true);commands(build.commands,['pnpm build'])
 const http=read('local-mini-api.json');assert.equal(http.candidateSha,SHA);assert.equal(http.database,'sbh_dev_mp108_prod');assert.equal(http.status,'PASS');health(http.health)
 commands(http.commands,[`/Users/liujiayuan/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node scripts/verify-mini-api.mjs http://127.0.0.1:3717 ${path.join(DIR,'local-mini-api-probe.json')}`]);assert(http.commands[0].output.includes('artifacts/verification/MP-108/local-mini-api-probe.json'))
 assert.deepEqual(http.probe,read('local-mini-api-probe.json'));assert.equal(http.probe.baseUrl,'http://127.0.0.1:3717');iso(http.probe.verifiedAt)
 const expected={home:['/api/mini/v1/home?city=shanghai',200,null],list:['/api/mini/v1/listings?city=shanghai&priceUnit=rmb-sqm-day&page=1',200,null],detail:[`/api/mini/v1/listings/${http.probe.list.firstSlug}?city=shanghai`,200,null],invalidCity:['/api/mini/v1/home?city=unknown-city',404,'city_not_found'],invalidListing:['/api/mini/v1/listings/not-a-real-listing?city=shanghai',404,'listing_not_found']}
 const httpLog=readText('local-server-http.log');logIdentity(httpLog,'sbh_dev_mp108_prod');const rows=accesses(httpLog)
 for(const[key,[route,status,error]]of Object.entries(expected)){const r=http.probe[key];assert.equal(r.path,route);assert.equal(r.status,status);assert.equal(r.errorCode,error);assert.equal(r.cacheControl,'private, no-store');if(status===200)iso(r.asOf);correlate(rows,r,http.commands[0].startedAt,http.commands[0].finishedAt)}
 assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(http.probe.list.firstSlug));assert.equal(http.probe.detail.listingSlug,http.probe.list.firstSlug);assert(http.probe.list.itemCount>0&&http.probe.list.itemCount<=24);sameSet(http.correlatedRequestIds,Object.keys(expected).map(k=>http.probe[k].requestId))
 const page=http.pagination;assert.equal(page.page,1);assert.equal(page.pageSize,24);integer(page.totalDocs);assert.equal(page.totalPages,Math.ceil(page.totalDocs/24));assert.equal(page.hasPrevPage,false);assert.equal(page.hasNextPage,page.totalPages>1);correlate(rows,{requestId:http.paginationRequestId,path:'/api/mini/v1/listings',status:200})
 const e2e=read('local-e2e.json');assert.equal(e2e.candidateSha,SHA);assert.equal(e2e.database,'sbh_dev_mp108_fresh');const gates={}
 for(const k of['false','diagnostic','false-corrected','true']){
 const entry=e2e[k];assert(entry);const cmd='pnpm test:e2e --retries=2 --reporter=list'+(k==='diagnostic'?' tests/e2e/admin-navigation.spec.ts tests/e2e/bulk-import.spec.ts':k==='true'?' tests/e2e/multi-city-routing.spec.ts tests/e2e/multi-city-isolation.spec.ts tests/e2e/multi-city-forms.spec.ts tests/e2e/sale-channel.spec.ts':'')
 assert.equal(entry.commands.length,1);assert.equal(entry.commands[0].command,cmd);const stats=parseSummary(entry.commands[0].output);sameSet(Object.keys(entry.summary),k==='false'?['passed','skipped','failed','flaky']:Object.keys(stats));for(const key of Object.keys(entry.summary))assert.equal(entry.summary[key],stats[key]);gates[k]={status:entry.status,...stats}
 if(k==='false'){assert.equal(entry.status,'FAILED');assert.equal(entry.commands[0].exitCode,1);assert(stats.failed>0)}else{commands(entry.commands,[cmd]);assert.equal(entry.baseURL,'http://localhost:3717');assert.equal(entry.flag,k==='true'?'true':'false');assertPassingSummary(stats);assert.equal(entry.status,'PASS')}
 }
 const dev=read('local-devtools.json');assert.equal(dev.candidateSha,SHA);assert.equal(dev.database,'sbh_dev_mp108_prod');assert.equal(dev.environment,'develop');assert.equal(dev.cli,'/Applications/wechatwebdevtools.app/Contents/MacOS/cli');assert.equal(dev.status,'PASS');commands(dev.commands,['pnpm devtools:smoke']);assert(dev.commands[0].output.includes('微信开发者工具首页/找房/详情冒烟检查通过'));health(dev.health);assert.deepEqual(dev.markers,{home:true,listings:true,detail:true})
 assert(Array.isArray(dev.access)&&dev.access.length>=3);const devText=readText('local-server-devtools.log');logIdentity(devText,'sbh_dev_mp108_prod');const devRows=accesses(devText),get=dev.access.filter(x=>x.method==='GET'&&x.path.startsWith('/api/mini/v1/'))
 assert(get.length>=3);assert(get.some(x=>x.path==='/api/mini/v1/home'));assert(get.some(x=>x.path==='/api/mini/v1/listings'));assert(get.some(x=>/^\/api\/mini\/v1\/listings\/[a-z0-9-]+$/.test(x.path)));assert(get.every(x=>/^\/api\/mini\/v1\/(home|listings(?:\/[a-z0-9-]+)?)$/.test(x.path)))
 const ids=[];for(const r of get){assert.equal(r.status,200);const id=Array.isArray(r.requestId)?r.requestId[0]:r.requestId;ids.push(id);correlate(devRows,{...r,requestId:id},dev.commands[0].startedAt,dev.commands[0].finishedAt)}assert.equal(new Set(ids).size,get.length)
 const settle=read('local-settlement.json');assert.equal(settle.candidateSha,SHA);assert.equal(settle.port3717,'free');assert.equal(settle.temporaryBuildInfoRemoved,true);for(const name of['sbh_dev_mp108_prod','sbh_dev_mp108_fresh'])assert.deepEqual(settle.databases[name].migrations,{count:81,last:FINAL,assetTable:'mini_user_assets'})
 return gates
}
export function verifyBuildFiles(){
 const build=JSON.parse(readFileSync(path.join(DIR,'local-build.json')));assert.equal(readFileSync(path.join(WEB,'.next/BUILD_ID'),'utf8').trim(),build.buildId);assert.equal(JSON.parse(readFileSync(path.join(WEB,'.next/required-server-files.json'))).config.env.BUILD_COMMIT,SHA)
 const manifest=JSON.parse(readFileSync(path.join(WEB,'.next/server/app-paths-manifest.json'))),routes=Object.keys(manifest).filter(p=>p.startsWith('/api/mini/v1/')).sort();assert.equal(routes.length,12)
 const source=execFileSync('git',['ls-files','payload-office-platform/src/app/api/mini/v1/**/route.ts'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n').map(p=>p.replace('payload-office-platform/src/app','').replace(/\.ts$/,'')).sort();assert.deepEqual(routes,source)
 for(const route of routes){assert(existsSync(path.join(WEB,'.next/server',manifest[route])));assert(build.commands[0].output.includes(`ƒ ${route.replace(/\/route$/,'')}`))}
}
if(process.argv[1]===new URL(import.meta.url).pathname){assert.equal(process.argv[2],'verify');identity();const gates=verifyEvidence();verifyBuildFiles();console.log(`TASK5 VERIFY PASS（共用完整判据；只读文件/Git，不连数据库） ${JSON.stringify(gates)}`)}
