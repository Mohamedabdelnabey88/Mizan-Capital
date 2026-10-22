import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/obligation-dashboard.ts'],bundle:true,format:'esm',platform:'node',alias:{'@':process.cwd()},outfile:'.sites-runtime/obligation-dashboard.mjs'});
const {obligationDashboard}=await import('../.sites-runtime/obligation-dashboard.mjs');
const due=(id,date,direction,amount,status='pending',paidOn='')=>({id,kind:'obligation',data:{project:'p1',date,direction,amount,status,paidOn}});
const w={records:[
 due('overdue-in','2026-10-10','in',12000),
 due('overdue-out','2026-10-11','out',8000),
 due('today-out','2026-10-22','out',5000),
 due('future-in','2026-10-25','in',30000),
 due('future-out','2026-10-30','out',12000),
 due('paid-in','2026-09-05','in',20000,'paid','2026-10-19'),
 due('paid-out','2026-09-01','out',6000,'paid','2026-10-20'),
 due('replaced','2026-10-07','out',999999,'replaced'),
 due('cancelled','2026-10-07','out',999999,'cancelled'),
 due('other-project','2026-10-15','out',90000,'pending')
],journals:[],audit:[]};
w.records.at(-1).data.project='p2';
const v=obligationDashboard(w,'p1','2026-10-01','2026-10-31','2026-10-22');
assert.equal(v.expectedInflows,42000);
assert.equal(v.expectedOutflows,25000);
assert.equal(v.settledInflows,20000);
assert.equal(v.settledOutflows,6000);
assert.equal(v.totalScheduledReceivables,62000);
assert.equal(v.overdueInAmount,12000);
assert.equal(v.overdueOutAmount,8000);
assert.equal(v.dueTodayOutAmount,5000,'Due today must not be classified overdue');
assert.equal(v.overdueOutCount,1);
assert.equal(v.futureOutAmount,12000);
assert.equal(v.settledNet,14000,'Actual settlements are paid in minus paid out, not minus unpaid obligations');
assert.equal(v.pendingNet,17000,'Scheduled remaining is expected in minus expected out, without settled dues');
assert.equal(v.periodNet,31000);
const ui=fs.readFileSync('app/page.tsx','utf8'),css=fs.readFileSync('app/globals.css','utf8');
assert(ui.includes("summary=obligationDashboard(w,scope,range.start,range.end)"));
assert(ui.includes("actualAfterCommitments=summary.settledNet"));
assert(ui.includes("expectedAfterCommitments=summary.pendingNet"));
assert(!ui.includes('projectedClosingLiquidity'),'No invented cash forecast from current balance plus already-settled schedules');
assert(ui.includes('مدفوعات متأخرة')&&ui.includes('summary.overdueOutAmount'));
assert(css.includes('.commitment-kpi-grid')&&css.includes('@media(max-width:720px){.commitment-page-intro'));
console.log('Commitment dashboard accurate paid/due/overdue reconciliations passed.');
