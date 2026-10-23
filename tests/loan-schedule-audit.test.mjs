import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/finance.ts'],bundle:true,format:'esm',platform:'node',alias:{'@':process.cwd()},outfile:'.sites-runtime/loan-schedule-audit-finance.mjs'});
const {loanScheduleAudit}=await import('../.sites-runtime/loan-schedule-audit-finance.mjs');
const w={journals:[],audit:[],records:[
{id:'loan1',kind:'loan',version:1,data:{principal:10000,project:null}},
{id:'inst1',kind:'obligation',version:1,data:{loan:'loan1',status:'paid',date:'2026-01-01',principal:3000,interest:500,amount:3500}},
{id:'inst2',kind:'obligation',version:1,data:{loan:'loan1',status:'pending',date:'2026-02-01',principal:7000,interest:1000,amount:8000}},
{id:'allocation1',kind:'loanAllocation',version:1,data:{loanId:'loan1',amount:4000}}
]};
const a=loanScheduleAudit(w,'loan1','2026-03-01');
assert.deepEqual(a.mismatchedInstallmentIds,[]);
assert.equal(a.remainingPrincipal,7000);
assert.equal(a.totalInterest,1500);
assert.equal(a.paidInterest,500);
assert.equal(a.overdueAmount,8000);
assert.equal(a.unallocated,6000);
assert.equal(a.allocationIsEquity,false);
w.records[2].data.amount=8100;
assert.deepEqual(loanScheduleAudit(w,'loan1','2026-03-01').mismatchedInstallmentIds,['inst2']);
console.log('Loan schedule audit tests passed');

const ui=fs.readFileSync('app/page.tsx','utf8');
const api=fs.readFileSync('cloudflare/workspace.ts','utf8');
assert(ui.includes("select('loanId','مصدر التمويل المقترض (اختياري)'"),'project cost must expose loan source selector');
assert(api.includes("const linkedLoanId=String(p.loanId||'').trim()"),'posting tracks loan source explicitly');
assert(api.includes("priorLinked+amount>fundedHere"),'project funded cost cannot exceed assigned debt funding');
assert(api.includes("loanId:linkedLoanId"),'record retains source loan for audit');
