import {projectDescendantIds} from './project-portfolio';
import type {Workspace,RecordItem} from './finance';

export const projectContractKinds=['lease','tenantLease','projectTenantLease','projectCommitment','landPurchase'] as const;
export function contractIdForDue(due:RecordItem){const d=due.data;return String(d.projectTenantLeaseId||d.tenantLeaseId||d.projectCommitmentId||d.leaseId||d.landPurchaseId||d.loan||'');}
export function projectWorkspace(w:Workspace,projectId:string,includeBranches=true){
 const projects=w.records.filter(r=>r.kind==='project'),project=projects.find(r=>r.id===projectId);
 const descendantIds=project?projectDescendantIds(projects,projectId):[];
 const ids=new Set(project?[projectId,...(includeBranches?descendantIds:[])]:[]);
 const branches=projects.filter(r=>descendantIds.includes(r.id));
 const contracts=w.records.filter(r=>ids.has(String(r.data.project))&&projectContractKinds.some(kind=>r.kind===kind));
 const loans=w.records.filter(r=>r.kind==='loan'&&ids.has(String(r.data.project))&&r.data.status!=='deleted');
 const dues=w.records.filter(r=>r.kind==='obligation'&&ids.has(String(r.data.project))).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date)));
 const pending=dues.filter(r=>r.data.status==='pending'),paid=dues.filter(r=>r.data.status==='paid');
 const sum=(rows:RecordItem[],direction:string)=>rows.filter(r=>r.data.direction===direction).reduce((total,r)=>total+Number(r.data.amount||0),0);
 const units=w.records.filter(r=>r.kind==='propertyUnit'&&ids.has(String(r.data.project)));
 const summaries=contracts.map(contract=>{
  const installments=dues.filter(due=>contractIdForDue(due)===contract.id),completed=installments.filter(r=>r.data.status==='paid'),open=installments.filter(r=>r.data.status==='pending');
  return {contract,installments,paid:completed.reduce((s,r)=>s+Number(r.data.amount||0),0),pending:open.reduce((s,r)=>s+Number(r.data.amount||0),0),next:open[0],direction:contract.kind==='tenantLease'||contract.kind==='projectTenantLease'?'in':'out'};
 });
 return {project,ids,branches,units,contracts:summaries,loans,dues,pending,paid,totals:{received:sum(paid,'in'),paid:sum(paid,'out'),receivable:sum(pending,'in'),payable:sum(pending,'out')}};
}
