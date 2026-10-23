import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=fs.readFileSync('cloudflare/workspace.ts','utf8');
const page=fs.readFileSync('app/page.tsx','utf8');
const start=api.indexOf("else if(action==='loanFundedProjectSpend')");
const end=api.indexOf("else if(action==='allocateLoanFunds')",start);
assert(start>=0&&end>start,'API must have a dedicated single-transaction handler');
const body=api.slice(start,end);
for(const x of ["loan.data.holder==='personal'","loan.data.project","loan.data.fundingMode==='opening'","used+total>Number(loan.data.principal||0)","total>generalCash","loanAllocation","journal('transfer'","journal('projectCost'","isAdvance?'receivable'","loanId:loan.id","loanAllocationId:rid"]){assert(body.includes(x),'Missing protection: '+x);}
assert(page.includes("open('loanFundedProjectSpend'"),'loan card must expose flow');
assert(page.includes("modal==='loanFundedProjectSpend'"),'entry form must exist');
assert(page.includes("spendItems:[{category:'land',title:'',amount:''}]"),'start with one empty editable item');
assert(page.includes("foundation-item"),'structured line item must be rendered');
assert(page.includes("foundation-summary"),'live totals must be rendered');
assert(page.includes("Number(x.amount).toFixed(2)"),'line items must be serialized for existing API');
assert(!page.includes('<textarea className="schedule-text" dir="rtl" rows={7} value={form.rows||\'\'}'),'remove manual pipe-delimited input');
console.log('Loan-financed foundation posting contract tests passed');
