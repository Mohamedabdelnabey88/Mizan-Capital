import {dayAdd,monthAdd,profit,type Workspace} from './finance';

export type MonthlyAdvanceRow={
 month:string;project:string;revenue:number;expense:number;net:number;operatingDeficit:number;
 advanceOpening:number;advanceReceived:number;advanceRepaid:number;advanceClosing:number;
 deficitFundedByMonthEnd:number;deficitUncovered:number;
};
const valid=(r:Workspace['records'][number])=>r.data.status!=='cancelled'&&r.data.status!=='deleted';
const amount=(r:Workspace['records'][number])=>Math.max(0,Number(r.data.amount||0));
/** Monthly profit and actual owner-advance movements. Money fields are integer halalas.
 * The profit shortfall is NOT a cash advance, and repaying an advance is NOT an expense.
 * Opening/closing balances come from dated original and linked repayment documents,
 * rather than the mutable lifetime "repaid" field on an advance.
 */
export function monthlyOwnerAdvanceReport(w:Workspace,start:string,end:string,projectIds:string[],includeGeneral=false):MonthlyAdvanceRow[]{
 if(start>end)return [];
 const projectSet=new Set(projectIds);
 const advances=w.records.filter(r=>r.kind==='deficitPayment'&&valid(r));
 const advanceMap=new Map(advances.map(r=>[r.id,r]));
 const repayments=w.records.filter(r=>r.kind==='ownerAdvanceRepayment'&&r.data.status==='posted')
  .map(r=>({record:r,advance:advanceMap.get(String(r.data.advanceId||''))}))
  .filter(x=>!!x.advance);
 const general=advances.some(r=>!r.data.project)||repayments.some(x=>!x.advance?.data.project);
 const ids=[...projectIds,...(general&&includeGeneral?['']:[])];
 const result:MonthlyAdvanceRow[]=[];
 for(let cursor=start.slice(0,7)+'-01';cursor<=end;cursor=monthAdd(cursor,1)){
  const month=cursor.slice(0,7),monthEnd=dayAdd(monthAdd(cursor,1),-1);
  const rangeStart=cursor<start?start:cursor,rangeEnd=monthEnd>end?end:monthEnd;
  for(const project of ids){
   const p=project?profit(w,project,rangeStart,rangeEnd):{revenue:0,expense:0,net:0};
   const scopedAdvances=advances.filter(r=>String(r.data.project||'')===project);
   const scopedRepayments=repayments.filter(x=>String(x.advance?.data.project||'')===project);
   const before=(when:string)=>scopedAdvances.filter(r=>String(r.data.date||'')<when).reduce((sum,r)=>sum+amount(r),0)
    -scopedRepayments.filter(x=>String(x.record.data.date||'')<when).reduce((sum,x)=>sum+amount(x.record),0);
   const advanceReceived=scopedAdvances.filter(r=>String(r.data.date||'')>=rangeStart&&String(r.data.date||'')<=rangeEnd).reduce((sum,r)=>sum+amount(r),0);
   const advanceRepaid=scopedRepayments.filter(x=>String(x.record.data.date||'')>=rangeStart&&String(x.record.data.date||'')<=rangeEnd).reduce((sum,x)=>sum+amount(x.record),0);
   const advanceOpening=before(rangeStart);
   const advanceClosing=before(dayAdd(rangeEnd,1));
   const operatingDeficit=Math.max(0,-p.net);
   // Only cash actually supplied by the report cutoff against this month's loss.
   // Late owner funding in the following month belongs to that month's cash movements.
   const deficitFundedByMonthEnd=project?scopedAdvances.filter(r=>String(r.data.deficitMonth||'')===month&&String(r.data.date||'')<=rangeEnd).reduce((sum,r)=>sum+amount(r),0):0;
   result.push({month,project,revenue:p.revenue,expense:p.expense,net:p.net,operatingDeficit,
    advanceOpening,advanceReceived,advanceRepaid,advanceClosing,deficitFundedByMonthEnd,
    deficitUncovered:Math.max(0,operatingDeficit-deficitFundedByMonthEnd)});
  }
 }
 return result;
}
