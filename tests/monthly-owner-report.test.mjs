import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/monthly-owner-report.ts'],bundle:true,format:'esm',platform:'node',alias:{'@':process.cwd()},outfile:'.sites-runtime/monthly-owner-report.mjs'});
const {monthlyOwnerAdvanceReport}=await import('../.sites-runtime/monthly-owner-report.mjs');
const line=(project,account,debit,credit)=>({project,account,debit,credit});
const w={audit:[],records:[
 {id:'a1',kind:'deficitPayment',data:{project:'p1',deficitMonth:'2026-08',amount:35000,date:'2026-08-18',repaid:35000,status:'repaid'}},
 {id:'a2',kind:'deficitPayment',data:{project:'p1',deficitMonth:'2026-08',amount:12000,date:'2026-09-04',repaid:5000,status:'open'}},
 {id:'a3',kind:'deficitPayment',data:{project:'',deficitMonth:'',amount:10000,date:'2026-09-05',repaid:0,status:'open'}},
 {id:'r1',kind:'ownerAdvanceRepayment',data:{advanceId:'a1',project:'p1',amount:20000,date:'2026-09-10',status:'posted'}},
 {id:'r2',kind:'ownerAdvanceRepayment',data:{advanceId:'a1',project:'p1',amount:15000,date:'2026-10-03',status:'posted'}},
 {id:'r3',kind:'ownerAdvanceRepayment',data:{advanceId:'a2',project:'p1',amount:5000,date:'2026-10-05',status:'posted'}},
 {id:'cancelled',kind:'deficitPayment',data:{project:'p1',deficitMonth:'2026-09',amount:999900,date:'2026-09-01',status:'cancelled'}},
 {id:'orphan',kind:'ownerAdvanceRepayment',data:{advanceId:'absent',project:'p1',amount:1000000,date:'2026-09-01',status:'posted'}},
],journals:[
 {id:'income',date:'2026-08-03',kind:'income',memo:'sales',lines:[line('p1','bank',80000,0),line('p1','revenue',0,80000)]},
 {id:'expense',date:'2026-08-06',kind:'expense',memo:'operations',lines:[line('p1','expense',130000,0),line('p1','bank',0,130000)]},
 {id:'sept-income',date:'2026-09-02',kind:'income',memo:'sales',lines:[line('p1','bank',100000,0),line('p1','revenue',0,100000)]},
 {id:'sept-expense',date:'2026-09-07',kind:'expense',memo:'costs',lines:[line('p1','expense',90000,0),line('p1','bank',0,90000)]}
]};
const rows=monthlyOwnerAdvanceReport(w,'2026-08-01','2026-10-31',['p1'],true);
const aug=rows.find(r=>r.month==='2026-08'&&r.project==='p1');
const sep=rows.find(r=>r.month==='2026-09'&&r.project==='p1');
const oct=rows.find(r=>r.month==='2026-10'&&r.project==='p1');
const generalSep=rows.find(r=>r.month==='2026-09'&&!r.project);
assert.deepEqual([aug.revenue,aug.expense,aug.net,aug.operatingDeficit],[80000,130000,-50000,50000]);
assert.deepEqual([aug.advanceOpening,aug.advanceReceived,aug.advanceRepaid,aug.advanceClosing],[0,35000,0,35000]);
assert.deepEqual([aug.deficitFundedByMonthEnd,aug.deficitUncovered],[35000,15000]);
assert.deepEqual([sep.revenue,sep.expense,sep.net,sep.operatingDeficit],[100000,90000,10000,0]);
assert.deepEqual([sep.advanceOpening,sep.advanceReceived,sep.advanceRepaid,sep.advanceClosing],[35000,12000,20000,27000],
 'Later financing of an August loss moves September cash, but is not September operating revenue');
assert.deepEqual([oct.advanceOpening,oct.advanceReceived,oct.advanceRepaid,oct.advanceClosing],[27000,0,20000,7000],
 'Historic balance must ignore mutable record lifetime repaid and follow posted repayment dates');
assert.deepEqual([generalSep.advanceOpening,generalSep.advanceReceived,generalSep.advanceRepaid,generalSep.advanceClosing],[0,10000,0,10000]);
assert(rows.every(r=>r.advanceClosing===r.advanceOpening+r.advanceReceived-r.advanceRepaid),'Every monthly financing balance must reconcile');
assert.equal(monthlyOwnerAdvanceReport(w,'2026-08-01','2026-10-31',['p1'],false).filter(r=>!r.project).length,0,
 'Project-specific reporting must not attribute global unallocated owner loans');
const ui=fs.readFileSync('app/page.tsx','utf8');
assert(ui.includes('monthlyOwnerAdvanceReport(w,from,to'),'Live reporting must use dated financing selectors');
assert(ui.includes('monthlyOwnerAdvanceReport(fresh,from,to'),'Excel must reload audited workspace');
assert(ui.includes("name:'العجز وسلف المالك شهريًا'"),'Full Excel export must include owner advance monthly sheet');
assert(ui.includes('type="month" aria-label="شهر التقرير التشغيلي"'),'Report must support month selection');
console.log('Monthly project deficit, financing, repayment and historic-balance regression tests passed.');
