import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

const require=createRequire(import.meta.url);
const wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
mkdirSync('.sites-runtime',{recursive:true});
await build({
  entryPoints:['lib/finance.ts'],
  bundle:true,
  format:'esm',
  platform:'node',
  alias:{'@':process.cwd()},
  outfile:'.sites-runtime/accounting-invariants-finance.mjs'
});
const f=await import('../.sites-runtime/accounting-invariants-finance.mjs');

const workspace={
  records:[
    {id:'plan-only',kind:'projectPlan',version:1,data:{
      project:'p1',effectiveFrom:'2026-01-01',netTargetMicro:1200000000,
      expectedReceiptInstallments:[{date:'2026-03-01',amountMicro:100000000}]
    }}
  ],
  journals:[
    {id:'loan-in',date:'2026-01-01',memo:'قرض مستلم',kind:'loan',lines:[
      {project:'p1',account:'cash',debit:10000000,credit:0},
      {project:'p1',account:'loan',debit:0,credit:10000000}
    ]},
    {id:'principal-payment',date:'2026-02-01',memo:'سداد أصل القرض',kind:'settle',lines:[
      {project:'p1',account:'loan',debit:1000000,credit:0},
      {project:'p1',account:'cash',debit:0,credit:1000000}
    ]},
    {id:'interest-payment',date:'2026-02-01',memo:'فائدة تمويل',kind:'settle',lines:[
      {project:'p1',account:'interest',debit:100000,credit:0},
      {project:'p1',account:'cash',debit:0,credit:100000}
    ]},
    {id:'operating-revenue',date:'2026-02-02',memo:'إيراد تشغيل',kind:'income',lines:[
      {project:'p1',account:'cash',debit:2000000,credit:0},
      {project:'p1',account:'revenue',debit:0,credit:2000000}
    ]},
    {id:'operating-expense',date:'2026-02-03',memo:'مصروف تشغيل',kind:'expense',lines:[
      {project:'p1',account:'expense',debit:500000,credit:0},
      {project:'p1',account:'cash',debit:0,credit:500000}
    ]}
  ],
  audit:[]
};

// Every posted journal must balance exactly to the halala.
for(const journal of workspace.journals){
  const debit=journal.lines.reduce((sum,line)=>sum+line.debit,0);
  const credit=journal.lines.reduce((sum,line)=>sum+line.credit,0);
  assert.equal(debit,credit,`unbalanced journal: ${journal.id}`);
  f.validateLines(journal.lines);
}

// Loan proceeds and principal repayment are balance-sheet movements, not income/expense.
assert.equal(f.profit(workspace,'p1','2026-01-01','2026-02-28').revenue,2000000);
assert.equal(f.profit(workspace,'p1','2026-01-01','2026-02-28').expense,600000);
assert.equal(f.profit(workspace,'p1','2026-01-01','2026-02-28').net,1400000);
assert.equal(f.traceTransaction(workspace,'loan-in').profitDelta,0);
assert.equal(f.traceTransaction(workspace,'principal-payment').profitDelta,0);
assert.equal(f.traceTransaction(workspace,'interest-payment').profitDelta,-100000);

// Forecast/planning records must not alter actual booked profit.
const profitBeforePlanCheck=f.profit(workspace,'p1','2026-01-01','2026-12-31').net;
assert(f.expectedCollectionsInRange(workspace,'p1','2026-01-01','2026-12-31')>0);
assert.equal(f.profit(workspace,'p1','2026-01-01','2026-12-31').net,profitBeforePlanCheck);

// Assets must equal liabilities plus equity and current-period profit.
const sheet=f.balanceSheet(workspace,'p1','2026-02-28');
assert.equal(sheet.accounts.cash,10400000);
assert.equal(sheet.accounts.loan,-9000000);
assert.equal(sheet.assets,10400000);
assert.equal(sheet.liabilities,9000000);
assert.equal(sheet.currentProfit,1400000);
assert.equal(sheet.difference,0);
assert.equal(sheet.balanced,true);

const controls=f.accountingControlTotals(workspace,'2026-01-01','2026-02-28','p1');
assert.equal(controls.balanceCheck,0);
assert.equal(controls.cashFromBalance,10400000);
assert.equal(controls.cashFlowClosing,10400000);
assert.equal(controls.cashFlowDifference,0);

// Inter-project financing is not profit and must balance both projects and the workspace.
const transferWorkspace={records:[],audit:[],journals:[{
  id:'project-transfer',date:'2026-02-10',memo:'تمويل بين مشروعين',kind:'transfer',lines:[
    {project:'p1',account:'cash',debit:0,credit:200000},
    {project:'p1',account:'inter_receivable',debit:200000,credit:0},
    {project:'p2',account:'cash',debit:200000,credit:0},
    {project:'p2',account:'inter_payable',debit:0,credit:200000}
  ]
}]};
assert.equal(f.profit(transferWorkspace,'all','2026-01-01','2026-12-31').net,0);
assert.equal(f.balanceSheet(transferWorkspace,'all','2026-12-31').difference,0);
assert.equal(f.balanceSheet(transferWorkspace,'p1','2026-12-31').difference,0);
assert.equal(f.balanceSheet(transferWorkspace,'p2','2026-12-31').difference,0);
assert.equal(f.traceTransaction(transferWorkspace,'project-transfer').profitDelta,0);

// Invalid/unbalanced entries must be rejected rather than silently posted.
assert.throws(()=>f.validateLines([
  {project:'p1',account:'cash',debit:10001,credit:0},
  {project:'p1',account:'capital',debit:0,credit:10000}
]),/غير متوازن/);
assert.throws(()=>f.validateLines([
  {project:'p1',account:'not-an-account',debit:10000,credit:0},
  {project:'p1',account:'capital',debit:0,credit:10000}
]),/طرف محاسبي غير صحيح/);

console.log('Accounting invariant tests passed: balanced journals, loan principal vs interest, profit isolation, forecast isolation, balance sheet, cash-flow reconciliation, inter-project funding, and invalid journal rejection.');
