#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DIR,ROOT,SHA,identity,baseEnvironment,run,redact } from './task5-local.mjs'
identity()
const logPath=path.join(DIR,'local-server-devtools.log')
const result={status:'FAILED',candidateSha:SHA,recordedAt:new Date().toISOString(),environment:'develop',database:'sbh_dev_mp108_prod',cli:'/Applications/wechatwebdevtools.app/Contents/MacOS/cli',commands:[],markers:{home:false,listings:false,detail:false}}
const previous=path.join(DIR,'local-devtools.json')
if(existsSync(previous))result.priorAttempts=[JSON.parse(readFileSync(previous))]
const offset=readFileSync(logPath,'utf8').length
try{
const h=await fetch('http://127.0.0.1:3717/api/health');result.health=await h.json();assert.equal(h.status,200);assert.equal(result.health.version,SHA)
const e=baseEnvironment();e.WECHAT_DEVTOOLS_CLI=result.cli
const output=run('pnpm',['devtools:smoke'],e,result.commands,path.join(ROOT,'sbh-miniprogram')).output
assert(output.includes('微信开发者工具首页/找房/详情冒烟检查通过'))
result.markers={home:true,listings:true,detail:true};result.markerEvidence='既有 devtools-smoke.mjs 对三个 ready marker、路由及真实详情 slug 均显式断言后才输出成功。'
const tail=readFileSync(logPath,'utf8').slice(offset)
result.access=tail.split('\n').filter(x=>x.startsWith('[MP108_ACCESS] ')).map(x=>JSON.parse(x.slice(15))).filter(x=>x.path.startsWith('/api/mini/v1/'))
for(const p of ['/api/mini/v1/home','/api/mini/v1/listings'])assert(result.access.some(x=>x.path===p&&x.status===200&&x.requestId),'缺少本轮访问日志')
assert(result.access.some(x=>x.path.startsWith('/api/mini/v1/listings/')&&x.status===200&&x.requestId),'缺少真实详情访问日志')
result.status='PASS'
}catch(error){result.failure=redact(error.message);result.access=readFileSync(logPath,'utf8').slice(offset).split('\n').filter(x=>x.startsWith('[MP108_ACCESS] ')).map(x=>JSON.parse(x.slice(15)));process.exitCode=1}
writeFileSync(path.join(DIR,'local-devtools.json'),JSON.stringify(result,null,2)+'\n');console.log(`DEVTOOLS ${result.status}${result.failure?' '+result.failure:''}`)
