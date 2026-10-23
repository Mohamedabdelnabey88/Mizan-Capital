import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync('app/page.tsx','utf8');
const worker=fs.readFileSync('cloudflare/workspace.ts','utf8');
const finance=fs.readFileSync('lib/finance.ts','utf8');

const sections=[
 ['dashboard','نظرة عامة'],['capital','رأس المال والتمويل'],['projects','المشاريع والاستثمارات'],
 ['contracts','عقود المشاريع'],['daily','التقارير اليومية'],['ledger','الحركات'],
 ['cashflow','السيولة المتوقعة'],['calendar','تقويم الالتزامات'],['commitments','التزاماتي'],
 ['loans','التمويل والقروض'],['personalLoans','قروض شخصية'],['team','الموظفون والرواتب'],
 ['risks','إدارة المخاطر'],['decisions','مركز القرار'],['reports','التقارير المحاسبية'],
 ['settings','الضبط وسجل المراجعة']
];
assert.equal(sections.length,16);
for(const [id,label] of sections){
 assert(ui.includes("['"+id+"','"+label+"'"),'missing navigation entry '+label);
 assert(ui.includes("tab==='"+id+"'"),'missing rendered section '+label);
}
assert(ui.includes("await load();toast.success('تم الحفظ وتحديث الحسابات')"),'posted actions must refresh workspace');
assert(ui.includes('balance(w,scope,to)'),'dashboard and capital balances must respect selected end date');
assert(ui.includes('profit(w,scope,from,to)'),'profit must respect selected reporting period');
assert(ui.includes('const dashboardOwnerAdvances=w.records.filter'),'owner advances must derive from workspace records');
assert(ui.includes("open('ownerAdvancePicker'"),'repayment action must not redirect to commitments');
assert(ui.includes('externalLiabilityBreakdown(w,externalProjectIds,to)'),'external-liability cards must derive from ledger balances');
assert(ui.includes("const salaryObligations=w.records.filter"),'salary dashboard must derive from pending obligations');
assert(ui.includes("loanOutstanding=(l:any)=>w.records.filter"),'loan outstanding must derive from principal still pending');
for(const name of ['balance','profit','actualCashFlow','accountingControlTotals','commitmentSummary','loanSchedule','forecast','distributionEntitlement','normalBalance']){
 assert(finance.includes('function '+name+'('),'missing financial calculation '+name);
}
for(const action of ['projectSchedulePayment','settle','dailyReport','dailyReportCorrection','loan','replaceSchedule','ownerAdvanceGeneral','repayOwnerAdvance','employee','payrollAdjustment','risk','resolveRisk','reverse','closePeriod']){
 assert(worker.includes("action==='"+action+"'"),'missing server handler '+action);
}
assert(finance.includes("'deficitPayment','repayOwnerAdvance'"),'owner advances and repayments must be financing cash flows');
assert(worker.includes("balance(w,d.project||'all',dt)[pay]"),'general advance repayment must check consolidated cash scope');
console.log('Cross-page accounting integration inventory passed: 16 sections and critical financial handlers linked.');
