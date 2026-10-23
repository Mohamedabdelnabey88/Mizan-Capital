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
assert(page.includes("rows:''"),'no prefilled spending data should be posted');
console.log('Loan-financed foundation posting contract tests passed');
