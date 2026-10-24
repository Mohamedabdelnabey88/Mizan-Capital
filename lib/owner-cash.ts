import {balance,dayAdd,monthAdd,type Workspace} from './finance';

export type OwnerCashAllocation={project:string;amount:number};
/** Cash surplus is separate from accounting profit. Values are integer halalas. */
export function ownerCashMonth(w:Workspace,month:string,scope='all',asOf:string){
 const start=month+'-01',end=dayAdd(monthAdd(start,1),-1),cutoff=end<asOf?end:asOf;
 const personalLoans=new Set(w.records.filter(r=>r.kind==='loan'&&r.data.holder==='personal').map(r=>r.id));
 const journals=new Map(w.journals.map(j=>[j.id,j]));
 const withdrawals=new Map(w.records.filter(r=>r.kind==='ownerCashWithdrawal').map(r=>['owner-cash:'+r.id,r]));
 const calculate=(project:string)=>{
  let received=0,paid=0,withdrawn=0;
  for(const j of w.journals){
   if(j.date>asOf)continue;
   const original=j.reversal?journals.get(j.reversal):j;
   const withdrawal=withdrawals.get(original?.source||'');
   if(withdrawal){
    if(withdrawal.data.month===month)withdrawn+=j.lines.filter(l=>(project==='all'||l.project===project)&&l.account==='distribution').reduce((n,l)=>n+l.debit-l.credit,0);
    continue;
   }
   if(j.date<start||j.date>cutoff)continue;
   const lines=j.lines.filter(l=>project==='all'||l.project===project);
   const cashNet=lines.filter(l=>l.account==='cash'||l.account==='bank').reduce((n,l)=>n+l.debit-l.credit,0);
   // Reversals undo the original category, rather than becoming new receipts.
   const sign=j.reversal?-1:1,normalNet=cashNet*sign,kind=original?.kind||j.kind;
   const collection=['income','collect','dailyReport','cardSettlement','settle','dividend'].includes(kind);
   const income=lines.filter(l=>l.account==='revenue'||l.account==='dividend').reduce((n,l)=>n+l.credit-l.debit,0)*sign;
   if(normalNet>0)received+=(collection?normalNet:Math.min(normalNet,Math.max(0,income)))*sign;
   else if(normalNet<0)paid+=-normalNet*sign;
  }
  const pendingItems=w.records.filter(r=>r.kind==='obligation'&&r.data.status==='pending'&&r.data.direction==='out'&&!personalLoans.has(r.data.loan)&&(project==='all'||r.data.project===project));
  const pending=pendingItems.filter(r=>r.data.date<=end).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const currentEnd=dayAdd(monthAdd(asOf.slice(0,7)+'-01',1),-1),cashPending=pendingItems.filter(r=>r.data.date<=(end>currentEnd?end:currentEnd)).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const reserve=w.records.filter(r=>r.kind==='project'&&(project==='all'||r.id===project)).reduce((n,r)=>n+Math.max(0,Number(r.data.reserve||0)),0);
  const b=balance(w,project,asOf),cash=(b.cash||0)+(b.bank||0);
  const surplus=received-paid,remaining=Math.max(0,surplus-pending-withdrawn);
  return {received,paid,pending,withdrawn,surplus,remaining,cash,reserve,cashLimit:Math.max(0,cash-cashPending-reserve)};
 };
 const totals=calculate(scope),global=scope==='all'?totals:calculate('all');
 const available=start>asOf?0:Math.max(0,Math.min(totals.remaining,totals.cashLimit,global.remaining,global.cashLimit));
 const records=w.records.filter(r=>r.kind==='ownerCashWithdrawal'&&r.data.month===month&&(scope==='all'||(r.data.allocations as OwnerCashAllocation[]||[]).some(a=>a.project===scope)));
 return {month,start,end,cutoff,...totals,available,globalRemaining:global.remaining,records};
}

/** Identify actual funded accounts without allowing a withdrawal to consume reserves or pending dues. */
export function ownerCashSources(w:Workspace,month:string,scope:string,asOf:string,account:string){
 const ids=scope==='all'?[...new Set(['',...w.records.filter(r=>r.kind==='project'&&(r.data.mode||'operating')!=='investment'&&r.data.status!=='archived').map(r=>r.id)])]:[scope];
 return ids.map(project=>{const b=balance(w,project,asOf),s=ownerCashMonth(w,month,project,asOf);return {project,available:Math.max(0,Math.min(b[account]||0,s.cashLimit))};}).filter(x=>x.available>0);
}
