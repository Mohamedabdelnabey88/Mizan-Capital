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
assert.equal(v.totalScheduledReceivables,42000,'Due-month total must exclude receivables from September paid in October');
assert.equal(v.totalScheduledPayables,25000,'Due-month payable total must exclude September bills settled in October');
assert.equal(v.dueIncomingCount,2);
assert.equal(v.overdueInAmount,12000);
assert.equal(v.overdueOutAmount,8000);
assert.equal(v.dueTodayOutAmount,5000,'Due today must not be classified overdue');
assert.equal(v.overdueOutCount,1);
assert.equal(v.futureOutAmount,12000);
assert.equal(v.incomingFromOtherPeriods.length,1,'September installment paid in October must be clearly disclosed');
assert.equal(v.incomingFromOtherPeriods[0].id,'paid-in');
assert.equal(v.outgoingFromOtherPeriods.length,1,'September bill paid in October must be traceable');
assert.equal(v.settledNet,14000,'Actual settlements are paid in minus paid out, not minus unpaid obligations');
assert.equal(v.pendingNet,17000,'Scheduled remaining is expected in minus expected out, without settled dues');
assert.equal(v.periodNet,17000,'Due-month net excludes settlements of previous months');
w.records.push(due('october-paid-next-month','2026-10-28','in',7000,'paid','2026-11-02'));
const v2=obligationDashboard(w,'p1','2026-10-01','2026-10-31','2026-10-22');
assert.equal(v2.totalScheduledReceivables,49000,'October due paid in November still belongs to October due total');
assert.equal(v2.settledInflows,20000,'November receipt must not increase October cash receipts');
assert.equal(v2.settledDueIncoming,7000,'Paid portion of October due dates is tracked separately');
assert.equal(v2.dueIncomingPaidElsewhere.length,1,'Due in October paid in November must be traceable');
w.records.push(due('deferred-in','2026-10-05','in',999000,'deferred'));
const afterDeferral=obligationDashboard(w,'p1','2026-10-01','2026-10-31','2026-10-22');
assert.equal(afterDeferral.totalScheduledReceivables,49000,'Deferred original installments must not inflate due-month totals');
assert.equal(afterDeferral.totalScheduledReceivables,afterDeferral.settledDueIncoming+afterDeferral.expectedInflows,'Monthly due receipts must reconcile exactly to paid portion plus pending portion');
const ui=fs.readFileSync('app/page.tsx','utf8'),css=fs.readFileSync('app/globals.css','utf8');
assert(ui.includes("summary=obligationDashboard(w,scope,range.start,range.end)"));
assert(ui.includes("actualAfterCommitments=summary.settledNet"));
assert(ui.includes("expectedAfterCommitments=summary.pendingNet"));
assert(!ui.includes('projectedClosingLiquidity'),'No invented cash forecast from current balance plus already-settled schedules');
assert(ui.includes('مدفوعات متأخرة')&&ui.includes('summary.overdueOutAmount'));
assert(ui.includes('لماذا تختلف التحصيلات الفعلية عن استحقاقات الفترة؟'),'Reconciliation table must appear');
assert(ui.includes('calendar-month-summary'),'Calendar must summarize unpaid and paid dues');
assert(ui.includes('calendar-paid-details'),'Calendar must show itemized paid installments directly');
assert(ui.includes('settlementDrilldownRef.current=true'),'Calendar-to-obligations navigation must select the paid detail section');
assert(ui.includes('commitment-settlement-details'),'Destination paid detail must be addressable');
assert(ui.includes('calSettledThisMonth=ob.filter'),'Actual paid calendar total must rely on actual settlement month');
assert(ui.includes("o.data.status==='paid'?pretty(String(o.data.paidOn||o.data.date)):'—'"),'Calendar detail must show actual payment date');
assert(css.includes('.calendar-month-summary'),'Calendar summary must be responsive');
assert(css.includes('.commitment-kpi-grid')&&css.includes('@media(max-width:720px){.commitment-page-intro'));
assert(ui.includes('className="commitment-deficit-headline"'),'Operating deficit must be prominent at top of commitments page');
assert(ui.includes('<Money value={deficitTotal}/>'),'Headline must use reconciled operating deficit total');
assert(ui.indexOf('className="commitment-deficit-headline"')<ui.indexOf('<Panel title="دفع العجز — سلف مستحقة للمالك"'),'Deficit KPI must appear before detail cards');
assert(ui.includes("String(x.data.date||'')<=to).reduce((s,x)=>s+Math.max(0,Number(x.data.amount||0)),0)"),'Later funding must not be counted as already received within historical report');
assert(css.includes('.commitment-deficit-headline'),'Deficit headline must be styled');
const workspaceCode=fs.readFileSync('cloudflare/workspace.ts','utf8');
const undoStart=workspaceCode.indexOf("else if(action==='undoInstallmentPayment')");
const undoEnd=workspaceCode.indexOf("else if(action==='settleLoans')",undoStart);
assert(undoStart>=0&&undoEnd>undoStart,'Dedicated undo payment handler');
const undo=workspaceCode.slice(undoStart,undoEnd);
for(const safeguard of ["d.status!=='paid'","reason.trim().length<6","closedThrough","installmentPaymentHistory(w,r).filter(j=>!j.reversed)","j.lines.map(l=>({...l,debit:l.credit,credit:l.debit}))","status:'pending'","status:'cancelled'","remainingAmount:pending+Number(d.amount||0)","installments"]){assert(undo.includes(safeguard),'Missing undo safeguard: '+safeguard);}
assert(ui.includes("modal==='undoInstallmentPayment'"),'Undo modal exists');
assert(ui.includes("التراجع عن السداد"),'Undo reachable from paid settlements');
console.log('Commitment dashboard accurate paid/due/overdue reconciliations passed.');
