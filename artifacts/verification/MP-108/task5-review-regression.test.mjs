import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import * as verify from './task5-verify.mjs'
import * as cleanup from './task5-cleanup.mjs'
import {DIR,SHA,identity} from './task5-local.mjs'

const files=Object.fromEntries(readdirSync(DIR).filter(n=>/^local-.*\.(json|log)$/.test(n)).map(n=>[n,readFileSync(path.join(DIR,n),'utf8')]))
function fixture(){return structuredClone(files)}
function mutate(data,name,change){const x=JSON.parse(data[name]);change(x);data[name]=JSON.stringify(x)}
function validate(data){
 return verify.verifyEvidence({read:n=>JSON.parse(data[n]),readText:n=>data[n]})
}
const cases=[
 ['PG空升级命令','local-postgres.json',d=>d.upgrade.commands=[]],
 ['PG错误命令','local-postgres.json',d=>d.upgrade.commands[0].command='echo PASS'],
 ['PG伪造成功output','local-postgres.json',d=>d.upgrade.commands[0].output='PASS'],
 ['PG错误迁移末项','local-postgres.json',d=>d.fresh.afterState.last='wrong'],
 ['PG空baseline','local-postgres.json',d=>d.upgrade.before.tables=[]],
 ['PG baseline减少','local-postgres.json',d=>d.upgrade.after.tables[0].count=0],
 ['PG summary漂移','local-postgres.json',d=>d.fresh.tests.passed=0],
 ['HTTP空命令','local-mini-api.json',d=>d.commands=[]],
 ['HTTP错误命令目标','local-mini-api.json',d=>d.commands[0].command='echo PASS'],
 ['HTTP五合同状态','local-mini-api.json',d=>d.probe.home.status=500],
 ['HTTP缓存合同','local-mini-api.json',d=>d.probe.list.cacheControl='public'],
 ['HTTP asOf合同','local-mini-api.json',d=>d.probe.detail.asOf=null],
 ['HTTP空requestID集','local-mini-api.json',d=>d.correlatedRequestIds=[]],
 ['HTTP分页合同','local-mini-api.json',d=>d.pagination.pageSize=2],
 ['DevTools空命令','local-devtools.json',d=>d.commands=[]],
 ['DevTools空markers','local-devtools.json',d=>d.markers={}],
 ['DevTools空access','local-devtools.json',d=>d.access=[]],
 ['DevTools假路径','local-devtools.json',d=>d.access=d.access.map(x=>({...x,path:'/wrong'}))],
 ['E2E flaky不能PASS','local-e2e.json',d=>{d.true.summary.flaky=1;d.true.commands[0].output+='\n  1 flaky\n'}],
]
for(const[label,name,change]of cases)test(`review RED/GREEN ${label}`,()=>{const d=fixture();mutate(d,name,change);assert.throws(()=>validate(d))})
test('完整现有证据仍可通过',()=>assert.doesNotThrow(()=>validate(fixture())))

for(const kind of ['index','worktree','untracked'])test(`临时fixture ${kind}业务或迁移dirty拒绝`,()=>{
 const root=mkdtempSync(path.join(tmpdir(),'mp108-identity-'))
 try{
 for(const name of ['payload-office-platform','sbh-miniprogram'])mkdirSync(path.join(root,name))
 const dirty=kind==='untracked'?'payload-office-platform/src/migrations/rogue.ts':'payload-office-platform/src/business.ts'
 writeFileSync(path.join(root,'fixture-status.json'),JSON.stringify({kind,dirty}))
 const exec=(cmd,args)=>{
   if(cmd==='pnpm')return '8.6.1\n'
   if(args[0]==='rev-parse')return SHA+'\n'
   const f=JSON.parse(readFileSync(path.join(root,'fixture-status.json')))
   if(args[0]==='diff'&&args.includes('--cached'))return f.kind==='index'?f.dirty+'\0':''
   if(args[0]==='diff')return f.kind==='worktree'?f.dirty+'\0':''
   if(args[0]==='ls-files')return f.kind==='untracked'?f.dirty+'\0':''
   throw Error('unexpected boundary')
 }
 assert.throws(()=>identity({root,exec}))
 }finally{rmSync(root,{recursive:true})}
})

test('capture共享判据拒绝flaky或未运行',()=>{
 const check=verify.assertPassingSummary??(()=>{})
 assert.throws(()=>check({passed:10,skipped:0,failed:0,flaky:1,didNotRun:0}))
 assert.throws(()=>check({passed:10,skipped:0,failed:0,flaky:0,didNotRun:1}))
})

test('cleanup占用端口时DB边界完全不触发',async()=>{
 assert.equal(typeof cleanup.executeCleanup,'function','现有清理缺少可核验的事务边界')
 let connected=false
 await assert.rejects(cleanup.executeCleanup({}, {assertIdentity(){},checkPort(){throw Error('occupied')},connect(){connected=true;throw Error('MUST NOT CONNECT')}}))
 assert.equal(connected,false)
})
test('cleanup预期数量不匹配必须ROLLBACK且不能COMMIT',async()=>{
 assert.equal(typeof cleanup.executeCleanup,'function','现有清理在事后才核验')
 const calls=[]
 await assert.rejects(cleanup.executeCleanup(cleanupPlan(), {assertIdentity(){},checkPort(){},loadEvidence:n=>files[n],connect:async()=>({query:async(q)=>{calls.push(q);if(q==='BEGIN'||q==='ROLLBACK'||q.startsWith('LOCK'))return {};return{rows:[{n:999}],rowCount:999}},end:async()=>{}})}))
 assert(calls.includes('ROLLBACK'));assert(!calls.includes('COMMIT'))
})
function cleanupPlan(){
 const name='local-e2e-cleanup-final.json',e=JSON.parse(files[name]),tables=['search','listings','supply_import_batches','follow_ups','lead_ownership_history','leads','business_area_extensions','location_aliases','locations']
 const counts=JSON.parse(files['local-settlement.json']).databases.sbh_dev_mp108_fresh.allPublicTableCounts
 return {candidateSha:SHA,database:'sbh_dev_mp108_fresh',evidenceFile:name,evidenceSha256:createHash('sha256').update(files[name]).digest('hex'),candidateEvidenceSha256:createHash('sha256').update(files['local-e2e.json']).digest('hex'),markers:e.exactMarkers,expectedDelete:Object.fromEntries(tables.map((t,i)=>[t,Number([...e.output.matchAll(/DELETE (\d+)/g)][i][1])])),expectedRemaining:Object.fromEntries(tables.map(t=>[t,counts[t]]))}
}
for(const failure of ['delete-count','remaining-count','none'])test(`cleanup事务内${failure}核验`,async()=>{
 assert.equal(typeof cleanup.executeCleanup,'function')
 const plan=cleanupPlan(),calls=[],totals=Object.fromEntries(Object.keys(plan.expectedDelete).map(t=>[t,plan.expectedDelete[t]+plan.expectedRemaining[t]])),selected={...plan.expectedDelete}
 const io={assertIdentity(){},checkPort(){},loadEvidence:n=>files[n],connect:async()=>({end:async()=>{},query:async(q)=>{
   calls.push(q);if(['BEGIN','COMMIT','ROLLBACK'].includes(q)||q.startsWith('LOCK'))return{}
   const table=q.match(/FROM (\w+)/)[1]
   if(q.startsWith('DELETE')){const n=selected[table];totals[table]-=n;selected[table]=0;return{rowCount:failure==='delete-count'?n+1:n}}
   const n=q.includes(' WHERE ')?selected[table]:totals[table]
   return{rows:[{n:failure==='remaining-count'&&calls.some(x=>x.startsWith('DELETE'))&&!q.includes(' WHERE ')?n+1:n}]}
 }})}
 if(failure==='none'){const result=await cleanup.executeCleanup(plan,io);assert.equal(result.status,'PASS');assert.equal(calls.at(-1),'COMMIT')}
 else{await assert.rejects(cleanup.executeCleanup(plan,io));assert(calls.includes('ROLLBACK'));assert(!calls.includes('COMMIT'))}
})
test('cleanup篡改证据绑定或集合不能连接DB',async()=>{
 assert.equal(typeof cleanup.executeCleanup,'function')
 for(const change of [p=>p.evidenceSha256='0'.repeat(64),p=>p.candidateEvidenceSha256='0'.repeat(64),p=>{p.expectedDelete.search+=1;p.expectedRemaining.search-=1},p=>p.database='other',p=>p.markers.requests.push(p.markers.requests[0])]){
   const p=cleanupPlan();change(p);let connected=false
   await assert.rejects(cleanup.executeCleanup(p,{checkPort(){},assertIdentity(){},loadEvidence:n=>files[n],connect(){connected=true}}));assert.equal(connected,false)
 }
})
