'use client';
import {DateInput} from '@/components/date-input';
import type {Workspace} from '@/lib/finance';
const fmt=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v/100);
const pretty=(v:string)=>new Date(v+'T12:00:00').toLocaleDateString('ar-SA',{day:'numeric',month:'long',year:'numeric',calendar:'gregory'});
export function contractEditValues(w:Workspace,id:string){
 const c=w.records.find(r=>r.id===id);if(!c)return {};
 const key=c.kind==='lease'?'leaseId':c.kind==='tenantLease'?'tenantLeaseId':c.kind==='projectTenantLease'?'projectTenantLeaseId':'projectCommitmentId';
 return {contractId:id,version:c.version,title:c.data.title||'',party:c.data.tenantName||c.data.party||'',startDate:c.data.startDate||'',endDate:c.data.endDate||'',totalAmount:String(Number(c.data.totalAmount||0)/100),reason:'',rows:w.records.filter(r=>r.kind==='obligation'&&r.data[key]===id&&['paid','pending'].includes(r.data.status)).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date))).map(r=>({id:r.id,date:r.data.date,amount:String(Number(r.data.amount)/100),status:r.data.status}))};
}
export function ContractDetails({workspace,id,onEdit}:{workspace:Workspace;id:string;onEdit:()=>void}){
 const c=workspace.records.find(r=>r.id===id);if(!c)return <p>العقد غير موجود.</p>;
 const values=contractEditValues(workspace,id) as any;
 return <div className="stack-list"><p><b>{c.data.title}</b> · {workspace.records.find(r=>r.id===c.data.project)?.data.name}</p><p>الطرف: {values.party||'غير مسجل'}</p><p>بداية العقد: {values.startDate?pretty(values.startDate):'غير مسجلة'} · نهاية العقد: {values.endDate?pretty(values.endDate):'غير مسجلة'}</p><p>إجمالي العقد: {fmt(Number(c.data.totalAmount))} ر.س</p><table><thead><tr><th>الاستحقاق</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{values.rows.map((r:any)=><tr key={r.id}><td>{pretty(r.date)}</td><td>{fmt(Math.round(Number(r.amount)*100))} ر.س</td><td>{r.status==='paid'?'مسدد / محصل':'غير مسدد'}</td></tr>)}</tbody></table>{!['cancelled','terminated'].includes(c.data.status)&&<button type="button" className="btn primary" onClick={onEdit}>تعديل العقد والإيجار</button>}</div>;
}
export function ContractScheduleEditor({rows,onChange}:{rows:any[];onChange:(rows:any[])=>void}){
 return <div className="wide stack-list"><p>جدول العقد بالكامل. الدفعات المسددة محفوظة؛ لتصحيحها استخدم «التراجع عن الدفعة» أولًا من ملف المشروع.</p>{rows.map((row,index)=><div className="form-grid" key={row.id||index}><label>تاريخ الدفعة<DateInput required value={row.date} disabled={row.status==='paid'} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,date:e.target.value}:r))}/></label><label>المبلغ (ريال)<input required type="number" min="0.01" step="0.01" value={row.amount} disabled={row.status==='paid'} onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,amount:e.target.value}:r))}/></label><span>{row.status==='paid'?'مسدد / محصل':<button type="button" className="btn danger" onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>حذف الموعد غير المسدد</button>}</span></div>)}<button type="button" className="btn secondary" onClick={()=>onChange([...rows,{id:'',date:'',amount:'',status:'pending'}])}>إضافة دفعة</button></div>;
}
