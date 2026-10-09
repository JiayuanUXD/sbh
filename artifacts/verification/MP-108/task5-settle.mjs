#!/usr/bin/env node
import assert from 'node:assert/strict'
import {spawnSync,execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import path from 'node:path'
import {DIR,ROOT,WEB,SHA,identity,sql,migrationState} from './task5-local.mjs'
identity()
const port=spawnSync('lsof',['-nP','-iTCP:3717','-sTCP:LISTEN'],{encoding:'utf8'}).stdout.trim();assert.equal(port,'','本任务结束后3717仍占用')
const pg=JSON.parse(readFileSync(path.join(DIR,'local-postgres.json')))
const result={candidateSha:SHA,recordedAt:new Date().toISOString(),port3717:'free',temporaryBuildInfoRemoved:!existsSync(path.join(WEB,'build-info.json')),databases:{}}
for(const name of ['sbh_dev_mp108_prod','sbh_dev_mp108_fresh']){
 const tableNames=sql(name,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split('\n');assert(tableNames.every(x=>/^[a-z_]+$/.test(x)))
 const counts=Object.fromEntries(sql(name,tableNames.map(t=>`SELECT '${t}',count(*) FROM "${t}"`).join(' UNION ALL ')).split('\n').map(x=>{const[t,n]=x.split('|');return[t,Number(n)]}))
 result.databases[name]={migrations:migrationState(name),allPublicTableCounts:counts,publicTableCount:tableNames.length,retained:true}
 if(name.endsWith('_prod')){
 const updatedTables=sql(name,"SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='updated_at' ORDER BY table_name").split('\n');assert(updatedTables.every(x=>/^[a-z_]+$/.test(x)))
 result.databases[name].rowsUpdatedSinceFirstHttp=Object.fromEntries(sql(name,updatedTables.map(t=>`SELECT '${t}',count(*) FROM "${t}" WHERE updated_at >= '2026-09-07T06:18:39Z'`).join(' UNION ALL ')).split('\n').map(x=>{const[t,n]=x.split('|');return[t,Number(n)]}))
 for(const row of pg.upgrade.before.tables)assert(counts[row.table]>=row.count)
 }
}
const generated=path.join(WEB,'artifacts/verification/f7-2-visual-review'), held=path.join(ROOT,'.superpowers/sdd/task5-unreviewed-visuals')
if(existsSync(generated)){assert(!existsSync(held));renameSync(generated,held);result.generatedScreenshots='本轮既有E2E自动生成的20张未脱敏截图移至忽略的 .superpowers/sdd/task5-unreviewed-visuals；未作验收证据，无旧截图复用。'}
result.dirty=execFileSync('git',['status','--short'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n')
assert(result.temporaryBuildInfoRemoved)
writeFileSync(path.join(DIR,'local-settlement.json'),JSON.stringify(result,null,2)+'\n');console.log('SETTLEMENT captured; both databases retained, port3717 free')
