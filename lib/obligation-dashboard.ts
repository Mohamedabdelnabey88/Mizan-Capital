import {commitmentSummary,today,type Workspace} from './finance';

/** Obligation dashboard amounts in integer halalas.
 * The selected period is an accrual/schedule reporting window, NOT a forward cash-flow
 * simulation. Paid dues are classified by settlement date, pending by due date.
 */
export function obligationDashboard(w:Workspace,project:string,start:string,end:string,asOf=today()){
 const summary=commitmentSummary(w,project,start,end);
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
  totalScheduledReceivables:expectedInflows+settledInflows,
  totalScheduledPayables:expectedOutflows+settledOutflows,
  overdueInAmount:sum(overdueIn),overdueOutAmount:sum(overdueOut),
  overdueInCount:overdueIn.length,overdueOutCount:overdueOut.length,
  dueTodayInAmount:sum(dueTodayIn),dueTodayOutAmount:sum(dueTodayOut),
  futureInAmount:sum(futureIn),futureOutAmount:sum(futureOut),
  pendingNet:expectedInflows-expectedOutflows,
  settledNet:settledInflows-settledOutflows,
  periodNet:(expectedInflows+settledInflows)-(expectedOutflows+settledOutflows)
 };
}
