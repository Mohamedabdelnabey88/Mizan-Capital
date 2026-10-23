import type {Workspace,RecordItem} from './finance';

const matchesSource=(source:string,base:string)=>source===base||source.startsWith(base+':payment:');

/** Keep the first source compatible with existing records; later payment attempts get their own audit reference. */
export function installmentPaymentSource(w:Workspace,base:string,requestId:string){
 const history=w.journals.filter(j=>matchesSource(String(j.source||''),base));
 const reversed=new Set(w.journals.map(j=>j.reversal).filter(Boolean));
 if(history.some(j=>!j.reversal&&!reversed.has(j.id)))throw Object.assign(new Error('يوجد قيد سداد أو تحصيل نشط لهذا الموعد. حدّث البيانات وراجع العملية المسجلة قبل المحاولة.'),{code:'PAYMENT_ALREADY_POSTED'});
 return history.length?base+':payment:'+requestId:base;
}

export function installmentPaymentHistory(w:Workspace,obligation:RecordItem){
 const bases=['obligation:','project-commitment-payment:','project-tenant-rent-payment:','tenant-rent-payment:'].map(prefix=>prefix+obligation.id);
 for(const asset of w.records.filter(r=>r.kind==='projectAsset'&&r.data.sourceObligation===obligation.id))bases.push('project-asset:'+asset.id);
 const reversed=new Set(w.journals.map(j=>j.reversal).filter(Boolean));
 return w.journals.filter(j=>!j.reversal&&bases.some(base=>matchesSource(String(j.source||''),base))).map(j=>({...j,reversed:reversed.has(j.id)}));
}
