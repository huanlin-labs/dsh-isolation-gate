#!/usr/bin/env node
/**
 * 门禁 · 跨 harness 本地设置页（`gate ui`）
 *
 * 为什么要有它：dsh 用户有「门禁」面板，但 ZCode / opencode / pi / Claude Code 的
 * 用户没有前端。这个本地小页面让任何 harness 的用户都能在同一份状态文件上：
 *   - 看见名单里的对象与分组
 *   - 一键切换「禁 / 只读 / 可读写删」
 *   - 新增 / 移除受管对象（名字或绝对路径）
 *   - 整组切档
 *
 * 安全边界：只监听 127.0.0.1；用一次性 token 校验写操作；不读写名单以外的文件。
 * 不改任何第三方 harness 的配置 —— 接线仍由 gate-setup 负责。
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildReport, editRoster, normalizeConfig, setGroupLevel, setLevel } from '../lib/service.js';

const LEVELS = [
  { level: 'deny', label: '禁' },
  { level: 'read', label: '只读' },
  { level: 'full', label: '可读写删' },
];

function page(token) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>门禁 · 设置</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 system-ui,"Segoe UI",sans-serif;background:#111318;color:#e8eaf0}
header{padding:18px 22px;border-bottom:1px solid #262a33;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
h1{font-size:16px;margin:0;font-weight:600}
.sub{color:#8b93a7;font-size:12px}
main{padding:18px 22px;max-width:920px;margin:0 auto}
.card{background:#171a21;border:1px solid #262a33;border-radius:10px;padding:14px 16px;margin-bottom:14px}
.card h2{font-size:13px;margin:0 0 10px;color:#aab2c5;font-weight:600}
.row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #20242d;flex-wrap:wrap}
.row:first-of-type{border-top:0}
.name{min-width:180px;font-weight:600}
.path{color:#8b93a7;font-weight:400;font-size:12px}
.seg{display:flex;border:1px solid #303645;border-radius:8px;overflow:hidden}
.seg button{background:transparent;border:0;color:#aab2c5;padding:5px 12px;cursor:pointer;font-size:12px}
.seg button+button{border-left:1px solid #303645}
.seg button.on{background:#2f6df6;color:#fff}
.seg button.danger.on{background:#d64545}
.grow{flex:1}
input[type=text]{background:#0e1014;border:1px solid #303645;border-radius:8px;color:#e8eaf0;padding:7px 10px;min-width:260px}
button.primary{background:#2f6df6;border:0;color:#fff;border-radius:8px;padding:7px 14px;cursor:pointer}
button.ghost{background:transparent;border:1px solid #303645;color:#aab2c5;border-radius:8px;padding:5px 10px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
#msg{min-height:20px;color:#7fd18b;font-size:12px}
#msg.err{color:#f08a8a}
</style></head><body>
<header><h1>门禁 · 设置</h1><span class="sub">同一份状态文件，任何 harness 通用 · 写完即生效（新会话生效）</span></header>
<main>
  <div class="card"><h2>新增受管对象（名字如 <code>Zcode</code>，或绝对路径如 <code>D:\secret</code>）</h2>
    <div class="row"><input id="add" type="text" placeholder="Zcode 或 D:\secret"><button class="primary" id="addBtn">加入名单（默认「禁」）</button></div>
  </div>
  <div id="groups"></div>
  <div class="card"><h2>未分组</h2><div id="ungrouped"></div></div>
  <div id="msg"></div>
</main>
<script>
const TOKEN=${JSON.stringify(token)};
const LV=[["deny","禁"],["read","只读"],["full","可读写删"]];
const msg=document.getElementById('msg');
function say(t,err){msg.textContent=t;msg.className=err?'err':''}
async function api(path,body){
  const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-gate-token':TOKEN},body:JSON.stringify(body||{})});
  const j=await r.json().catch(()=>({ok:false,error:'响应不是 JSON'}));
  if(!j.ok) throw new Error(j.error||'操作失败');
  return j;
}
function seg(key,level){
  const d=document.createElement('div');d.className='seg';
  for(const [v,label] of LV){
    const b=document.createElement('button');b.textContent=label;
    if(v===level)b.className='on'+(v==='deny'?' danger':'');
    b.onclick=async()=>{try{await api('/api/level',{key,level:v});say('已更新：'+key+' → '+label);await load()}catch(e){say(e.message,1)}};
    d.appendChild(b);
  }
  return d;
}
function row(o){
  const r=document.createElement('div');r.className='row';
  const n=document.createElement('div');n.className='name';n.textContent=o.key;
  if(o.kind==='path'){const s=document.createElement('span');s.className='path';s.textContent=' 路径';n.appendChild(s)}
  const g=document.createElement('div');g.className='grow';
  const rm=document.createElement('button');rm.className='ghost';rm.textContent='移出名单';
  rm.onclick=async()=>{if(!confirm('移出名单并清掉其级别：'+o.key+'？'))return;try{await api('/api/remove',{key:o.key});say('已移出：'+o.key);await load()}catch(e){say(e.message,1)}};
  r.append(n,g,seg(o.key,o.level),rm);return r;
}
async function load(){
  const s=await (await fetch('/api/report')).json();
  const box=document.getElementById('groups');box.textContent='';
  for(const grp of s.groups||[]){
    const c=document.createElement('div');c.className='card';
    const h=document.createElement('h2');h.textContent='分组 · '+(grp.name||'（未命名）')+'（'+grp.count+'）';c.appendChild(h);
    const gd=document.createElement('div');gd.className='row';
    const t=document.createElement('div');t.className='grow';t.textContent='整组切档：';gd.appendChild(t);
    gd.appendChild(segGroup(grp.name));c.appendChild(gd);
    for(const m of grp.members||[]){
      const o=(s.roster||[]).find(x=>x.key===m);
      if(o)c.appendChild(row(o));
    }
    box.appendChild(c);
  }
  const ug=document.getElementById('ungrouped');ug.textContent='';
  const ungrouped=(s.roster||[]).filter(o=>!o.group);
  if(!ungrouped.length){const p=document.createElement('div');p.className='sub';p.textContent='（无）';ug.appendChild(p)}
  for(const o of ungrouped) ug.appendChild(row(o));
}
function segGroup(name){
  const d=document.createElement('div');d.className='seg';
  for(const [v,label] of LV){
    const b=document.createElement('button');b.textContent=label;
    if(v==='deny')b.classList.add('danger');
    b.onclick=async()=>{try{await api('/api/group-level',{group:name,level:v});say('整组已切换：'+name+' → '+label);await load()}catch(e){say(e.message,1)}};
    d.appendChild(b);
  }
  return d;
}
document.getElementById('addBtn').onclick=async()=>{
  const v=document.getElementById('add').value.trim();if(!v)return;
  try{await api('/api/add',{value:v});say('已加入：'+v+'（默认「禁」）');document.getElementById('add').value='';await load()}catch(e){say(e.message,1)}
};
load().catch(e=>say('读取失败：'+e.message,1));
</script></body></html>`;
}

export async function startUi(options = {}) {
  const raw = {};
  if (process.env.GATE_STATE_PATH) raw.statePath = process.env.GATE_STATE_PATH;
  if (process.env.GATE_ROSTER_PATH) raw.rosterPath = process.env.GATE_ROSTER_PATH;
  if (process.env.GATE_AUDIT_PATH) raw.auditPath = process.env.GATE_AUDIT_PATH;
  if (process.env.GATE_ROOT) raw.root = process.env.GATE_ROOT;
  const cfg = normalizeConfig(raw);
  const token = randomBytes(16).toString('hex');
  const port = Number(options.port) || 19390;

  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        return send(200, page(token), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/report') {
        const r = buildReport(cfg);
        return send(200, JSON.stringify({ ok: true, groups: r.groups, roster: r.roster, paths: r.paths, levels: r.levels, defaultLevel: r.defaultLevel }));
      }
      if (req.method === 'POST' && req.url?.startsWith('/api/')) {
        if (req.headers['x-gate-token'] !== token) return send(403, JSON.stringify({ ok: false, error: 'token 不正确（请从启动时打印的地址打开）' }));
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        const action = req.url.slice('/api/'.length);
        let out;
        if (action === 'level') out = setLevel(cfg, { name: body.key, level: body.level, by: 'gate-ui' });
        else if (action === 'group-level') out = setGroupLevel(cfg, { group: body.group, level: body.level, by: 'gate-ui' });
        else if (action === 'add') out = editRoster(cfg, { action: 'add', name: body.value });
        else if (action === 'remove') out = editRoster(cfg, { action: 'remove', name: body.key });
        else return send(404, JSON.stringify({ ok: false, error: '未知操作：' + action }));
        return send(out?.ok === false ? 400 : 200, JSON.stringify(out ?? { ok: false, error: '无返回' }));
      }
      return send(404, JSON.stringify({ ok: false, error: 'not found' }));
    } catch (error) {
      return send(500, JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actual = server.address().port;
  const url = `http://127.0.0.1:${actual}/`;
  process.stdout.write(`门禁设置页：${url}\n（仅本机可访问；关闭本进程即停止）\n`);
  return { server, url, port: actual, close: () => server.close() };
}

if (process.argv[1] && process.argv[1].endsWith('gate-ui.mjs')) {
  const portArg = process.argv.indexOf('--port');
  await startUi({ port: portArg > 0 ? Number(process.argv[portArg + 1]) : undefined });
}
