import {projectDescendantIds} from './project-portfolio';
import {balance,dayAdd,monthAdd,type Workspace} from './finance';

export type OwnerCashAllocation={project:string;amount:number};
/** Cash surplus is separate from accounting profit. Values are integer halalas. */
export function ownerCashMonth(w:Workspace,month:string,scope='all',asOf:string,includeBranches=true){
 const start=month+'-01',end=dayAdd(monthAdd(start,1),-1),cutoff=end<asOf?end:asOf;
 const personalLoans=new Set(w.records.filter(r=>r.kind==='loan'&&r.data.holder==='personal').map(r=>r.id));
 const journals=new Map(w.journals.map(j=>[j.id,j]));
 const withdrawals=new Map(w.records.filter(r=>r.kind==='ownerCashWithdrawal').map(r=>['owner-cash:'+r.id,r]));
 const reinvestments=new Map(w.records.filter(r=>r.kind==='surplusReinvestment').map(r=>['surplus-reinvestment:'+r.id,r]));
 const projects=w.records.filter(r=>r.kind==='project');
 const projectIds=(project:string)=>project==='all'?undefined:new Set([project,...(includeBranches?projectDescendantIds(projects,project):[])]);
 const calculate=(project:string)=>{
  const selectedIds=projectIds(project),matches=(id:string)=>!selectedIds||selectedIds.has(id);
  let received=0,paid=0,withdrawn=0,reinvested=0;
  const receipts:{journalId:string;project:string;amount:number}[]=[];
  for(const j of w.journals){
   if(j.date>asOf)continue;
   const original=j.reversal?journals.get(j.reversal):j;
   const withdrawal=withdrawals.get(original?.source||'');
   const reinvestment=reinvestments.get(original?.source||'');
   if(reinvestment){
    if(reinvestment.data.month===month)for(const allocation of reinvestment.data.allocations as OwnerCashAllocation[]){
     if(!matches(allocation.project))continue;
     reinvested+=j.lines.filter(l=>l.project===allocation.project&&l.account===reinvestment.data.paymentAccount).reduce((n,l)=>n+l.credit-l.debit,0);
    }
    continue;
   }
   if(withdrawal){
    if(withdrawal.data.month===month)withdrawn+=j.lines.filter(l=>matches(l.project)&&l.account==='distribution').reduce((n,l)=>n+l.debit-l.credit,0);
    continue;
   }
   if(j.date<start||j.date>cutoff)continue;
   const lines=j.lines.filter(l=>matches(l.project));
   const cashNet=lines.filter(l=>l.account==='cash'||l.account==='bank').reduce((n,l)=>n+l.debit-l.credit,0);
   // Reversals undo the original category, rather than becoming new receipts.
   const sign=j.reversal?-1:1,normalNet=cashNet*sign,kind=original?.kind||j.kind;
   const collection=['income','collect','dailyReport','cardSettlement','settle','dividend'].includes(kind);
   const income=lines.filter(l=>l.account==='revenue'||l.account==='dividend').reduce((n,l)=>n+l.credit-l.debit,0)*sign;
   if(normalNet>0){const amount=(collection?normalNet:Math.min(normalNet,Math.max(0,income)))*sign;received+=amount;if(amount>0)receipts.push({journalId:j.id,project:lines.find(l=>['cash','bank'].includes(l.account)&&l.debit>0)?.project||'',amount});}
   else if(normalNet<0)paid+=-normalNet*sign;
  }
  const pendingItems=w.records.filter(r=>r.kind==='obligation'&&r.data.status==='pending'&&r.data.direction==='out'&&!personalLoans.has(r.data.loan)&&matches(String(r.data.project||'')));
  const pending=pendingItems.filter(r=>r.data.date<=end).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const currentEnd=dayAdd(monthAdd(asOf.slice(0,7)+'-01',1),-1),cashPending=pendingItems.filter(r=>r.data.date<=(end>currentEnd?end:currentEnd)).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const reserve=w.records.filter(r=>r.kind==='project'&&matches(r.id)).reduce((n,r)=>n+Math.max(0,Number(r.data.reserve||0)),0);
  const cash=w.journals.filter(j=>j.date<=asOf).flatMap(j=>j.lines).filter(l=>matches(l.project)&&['cash','bank'].includes(l.account)).reduce((n,l)=>n+l.debit-l.credit,0);
  const surplus=received-paid,remaining=Math.max(0,surplus-pending-withdrawn-reinvested);
  return {received,paid,pending,withdrawn,reinvested,receipts,surplus,remaining,cash,reserve,cashLimit:Math.max(0,cash-cashPending-reserve)};
 };
 const totals=calculate(scope),global=scope==='all'?totals:calculate('all');
 const available=start>asOf?0:Math.max(0,Math.min(totals.remaining,totals.cashLimit,global.remaining,global.cashLimit));
 const records=w.records.filter(r=>['ownerCashWithdrawal','surplusReinvestment'].includes(r.kind)&&r.data.month===month&&(scope==='all'||(r.data.allocations as OwnerCashAllocation[]||[]).some(a=>projectIds(scope)?.has(a.project))));
 return {month,start,end,cutoff,scopeProjectIds:scope==='all'?['',...projects.map(r=>r.id)]:[...projectIds(scope)!],scopeProjectCount:projectIds(scope)?.size||projects.length,...totals,available,globalRemaining:global.remaining,records};
}

/** Identify actual funded accounts without allowing a withdrawal to consume reserves or pending dues. */
export function ownerCashSources(w:Workspace,month:string,scope:string,asOf:string,account:string){
 const projects=w.records.filter(r=>r.kind==='project');
 const candidates=scope==='all'?['',...projects.map(r=>r.id)]:[scope,...projectDescendantIds(projects,scope)];
 const ids=[...new Set(candidates)].filter(id=>!id||projects.some(r=>r.id===id&&(r.data.mode||'operating')!=='investment'&&r.data.status!=='archived'));
 return ids.map(project=>{const b=balance(w,project,asOf),s=ownerCashMonth(w,month,project,asOf,false);return {project,available:Math.max(0,Math.min(b[account]||0,s.cashLimit))};}).filter(x=>x.available>0);
}
