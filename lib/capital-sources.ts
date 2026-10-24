import type {Workspace} from './finance';
import type {OwnerCashAllocation} from './owner-cash';

export type CapitalSourceRow={id:string;journalId:string;recordId:string;project:string;date:string;amount:number;category:'owner'|'reinvested'|'borrowed'|'advance';source:string;month:string;account:string;active:boolean;internalAmount:number;receiptIds:string[];withdrawalId:string};
/** Every row comes from a posted funding credit. Source records add lineage, never a second monetary entry. */
export function capitalSources(w:Workspace,projectIds:string[],end:string){
 const ids=new Set(projectIds),names=new Map(w.records.filter(r=>r.kind==='project'||r.kind==='loan').map(r=>[r.id,String(r.data.name||'')]));
 const name=(id:string)=>id?names.get(id)||'مشروع غير مسمى':'الحساب العام';
 const records=new Map(w.records.map(r=>[r.id,r]));
 const reversed=new Set(w.journals.filter(j=>j.reversal&&j.date<=end).map(j=>j.reversal));
 const bySource=new Map(w.journals.filter(j=>j.source).map(j=>[j.source,j]));
 const sourcePrefixes=['surplus-reinvestment:','projectFunding:','loan:','loan-allocation:','deficitPayment:'];
 const rows:CapitalSourceRow[]=[];
 for(const j of w.journals){
  if(j.reversal||j.date>end)continue;
  const prefix=sourcePrefixes.find(prefix=>j.source?.startsWith(prefix));
  const record=prefix?records.get(String(j.source).slice(prefix.length)):undefined,d=record?.data||{};
  const active=!reversed.has(j.id);
  for(const l of j.lines){
   if(!ids.has(l.project)||l.credit-l.debit<=0)continue;
   let category:CapitalSourceRow['category'];
   if(l.account==='capital')category='owner';
   else if(l.account==='capital_reinvested')category='reinvested';
   else if(['loan','inter_payable'].includes(l.account))category='borrowed';
   else if(l.account==='owner_advance')category='advance';
   else if(l.account==='payable'&&record?.kind==='projectFunding'&&d.sourceType==='external')category='borrowed';
   else continue;
   const amount=l.credit-l.debit,withdrawalId=String(d.withdrawalId||'');
   let source=category==='owner'?'أموال المالك / رصيد افتتاحي':category==='advance'?'سلفة من المالك':j.memo;
   let internalAmount=0;
   if(record?.kind==='surplusReinvestment'){
    const allocations=d.allocations as OwnerCashAllocation[];
    source=allocations.map(a=>name(a.project)).join(' + ');
    internalAmount=allocations.filter(a=>ids.has(a.project)).reduce((n,a)=>n+a.amount,0);
   }else if(d.sourceType==='project'){
    source=name(String(d.sourceProject));internalAmount=ids.has(String(d.sourceProject))?amount:0;
   }else if(withdrawalId){source='المالك — من تحويل سابق له';}
   else if(d.loanId){source='قرض: '+name(String(d.loanId));}
   else if(record?.kind==='loan'){source='قرض: '+String(d.name||'تمويل');}
   else if(d.sourceType==='external')source='جهة خارجية — مستحق الرد';
   else if(l.account==='inter_payable'){
    const funding=j.lines.find(x=>x.account==='inter_receivable'&&x.debit>x.credit);
    if(funding){source=name(funding.project);internalAmount=ids.has(funding.project)?amount:0;}
   }
   const account=j.lines.find(x=>x.project===l.project&&['cash','bank'].includes(x.account)&&x.debit>x.credit)?.account||'noncash';
   rows.push({id:j.id+':'+l.project+':'+l.account,journalId:j.id,recordId:record?.id||'',project:l.project,date:j.date,amount,category,source,month:String(d.month||d.originMonth||''),account,active,internalAmount,receiptIds:[...new Set((d.originReceipts||[]).map((r:{journalId:string})=>String(r.journalId)))] as string[],withdrawalId});
  }
 }
 const active=rows.filter(r=>r.active),sum=(category:CapitalSourceRow['category'])=>active.filter(r=>r.category===category).reduce((n,r)=>n+r.amount-r.internalAmount,0);
 const outgoing=w.records.filter(r=>r.kind==='surplusReinvestment'&&String(r.data.date)<=end&&!ids.has(String(r.data.targetProject))).flatMap(r=>{
  const original=bySource.get('surplus-reinvestment:'+r.id);if(!original)return [];
  const amount=(r.data.allocations as OwnerCashAllocation[]).filter(a=>ids.has(a.project)).reduce((n,a)=>n+a.amount,0);
  if(!amount)return [];
  return [{record:r,amount,active:!reversed.has(original.id)}];
 });
 return {rows:rows.sort((a,b)=>b.date.localeCompare(a.date)),outgoing,owner:sum('owner'),reinvested:sum('reinvested'),borrowed:sum('borrowed'),advances:sum('advance'),internal:active.reduce((n,r)=>n+r.internalAmount,0),reinvestedOut:outgoing.filter(r=>r.active).reduce((n,r)=>n+r.amount,0)};
}
