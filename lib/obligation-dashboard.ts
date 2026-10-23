import {commitmentSummary,today,type Workspace} from './finance';

/** Obligation dashboard amounts in integer halalas.
 * The selected period is an accrual/schedule reporting window, NOT a forward cash-flow
 * simulation. Paid dues are classified by settlement date, pending by due date.
 */
export function obligationDashboard(w:Workspace,project:string,start:string,end:string,asOf=today()){
 const summary=commitmentSummary(w,project,start,end);
 // Due-window totals and settlement-window totals are independent: a due paid in another month must not be counted as this month's scheduled collection.
 const dueRows=w.records.filter(r=>r.kind==='obligation'&&(project==='all'||r.data.project===project)&&!['cancelled','replaced'].includes(String(r.data.status||''))&&String(r.data.date||'')>=start&&String(r.data.date||'')<=end);
 const dueIncoming=dueRows.filter(r=>r.data.direction==='in'),dueOutgoing=dueRows.filter(r=>r.data.direction==='out');
 const sum=(rs:typeof summary.scheduledIn)=>rs.reduce((s,r)=>s+Math.max(0,Number(r.data.amount||0)),0);
 const inDue=summary.scheduledIn,outDue=summary.scheduledOut;
 const past=(d:unknown)=>String(d||'')<asOf;
 const overdueIn=inDue.filter(r=>past(r.data.date)),overdueOut=outDue.filter(r=>past(r.data.date));
 const dueTodayIn=inDue.filter(r=>String(r.data.date||'')===asOf),dueTodayOut=outDue.filter(r=>String(r.data.date||'')===asOf);
 const futureIn=inDue.filter(r=>String(r.data.date||'')>asOf),futureOut=outDue.filter(r=>String(r.data.date||'')>asOf);
 const expectedInflows=sum(inDue),expectedOutflows=sum(outDue);
 const settledInflows=sum(summary.settledIn),settledOutflows=sum(summary.settledOut);
 return {
  ...summary,expectedInflows,expectedOutflows,settledInflows,settledOutflows,
  totalScheduledReceivables:sum(dueIncoming),
  totalScheduledPayables:sum(dueOutgoing),
  dueIncomingCount:dueIncoming.length,dueOutgoingCount:dueOutgoing.length,
  // Explicit cross-period reconciliation: the user can inspect the exact installment(s)
  // that were paid in this window but scheduled for another window.
  incomingFromOtherPeriods:summary.settledIn.filter(r=>String(r.data.date||'')<start||String(r.data.date||'')>end),
  outgoingFromOtherPeriods:summary.settledOut.filter(r=>String(r.data.date||'')<start||String(r.data.date||'')>end),
  dueIncomingPaidElsewhere:dueIncoming.filter(r=>r.data.status==='paid'&&(String(r.data.paidOn||r.data.date)<start||String(r.data.paidOn||r.data.date)>end)),
  dueOutgoingPaidElsewhere:dueOutgoing.filter(r=>r.data.status==='paid'&&(String(r.data.paidOn||r.data.date)<start||String(r.data.paidOn||r.data.date)>end)),
  settledDueIncoming:sum(dueIncoming.filter(r=>r.data.status==='paid')),
  settledDueOutgoing:sum(dueOutgoing.filter(r=>r.data.status==='paid')),
  overdueInAmount:sum(overdueIn),overdueOutAmount:sum(overdueOut),
  overdueInCount:overdueIn.length,overdueOutCount:overdueOut.length,
  dueTodayInAmount:sum(dueTodayIn),dueTodayOutAmount:sum(dueTodayOut),
  futureInAmount:sum(futureIn),futureOutAmount:sum(futureOut),
  pendingNet:expectedInflows-expectedOutflows,
  settledNet:settledInflows-settledOutflows,
  periodNet:sum(dueIncoming)-sum(dueOutgoing)
 };
}
