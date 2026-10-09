#!/usr/bin/env node
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import {DIR,WEB,SHA,identity,baseEnvironment,redact} from './task5-local.mjs'
const FRESH='sbh_dev_mp108_fresh'
const TABLES=['search','listings','supply_import_batches','follow_ups','lead_ownership_history','leads','business_area_extensions','location_aliases','locations']
const LOCATION_SLUGS=['e2e-test-city','e2e-xihu','e2e-binjiang','e2e-metro-2','e2e-metro-1','e2e-metro-2-st1','e2e-ba-xihu']
const digest=text=>createHash('sha256').update(text).digest('hex')
const unique=xs=>{assert(Array.isArray(xs));assert.equal(new Set(xs).size,xs.length,'清理标记重复')}
export function assertMarkers(requests,externalIds,files){
 for(const xs of[requests,externalIds,files])unique(xs)
 assert(requests.every(x=>/^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|e2e-idempotent-[a-z0-9-]+)$/.test(x)))
 assert(externalIds.every(x=>/^E2E-OPT041-[a-z0-9]+-[12]$/.test(x)))
 assert(files.every(x=>/^bulk-import-listings-(?:reimport-)?[a-z0-9]+\.xlsx$/.test(x)))
}
export function assertPortFree(result){assert.equal(result.error,undefined,'端口检查错误');assert.equal(result.status,1,'3717仍占用或检查失败');assert.equal(result.stdout.trim(),'','3717仍有监听')}
export function validateCleanupPlan(plan,evidenceText,candidateText){
  assert.equal(plan.candidateSha,SHA);assert.equal(plan.database,FRESH)
 assert.equal(plan.candidateEvidenceSha256,digest(candidateText),'候选E2E证据指纹不匹配')
 const candidate=JSON.parse(candidateText);assert.equal(candidate.candidateSha,SHA);assert.equal(candidate.database,FRESH)
 assert(/^local-e2e-cleanup-(?:initial|final)\.json$/.test(plan.evidenceFile),'必须绑定本任务明确清理证据')
 assert.equal(plan.evidenceSha256,digest(evidenceText),'证据指纹不匹配')
 const evidence=JSON.parse(evidenceText);assert.equal(evidence.database,FRESH);assert.equal(evidence.status,'PASS')
 assert.equal(evidence.phase,plan.evidenceFile.includes('initial')?'initial':'final')
 assertMarkers(plan.markers.requests,plan.markers.externalIds,plan.markers.files);unique(plan.markers.locationSlugs)
 assert(plan.markers.locationSlugs.every(x=>LOCATION_SLUGS.includes(x)))
 const original={...evidence.exactMarkers,locationSlugs:evidence.exactMarkers.locationSlugs??[]}
 assert.deepEqual(plan.markers,original,'删除集合与绑定证据不一致')
 const stage=evidence.phase==='initial'?candidate.false:candidate.true
 assert.deepEqual(plan.markers.requests,stage.after.markers.leadRequestIds)
 assert.deepEqual(plan.markers.locationSlugs,stage.after.markers.locationSlugs)
 assert(Object.values(plan.markers).some(xs=>xs.length>0),'拒绝空清理计划')
 for(const field of['expectedDelete','expectedRemaining']){assert.deepEqual(Object.keys(plan[field]).sort(),[...TABLES].sort());for(const n of Object.values(plan[field]))assert(Number.isSafeInteger(n)&&n>=0)}
 for(const[table,key]of[['leads','requests'],['listings','externalIds'],['supply_import_batches','files'],['locations','locationSlugs']])assert.equal(plan.expectedDelete[table],plan.markers[key].length)
 const recorded=[...evidence.output.matchAll(/^DELETE (\d+)$/gm)].map(m=>Number(m[1]))
 if(evidence.phase==='initial'){assert.equal(recorded.length,6);recorded.push(0,0,0)}else assert.equal(recorded.length,9)
 assert.deepEqual(TABLES.map(t=>plan.expectedDelete[t]),recorded,'预期删除数必须与明确绑定的原记录逐项一致')
 for(const table of TABLES)if(Object.hasOwn(evidence.before.counts,table)){
   assert.equal(plan.expectedDelete[table]+plan.expectedRemaining[table],evidence.before.counts[table],`预期总数与证据不一致:${table}`)
   assert.equal(plan.expectedRemaining[table],evidence.after.counts[table],`剩余数与证据不一致:${table}`)
 }
 return plan
}
function statements(plan){
 const m=plan.markers,l='SELECT id FROM listings WHERE data_source_external_id = ANY($1::text[])',leads='SELECT id FROM leads WHERE request_id = ANY($1::text[])',locations='SELECT id FROM locations WHERE slug = ANY($1::text[])'
 return [
 ['search',`id IN (SELECT parent_id FROM search_rels WHERE listings_id IN (${l}))`,m.externalIds],
 ['listings','data_source_external_id = ANY($1::text[])',m.externalIds],
 ['supply_import_batches','file_name = ANY($1::text[])',m.files],
 ['follow_ups',`lead_id IN (${leads})`,m.requests],['lead_ownership_history',`lead_id IN (${leads})`,m.requests],
 ['leads','request_id = ANY($1::text[])',m.requests],['business_area_extensions',`business_area_id IN (${locations})`,m.locationSlugs],
 ['location_aliases',`location_id IN (${locations})`,m.locationSlugs],['locations','slug = ANY($1::text[])',m.locationSlugs],
 ]
}
async function connectLocal(){
 const require=createRequire(path.join(WEB,'package.json')),pg=createRequire(require.resolve('@payloadcms/db-postgres'))('pg')
 const client=new pg.Client({host:'127.0.0.1',port:5432,user:'liujiayuan',database:FRESH,password:'',ssl:false,options:'-c default_transaction_read_only=off'})
 await client.connect();return client
}
export async function executeCleanup(plan,io={}){
 const checkPort=io.checkPort??(()=>assertPortFree(spawnSync('lsof',['-nP','-iTCP:3717','-sTCP:LISTEN'],{encoding:'utf8',env:baseEnvironment()})))
 checkPort();(io.assertIdentity??identity)()
 // All authority/identity/marker checks precede the first database connection.
 assert(/^local-e2e-cleanup-(?:initial|final)\.json$/.test(plan.evidenceFile))
 const load=io.loadEvidence??(n=>readFileSync(path.join(DIR,n),'utf8'))
 const raw=load(plan.evidenceFile)
 validateCleanupPlan(plan,raw,load('local-e2e.json'))
 const client=await (io.connect??connectLocal)();let begun=false
 const count=async(q,values=[])=>{const r=await client.query(q,values);assert.equal(r.rows.length,1);const n=Number(r.rows[0].n);assert(Number.isSafeInteger(n)&&n>=0);return n}
 try{
   await client.query('BEGIN');begun=true
   await client.query(`LOCK TABLE ${TABLES.join(', ')} IN SHARE ROW EXCLUSIVE MODE`)
   const rows=statements(plan)
   for(const[table,where,values]of rows){assert.equal(await count(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,[values]),plan.expectedDelete[table],`删除前集合数量不符:${table}`);assert.equal(await count(`SELECT count(*) AS n FROM ${table}`),plan.expectedDelete[table]+plan.expectedRemaining[table],`删除前总数不符:${table}`)}
   const deleted={}
   for(const[table,where,values]of rows){const r=await client.query(`DELETE FROM ${table} WHERE ${where}`,[values]);assert.equal(r.rowCount,plan.expectedDelete[table],`实际删除数不符:${table}`);deleted[table]=r.rowCount}
   for(const[table,where,values]of rows){assert.equal(await count(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,[values]),0,`标记残留:${table}`);assert.equal(await count(`SELECT count(*) AS n FROM ${table}`),plan.expectedRemaining[table],`事务内剩余数不符:${table}`)}
   checkPort();await client.query('COMMIT');begun=false
   return{status:'PASS',candidateSha:SHA,database:FRESH,evidenceSha256:plan.evidenceSha256,deleted,remaining:plan.expectedRemaining}
 }catch(error){if(begun)await client.query('ROLLBACK');throw error}finally{await client.end()}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 assert.equal(process.argv[2],'apply','必须显式apply及已审批expected-count计划；旧initial/final模式禁用')
 assert(process.argv[3],'缺少显式计划文件')
 const plan=JSON.parse(readFileSync(process.argv[3],'utf8'))
 try{const result=await executeCleanup(plan);identity();writeFileSync(path.join(DIR,`local-cleanup-application-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');console.log('精确事务清理PASS')}catch(error){console.error(redact(error.message));process.exitCode=1}
}
