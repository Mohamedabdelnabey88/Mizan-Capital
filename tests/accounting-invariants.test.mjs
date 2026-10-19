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

// Loan cash-flow classification: principal is financing; interest is operating expense.
const loanFlow=f.actualCashFlow(workspace,'p1','2026-01-01','2026-02-28');
const loanDay=loanFlow.rows.find(row=>row.date==='2026-02-01');
assert(loanDay,'loan settlement date must appear in cash flow');
assert.equal(loanDay.operatingOut,100000,'interest component is operating cash outflow');
assert.equal(loanDay.financingOut,1000000,'principal component is financing cash outflow');
assert.equal(loanFlow.rows.find(row=>row.date==='2026-01-01').financingIn,10000000,'loan proceeds are financing cash inflow');
assert.equal(loanFlow.closing,10400000,'cash flow closing agrees with cash and bank ledger');
assert.equal(loanFlow.rows.reduce((sum,row)=>sum+row.net,0),10400000,'cash-flow net change agrees with total cash movements');

// Reversal must neutralize the original cash and profit effects without deleting audit history.
const reversalWorkspace={records:[],audit:[],journals:[
  {id:'original-revenue',date:'2026-03-01',memo:'إيراد اختبار',kind:'income',lines:[
    {project:'p1',account:'cash',debit:12500,credit:0},
    {project:'p1',account:'revenue',debit:0,credit:12500}
  ]},
  {id:'reversal-revenue',date:'2026-03-02',memo:'عكس إيراد اختبار',kind:'reversal',reversal:'original-revenue',lines:[
    {project:'p1',account:'cash',debit:0,credit:12500},
    {project:'p1',account:'revenue',debit:12500,credit:0}
  ]}
]};
assert.equal(f.profit(reversalWorkspace,'p1','2026-03-01','2026-03-31').net,0,'reversal neutralizes revenue in the selected period');
assert.equal(f.balance(reversalWorkspace,'p1','2026-03-31').cash,0,'reversal restores cash balance');
assert.equal(f.actualCashFlow(reversalWorkspace,'p1','2026-03-01','2026-03-31').closing,0,'reversal neutralizes cash-flow closing');
assert.equal(reversalWorkspace.journals.length,2,'reversal preserves both original and reversing journals for auditability');

// Loan schedules must conserve principal exactly and never produce negative interest/principal.
for(const [principal,rate,months] of [[100001,0,7],[1234567,3.75,18],[987654321,9.99,60]]){
  const schedule=f.loanSchedule(principal,rate,months,'2026-01-31');
  assert.equal(schedule.reduce((sum,row)=>sum+row.principal,0),principal,'scheduled principal must reconcile exactly');
  assert(schedule.every(row=>row.principal>=0&&row.interest>=0&&row.amount===row.principal+row.interest),'loan schedule rows must contain nonnegative and internally consistent values');
  assert.equal(schedule.at(-1).date, f.monthAdd('2026-01-31',months-1),'loan schedule must preserve clamped month-end dates');
}

console.log('Accounting invariant tests passed: balanced journals, loan principal vs interest, profit isolation, forecast isolation, balance sheet, cash-flow reconciliation, inter-project funding, and invalid journal rejection.');
