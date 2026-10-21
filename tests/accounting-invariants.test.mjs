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
await build({
  entryPoints:['lib/project-performance.ts'],
  bundle:true,
  format:'esm',
  platform:'node',
  alias:{'@':process.cwd()},
  outfile:'.sites-runtime/accounting-invariants-project-performance.mjs'
});
const f=await import('../.sites-runtime/accounting-invariants-finance.mjs');
const performance=await import('../.sites-runtime/accounting-invariants-project-performance.mjs');

// Credit-normal ledger accounts are stored as debit-minus-credit, but must display with their natural sign.
assert.equal(f.normalBalance('capital',-125000),125000,'a normal owner-capital credit balance must display as positive capital');
assert.equal(f.normalBalance('capital',125000),-125000,'a true debit balance in owner capital must remain visibly negative');
assert.equal(f.normalBalance('loan',-90000),90000,'a normal loan liability credit balance must display as positive liability');
assert.equal(f.normalBalance('distribution',125000),125000,'owner distributions retain their debit-normal sign');

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

// A future-dated plan must not rewrite earlier forecast periods; plans switch on effectiveFrom.
const planWindowWorkspace={records:[
  {id:'plan-current',kind:'projectPlan',version:1,created:'2026-01-01T00:00:00Z',data:{
    project:'p1',effectiveFrom:'2026-01-01',
    expectedReceiptInstallments:[{date:'2026-01-15',amountMicro:100000000}]
  }},
  {id:'plan-future',kind:'projectPlan',version:1,created:'2026-01-20T00:00:00Z',data:{
    project:'p1',effectiveFrom:'2026-02-01',
    expectedReceiptInstallments:[
      {date:'2026-01-20',amountMicro:900000000},
      {date:'2026-02-15',amountMicro:200000000}
    ]
  }}
],journals:[],audit:[]};
assert.equal(f.expectedCollectionsInRange(planWindowWorkspace,'p1','2026-01-01','2026-01-31'),100000,'future plan must not change expected collections before its effective date');
assert.equal(f.expectedCollectionsInRange(planWindowWorkspace,'p1','2026-02-01','2026-02-28'),200000,'active plan contributes receipts in its effective window');
assert.equal(f.expectedCollectionsInRange(planWindowWorkspace,'p1','2026-01-01','2026-02-28'),300000,'range spanning plan versions includes each plan only in its active window');
const planForecast=f.forecast(planWindowWorkspace,'p1',0,0,0,0,'2026-01-10');
assert.equal(planForecast.days.find(day=>day.date==='2026-01-15').income,100000,'forecast retains the earlier plan until replacement becomes effective');
assert.equal(planForecast.days.find(day=>day.date==='2026-01-20').income,0,'forecast excludes receipts dated before the new plan effective date');
assert.equal(planForecast.days.find(day=>day.date==='2026-02-15').income,200000,'forecast applies the new plan after its effective date');
assert.equal(f.profit(planWindowWorkspace,'p1','2026-01-01','2026-12-31').net,0,'forecast plans must never be booked as actual profit');

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
const reversedCashFlow=f.actualCashFlow(reversalWorkspace,'p1','2026-03-01','2026-03-31');
assert.equal(reversedCashFlow.closing,0,'reversal neutralizes cash-flow closing');
assert.equal(reversedCashFlow.rows.find(row=>row.date==='2026-03-01').operatingIn,12500,'original revenue is classified as operating inflow');
assert.equal(reversedCashFlow.rows.find(row=>row.date==='2026-03-02').operatingOut,12500,'reversed revenue must reverse the same operating category');
assert.equal(reversedCashFlow.rows.find(row=>row.date==='2026-03-02').otherOut,0,'reversed revenue must not be misclassified as other cash outflow');
assert.equal(reversalWorkspace.journals.length,2,'reversal preserves both original and reversing journals for auditability');

// Reversing a loan installment must reverse principal and interest in their original cash-flow categories.
const reversedLoanSettlement={records:[],audit:[],journals:[
  {id:'loan-settlement',date:'2026-04-01',memo:'قسط قرض',kind:'settle',lines:[
    {project:'p1',account:'loan',debit:1000000,credit:0},
    {project:'p1',account:'interest',debit:100000,credit:0},
    {project:'p1',account:'cash',debit:0,credit:1100000}
  ]},
  {id:'loan-settlement-reversal',date:'2026-04-02',memo:'عكس قسط قرض',kind:'reversal',reversal:'loan-settlement',lines:[
    {project:'p1',account:'loan',debit:0,credit:1000000},
    {project:'p1',account:'interest',debit:0,credit:100000},
    {project:'p1',account:'cash',debit:1100000,credit:0}
  ]}
]};
const reversedLoanFlow=f.actualCashFlow(reversedLoanSettlement,'p1','2026-04-01','2026-04-30');
const originalLoanPayment=reversedLoanFlow.rows.find(row=>row.date==='2026-04-01');
const reversedLoanPayment=reversedLoanFlow.rows.find(row=>row.date==='2026-04-02');
assert.equal(originalLoanPayment.operatingOut,100000,'original loan interest is operating outflow');
assert.equal(originalLoanPayment.financingOut,1000000,'original loan principal is financing outflow');
assert.equal(reversedLoanPayment.operatingIn,100000,'reversed loan interest is operating inflow');
assert.equal(reversedLoanPayment.financingIn,1000000,'reversed loan principal is financing inflow');
assert.equal(reversedLoanPayment.otherIn,0,'reversed loan payment must not be misclassified as other inflow');
assert.equal(reversedLoanFlow.closing,0,'reversed loan settlement nets to zero cash movement');

// Loan schedules must conserve principal exactly and never produce negative interest/principal.
for(const [principal,rate,months] of [[100001,0,7],[1234567,3.75,18],[987654321,9.99,60]]){
  const schedule=f.loanSchedule(principal,rate,months,'2026-01-31');
  assert.equal(schedule.reduce((sum,row)=>sum+row.principal,0),principal,'scheduled principal must reconcile exactly');
  assert(schedule.every(row=>row.principal>=0&&row.interest>=0&&row.amount===row.principal+row.interest),'loan schedule rows must contain nonnegative and internally consistent values');
  assert.equal(schedule.at(-1).date, f.monthAdd('2026-01-31',months-1),'loan schedule must preserve clamped month-end dates');
}

// Project revenue forecast must extrapolate the average across reported days to the full selected period.
const performanceWorkspace={
  records:[
    {id:'forecast-project',kind:'project',version:1,data:{name:'Forecast project',mode:'operating'}},
    {id:'forecast-plan',kind:'projectPlan',version:1,data:{
      project:'forecast-project',effectiveFrom:'2026-01-01',
      revenueDailyMicro:0, revenueMonthlyMicro:0,
      expenseDailyMicro:100000, expenseMonthlyMicro:0,
      netDailyMicro:0, netMonthlyMicro:0
    }}
  ],
  journals:[
    {id:'daily-1',date:'2026-01-01',kind:'dailyReport',memo:'daily 1',lines:[
      {project:'forecast-project',account:'cash',debit:1000,credit:0},
      {project:'forecast-project',account:'revenue',debit:0,credit:1000}
    ]},
    {id:'daily-2',date:'2026-01-02',kind:'dailyReport',memo:'daily 2',lines:[
      {project:'forecast-project',account:'cash',debit:1000,credit:0},
      {project:'forecast-project',account:'revenue',debit:0,credit:1000}
    ]}
  ],
  audit:[]
};
const projectForecast=performance.projectPerformance(performanceWorkspace,'forecast-project','2026-01-01','2026-01-10');
assert.equal(projectForecast.reportedDays,2);
assert.equal(projectForecast.actualRevenueMicro,2000000);
assert.equal(projectForecast.forecastRevenueMicro,10000000,'forecast must multiply average reported-day revenue by the full 10-day period');
assert.equal(projectForecast.expectedExpenseMicro,1000000);
assert.equal(projectForecast.forecastNetMicro,9000000,'forecast net must subtract the selected-period planned expenses from forecast revenue');

// Project cost cash flow follows accounting treatment: operating expense vs capitalized project asset.
const projectCostFlowWorkspace={records:[],audit:[],journals:[
  {id:'project-cost-expense',date:'2026-05-01',memo:'مصروف مشروع',kind:'projectCost',source:'project-cost:expense',lines:[
    {project:'p1',account:'expense',debit:10000,credit:0},
    {project:'p1',account:'cash',debit:0,credit:10000}
  ]},
  {id:'project-cost-asset',date:'2026-05-02',memo:'أصل مشروع',kind:'projectCost',source:'project-cost:asset',lines:[
    {project:'p1',account:'investment',debit:20000,credit:0},
    {project:'p1',account:'bank',debit:0,credit:20000}
  ]}
]};
const projectCostCashFlow=f.actualCashFlow(projectCostFlowWorkspace,'p1','2026-05-01','2026-05-31');
assert.equal(projectCostCashFlow.rows.find(row=>row.date==='2026-05-01').operatingOut,10000,'expense-treated project cost must be operating cash outflow');
assert.equal(projectCostCashFlow.rows.find(row=>row.date==='2026-05-01').otherOut,0,'expense-treated project cost must not be classified as other outflow');
assert.equal(projectCostCashFlow.rows.find(row=>row.date==='2026-05-02').investingOut,20000,'capitalized project cost must be investing cash outflow');
assert.equal(projectCostCashFlow.rows.find(row=>row.date==='2026-05-02').otherOut,0,'capitalized project cost must not be classified as other outflow');

console.log('Accounting invariant tests passed: balanced journals, loan principal vs interest, profit isolation, forecast isolation, balance sheet, cash-flow reconciliation, inter-project funding, and invalid journal rejection.');

// Owner-funded deficit coverage is a repayable liability, not income, capital, or profit.
const ownerAdvanceWorkspace={records:[],audit:[],journals:[
 {id:'loss',date:'2026-06-05',memo:'مصروف تشغيل',kind:'expense',source:'loss',lines:[{project:'p1',account:'expense',debit:300000,credit:0},{project:'p1',account:'cash',debit:0,credit:300000}]},
 {id:'advance',date:'2026-06-06',memo:'تغطية عجز',kind:'deficitPayment',source:'deficitPayment:a1',lines:[{project:'p1',account:'cash',debit:300000,credit:0},{project:'p1',account:'owner_advance',debit:0,credit:300000}]},
 {id:'repay',date:'2026-06-10',memo:'رد جزء من السلفة',kind:'repayOwnerAdvance',source:'ownerAdvanceRepayment:r1',lines:[{project:'p1',account:'owner_advance',debit:100000,credit:0},{project:'p1',account:'cash',debit:0,credit:100000}]}
]};
assert.equal(f.profit(ownerAdvanceWorkspace,'p1','2026-06-01','2026-06-30').net,-300000,'owner deficit advance and repayment must not affect operating profit');
assert.equal(f.balance(ownerAdvanceWorkspace,'p1','2026-06-05').cash,-300000,'balance as of date excludes later cash movements');
assert.equal(f.balance(ownerAdvanceWorkspace,'p1','2026-06-06').owner_advance,-300000,'owner advance is a credit-normal liability');
assert.equal(f.balance(ownerAdvanceWorkspace,'p1','2026-06-10').owner_advance,-200000,'repayment reduces the liability balance');
assert.equal(f.normalBalance('owner_advance',f.balance(ownerAdvanceWorkspace,'p1','2026-06-10').owner_advance),200000,'liability display converts credit balance to a positive amount');
