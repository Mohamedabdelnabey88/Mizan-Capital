import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/finance.ts'],bundle:true,platform:'node',format:'esm',alias:{'@':process.cwd()},outfile:'.sites-runtime/project-ui-ledger.mjs'});
const f=await import('../.sites-runtime/project-ui-ledger.mjs');
const line=(project,account,debit,credit)=>({project,account,debit,credit});
const workspace={records:[{id:'cost1',kind:'projectCost',data:{project:'parent',amount:50000,status:'posted'},version:1}],audit:[],journals:[
 {id:'capital',date:'2026-01-01',kind:'capital',memo:'capital',lines:[line('parent','cash',200000,0),line('parent','capital',0,200000)]},
 {id:'expense',date:'2026-01-10',kind:'projectCost',memo:'operating cost',source:'project-cost:cost1',lines:[line('parent','expense',50000,0),line('parent','cash',0,50000)]},
 {id:'asset',date:'2026-01-11',kind:'projectCost',memo:'asset cost',lines:[line('parent','fixed',30000,0),line('parent','cash',0,30000)]},
 {id:'childincome',date:'2026-02-01',kind:'income',memo:'branch',lines:[line('child','bank',80000,0),line('child','revenue',0,80000)]},
 {id:'future',date:'2026-04-01',kind:'expense',memo:'future',lines:[line('parent','expense',15000,0),line('parent','cash',0,15000)]}
]};
const scope=['parent','child'];const range=(start,end)=>scope.reduce((a,id)=>{const p=f.profit(workspace,id,start,end);return {revenue:a.revenue+p.revenue,expense:a.expense+p.expense,net:a.net+p.net}},{revenue:0,expense:0,net:0});
const profit=range('2026-01-01','2026-03-31');
assert.deepEqual(profit,{revenue:80000,expense:50000,net:30000},'capitalized asset and future-dated expenses must not overstate expenses in range');
const opening=scope.reduce((sum,id)=>{const b=f.balance(workspace,id,'2026-03-31');return sum+(b.cash||0)+(b.bank||0)},0);
assert.equal(opening,200000,'capital less paid costs plus branch income equals actual cash+bank');
assert.equal(f.profit(workspace,'parent','2026-01-01','2026-03-31').expense,50000,'posted project cost must be counted once, not once per record and again per ledger');
assert.equal(f.profit(workspace,'parent','2026-01-01','2026-04-30').expense,65000,'expense posted after period end must appear only once period includes it');
const ui=fs.readFileSync('app/page.tsx','utf8'),css=fs.readFileSync('app/globals.css','utf8');
assert(ui.includes("const hierarchyProfit=hierarchyProjectIds.reduce((sum,id)=>{const q=profit(w,id,from,to)"),'hierarchy profit must honor selected reporting period');
assert(ui.includes("const hierarchyLedger=hierarchyProjectIds.reduce"),'hierarchy cash must come from each project ledger');
assert(ui.includes("<Money value={hierarchyProfit.expense}/>"),'booked expenses must come from ledger profit, never manually add project cost records');
assert(ui.includes("<Money value={hierarchyLedger.cashBank}/>"),'cash must be distinct from investment assets and card receivables');
assert(ui.includes("const commitmentPending=w.records.filter"),'remaining commitments must derive from pending dues, not stale contract installment copies');
assert(ui.includes("className=\"project-empty-state\""),'page must present intentional empty state and action');
assert(ui.includes("project-page-intro-actions"),'page must provide direct primary entry points');
assert(css.includes("@media(max-width:650px){.project-page-intro"),'project page must work on narrow phones');
console.log('Project and investment accounting and UI validation passed.');
