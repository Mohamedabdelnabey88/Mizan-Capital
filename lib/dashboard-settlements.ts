import {actualCashFlow,dayAdd,type Workspace} from './finance';

/** Due dates define the window; paid dates define executed cash movements. Amounts in halalas. */
export function dashboardSettlements(w:Workspace,project:string,start:string,end:string,asOf:string){
 const windowEnd=dayAdd(asOf,30);
 const dues=w.records.filter(r=>r.kind==='obligation'&&(project==='all'||r.data.project===project)&&r.data.direction==='out'&&['pending','paid'].includes(r.data.status)&&r.data.date>=asOf&&r.data.date<=windowEnd);
 const pending=dues.filter(r=>r.data.status==='pending'),paid=dues.filter(r=>r.data.status==='paid');
 const sum=(items:typeof dues)=>items.reduce((s,r)=>s+Number(r.data.amount||0),0);
 const cashflow=actualCashFlow(w,project,start,end);
 let loanCashPaid=0,interestExpense=0;
 for(const j of w.journals){
  if(j.date<start||j.date>end)continue;
  const original=j.kind==='reversal'&&j.reversal?w.journals.find(x=>x.id===j.reversal):j;
  const loanPayment=['settle','prepay'].includes(original?.kind||'')&&j.lines.some(l=>['loan','personal_loan','interest'].includes(l.account));
  for(const l of j.lines){
   if(project!=='all'&&l.project!==project)continue;
   if(l.account==='interest')interestExpense+=l.debit-l.credit;
   if(loanPayment&&['cash','bank'].includes(l.account))loanCashPaid+=l.credit-l.debit;
  }
 }
 return {windowEnd,pending,paid,remaining:sum(pending),paidAmount:sum(paid),scheduled:sum(dues),cashflow,loanCashPaid,interestExpense};
}
