import {projectDescendantIds} from './project-portfolio';
import {balance,dayAdd,monthAdd,type Workspace} from './finance';

export type MonthlyCashEntry={journalId:string;date:string;memo:string;projects:string[];category:'receipt'|'operating'|'installment'|'capital'|'funding'|'owner';amount:number;dueDate?:string};
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
  let received=0,paid=0,operatingPaid=0,installmentsPaid=0,capitalPaid=0,fundingReceived=0,priorInstallmentsPaid=0,withdrawn=0,reinvested=0;
  const entries:MonthlyCashEntry[]=[];
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
   const entry=(category:MonthlyCashEntry['category'],amount:number,dueDate?:string)=>{if(amount)entries.push({journalId:j.id,date:j.date,memo:j.memo,projects:[...new Set(lines.filter(l=>['cash','bank'].includes(l.account)).map(l=>l.project))],category,amount,dueDate});};
   if(normalNet>0){
    const eligible=collection?normalNet:Math.min(normalNet,Math.max(0,income)),amount=eligible*sign;received+=amount;entry('receipt',amount);
    const financing=(normalNet-eligible)*sign;fundingReceived+=financing;entry('funding',financing);
    if(amount>0)receipts.push({journalId:j.id,project:lines.find(l=>['cash','bank'].includes(l.account)&&l.debit>0)?.project||'',amount});
   }else if(normalNet<0){
    const amount=-normalNet*sign,source=original?.source||'',linkedId=source.split(':')[1];
    const linked=w.records.find(r=>r.id===linkedId),due=linked?.kind==='obligation'?linked:linked?.data.sourceObligation?w.records.find(r=>r.id===linked.data.sourceObligation):undefined;
    const installment=['settle','prepay'].includes(kind)||!!due;
    const capital=['asset','projectAsset','invest','investmentStart','investmentReturn','returnCapital','transfer','repayTransfer','fundingRepayment','loan','loanAdjustment'].includes(kind)||source.startsWith('loan-use:')||lines.some(l=>['fixed','investment'].includes(l.account)&&(l.debit-l.credit)*sign>0);
    if(['distribution','annualOwnerDistribution'].includes(kind)){withdrawn+=amount;entry('owner',amount);}
    else if(installment){installmentsPaid+=amount;if(due?.data.date<start)priorInstallmentsPaid+=amount;entry('installment',amount,due?.data.date);}
    else if(capital){capitalPaid+=amount;entry('capital',amount);}
    else{operatingPaid+=amount;entry('operating',amount);}
   }
  }
  const pendingItems=w.records.filter(r=>r.kind==='obligation'&&r.data.status==='pending'&&r.data.direction==='out'&&!personalLoans.has(r.data.loan)&&matches(String(r.data.project||'')));
  const monthPending=pendingItems.filter(r=>r.data.date>=start&&r.data.date<=end).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const overduePending=pendingItems.filter(r=>r.data.date<start).reduce((n,r)=>n+Number(r.data.amount||0),0),pending=monthPending+overduePending;
  const currentEnd=dayAdd(monthAdd(asOf.slice(0,7)+'-01',1),-1),cashPending=pendingItems.filter(r=>r.data.date<=(end>currentEnd?end:currentEnd)).reduce((n,r)=>n+Number(r.data.amount||0),0);
  const reserve=w.records.filter(r=>r.kind==='project'&&matches(r.id)).reduce((n,r)=>n+Math.max(0,Number(r.data.reserve||0)),0);
  const cash=w.journals.filter(j=>j.date<=asOf).flatMap(j=>j.lines).filter(l=>matches(l.project)&&['cash','bank'].includes(l.account)).reduce((n,l)=>n+l.debit-l.credit,0);
  paid=operatingPaid+installmentsPaid;withdrawn=Math.max(0,withdrawn);
  const surplus=received-paid,remaining=Math.max(0,surplus-pending-withdrawn-reinvested);
  return {received,paid,operatingPaid,installmentsPaid,priorInstallmentsPaid,capitalPaid,fundingReceived,monthPending,overduePending,entries:entries.sort((a,b)=>a.date.localeCompare(b.date)),pending,withdrawn,reinvested,receipts,surplus,remaining,cash,reserve,cashLimit:Math.max(0,cash-cashPending-reserve)};
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
