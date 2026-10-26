import {ownerCashMonth} from './owner-cash';
import {dayAdd,monthAdd,type Workspace} from './finance';
import {projectDescendantIds} from './project-portfolio';
/** Exact projects (including organizers), never parent rollups: every obligation is counted once. */
export function monthlyLiquidity(w:Workspace,month:string,scope:string,asOf:string){
 const start=month+'-01',end=dayAdd(monthAdd(start,1),-1),projects=w.records.filter(r=>r.kind==='project'&&r.data.mode!=='investment');
 const ids=scope==='all'?new Set(['',...projects.map(p=>p.id)]):new Set([scope,...projectDescendantIds(projects,scope)]);
 const personal=new Set(w.records.filter(r=>r.kind==='loan'&&r.data.holder==='personal').map(r=>r.id));
 const rows=[...ids].map(id=>{
  const cash=ownerCashMonth(w,month,id,asOf,false),dues=w.records.filter(r=>r.kind==='obligation'&&String(r.data.project||'')===id&&!personal.has(r.data.loan));
  const scheduled=dues.filter(r=>['paid','pending'].includes(r.data.status)&&r.data.date>=start&&r.data.date<=end);
  const expected=scheduled.filter(r=>r.data.direction==='in').reduce((n,r)=>n+Number(r.data.amount),0),obligations=scheduled.filter(r=>r.data.direction==='out').reduce((n,r)=>n+Number(r.data.amount),0);
  const deferred=dues.filter(r=>r.data.status==='replaced'&&r.data.direction==='in'&&r.data.date>=start&&r.data.date<=end&&r.data.deferredToDate).map(r=>({title:r.data.title,amount:Number(r.data.deferredAmount||r.data.amount),to:r.data.deferredToDate}));
  const advanced=w.records.filter(r=>r.kind==='deficitPayment'&&String(r.data.project||'')===id&&r.data.status!=='cancelled'&&r.data.date<=asOf&&(r.data.deficitMonth?r.data.deficitMonth===month:String(r.data.date).slice(0,7)===month)).reduce((n,r)=>n+Math.max(0,Number(r.data.amount)-w.records.filter(x=>x.kind==='ownerAdvanceRepayment'&&x.data.advanceId===r.id&&x.data.status!=='cancelled'&&x.data.date<start&&x.data.date<=asOf).reduce((sum,x)=>sum+Number(x.data.amount),0)),0);
  return {id,name:id?String(projects.find(p=>p.id===id)?.data.name||'مشروع'):'التزامات وسيولة عامة — غير مخصصة',expected,obligations,received:cash.received,paid:cash.paid,operatingPaid:cash.operatingPaid,pending:cash.monthPending,ownerRepaid:cash.ownerRepaid,advanced,deferred,details:scheduled.map(r=>({id:r.id,title:r.data.title,direction:r.data.direction,date:r.data.date,amount:Number(r.data.amount),status:r.data.status})),gap:cash.received+advanced-cash.paid-cash.monthPending-cash.ownerRepaid};
 });
 const totals=rows.reduce((n,r)=>({expected:n.expected+r.expected,received:n.received+r.received,obligations:n.obligations+r.obligations,paid:n.paid+r.paid,pending:n.pending+r.pending,advanced:n.advanced+r.advanced,ownerRepaid:n.ownerRepaid+r.ownerRepaid}),{expected:0,received:0,obligations:0,paid:0,pending:0,advanced:0,ownerRepaid:0});
 const cash=ownerCashMonth(w,month,scope,asOf);
 const after=totals.received+totals.advanced+cash.carryIn-cash.paid-cash.monthPending-cash.ownerRepaid-cash.withdrawn-cash.reinvested-cash.carryOut;
 const carries=w.records.filter(r=>r.kind==='monthCarryover'&&(r.data.month===month||r.data.targetMonth===month));
 return {month,rows,totals,cash,forecastAfter:totals.expected-totals.obligations+cash.carryIn+totals.advanced-cash.carryOut-cash.withdrawn-cash.reinvested-cash.ownerRepaid,forecast:totals.expected-totals.obligations,after,deficit:Math.max(0,-after),carries};
}
