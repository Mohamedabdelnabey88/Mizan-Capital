import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scoped = "dailyReports.filter(r=>String(r.data.date)>=from&&String(r.data.date)<=to&&(scope==='all'||r.data.project===scope))";
const unscoped = "dailyReports.filter(r=>scope==='all'||r.data.project===scope)";
assert.equal(source.split(scoped).length - 1, 4, 'Daily report period KPIs, UI, PDF, and Excel must all respect the selected date range and project');
assert.equal(source.split(unscoped).length - 1, 0, 'No daily report list/export should ignore the selected date range');
const oldBalanceRows = "const balanceRows=Object.entries(scopedBalance).filter(([,v])=>v!==0).map(([k,v])=>[{v:accounts[k].name},{v:accounts[k].type},{v:v/100,style:4}] as ExportCell[]);";
assert.equal(source.includes(oldBalanceRows), false, 'Excel balance sheet must not export raw ledger balances as if they were a balance sheet');
assert(source.includes("const reportBalance=balance(w,scope,to);const pdfBalanceAssets="), 'PDF balance sheet must use fresh report balances and the same internal-funding elimination as the UI');
assert(source.includes("const balanceSheetDifference=bsAssets-bsLiabilities-bsEquity;if(balanceSheetDifference!==0)issues.push('المركز المالي غير متوازن:"), 'PDF and Excel export preflight must reject a non-zero balance-sheet reconciliation difference');
assert(source.includes("const pdfBalanceRows=[['الأصول','',''],"), 'PDF balance sheet must include reconciled totals');
assert(source.includes("const pdfTrialRows=Object.entries(reportBalance)"), 'PDF trial balance must use the freshly loaded report workspace');
for (const required of ["const balanceAssetAccounts=", "const balanceLiabilityAccounts=", "const balanceAssetsTotal=", "const balanceLiabilitiesTotal=", "const balanceEquityTotal=", "إجمالي الأصول", "إجمالي الالتزامات وحقوق الملكية", "فرق المطابقة (المفترض صفر)", "k==='inter_receivable'||k==='inter_payable'"]) {
  assert(source.includes(required), `Excel balance sheet reconciliation is missing: ${required}`);
}

assert(source.includes('moneyCell(x.transferIn),moneyCell(x.transferOut),moneyCell(x.otherIn),moneyCell(x.otherOut),moneyCell(x.net,5)'), 'Excel cash flow must include transfer and other movement categories');
assert(source.includes('تحويلات داخل') && source.includes('تحويلات خارج') && source.includes('أخرى داخل') && source.includes('أخرى خارج'), 'UI, PDF and Excel cash flow reports must expose all cash categories');
assert(source.includes("fmt(x.transferIn)+'</td><td>'+fmt(x.transferOut)+'</td><td>'+fmt(x.otherIn)+'</td><td>'+fmt(x.otherOut)"), 'PDF cash flow must include transfer and other movements');

assert(source.includes("const deficitRange={start:from,end:to};const deficitRows:any[]=[];for(let cursor=deficitRange.start.slice(0,7)+'-01';cursor<=deficitRange.end.slice(0,7)+'-01';cursor=monthAdd(cursor,1))"), 'Deficit dashboard must use the selected report period, not the separate commitments-summary period');
assert(source.includes("pretty(deficitRange.start)+' — '+pretty(deficitRange.end)"), 'Deficit dashboard must label the exact report period used for its calculation');
assert(source.includes('const selectedProjects=operationalProjectIds(w,scope);'), 'Deficit dashboard must use the legacy-compatible operating project selector');
assert(source.includes('>تغطية العجز بسلفة من المالك</button></div><DataTable heads={'), 'Owner deficit coverage action must remain visible even when no deficit rows are calculated');
assert(source.includes('unmatchedLoss=deficitReconciliation.unmatchedLoss'), 'A P&L loss unmatched to project deficit must be exposed as a separate diagnostic amount');
assert(source.includes('خسارة التقرير غير المطابقة لعجز المشاريع'), 'The UI must not silently show all zeroes when P&L is negative but no project deficit matches');
assert(source.includes("project:(scope!=='all'&&projects.some(x=>x.id===scope&&x.data.mode!=='investment')?scope:operating[0]?.id||''),deficitMonth:today().slice(0,7)"), 'Owner advance form must open with a valid operating project when one is available');
assert(source.includes('pnl.net<0&&unmatchedLoss>0&&<Note tone="amber">تنبيه مطابقة:'), 'Deficit dashboard must disclose a P&L loss that remains unmatched to project deficit rows');

const ownerAdvanceFilter = "const ownerAdvances=w.records.filter(x=>x.kind==='deficitPayment'&&(scope==='all'||x.data.project===scope)&&x.data.status!=='cancelled').sort((a,b)=>String(b.data.date).localeCompare(String(a.data.date)));";
assert(source.includes(ownerAdvanceFilter), 'Outstanding owner advances must remain visible even when their payment date falls outside the report period');
assert(source.includes('const dashboardOwnerAdvances=w.records.filter(r=>r.kind===\'deficitPayment\'&&(scope===\'all\'||r.data.project===scope)&&r.data.status!==\'cancelled\')'), 'The public dashboard must show owner advances independently of the report date filter');
assert(source.includes('>سلف المالك المستحقة</span>'), 'Dashboard must expose a dedicated owner-advance balance card');
assert(source.includes('>إدارة السلف وردّها</button>'), 'Dashboard must always expose a clear owner-advance management and repayment action');
assert(source.includes("x.kind==='deficitPayment'&&(!x.data.project||scope==='all'||x.data.project===scope)"), 'General owner advances must remain available in the management ledger regardless of selected project scope');
assert(source.includes('السلف العامة تظهر هنا للإدارة حتى عند اختيار مشروع'), 'UI must explain that showing general advances in the management ledger does not allocate them to a project');
assert(source.includes('>إصدار سند صرف / رد السلفة</button>'), 'Dashboard must expose direct repayment voucher actions for outstanding owner advances');
assert(source.includes("open('repayOwnerAdvance',{id:r.id,project:r.data.project,title:'سلفة المالك'"), 'Dashboard repayment voucher action must open the repayment form for the selected advance');
assert(source.includes('deficitReconciliation=operationalDeficitReconciliation(deficitAssigned,pnl.net)'), 'Operational deficit total must reconcile report loss that is not assigned to a project');
assert(source.includes('deficitPaid=ownerAdvances.filter(x=>String(x.data.deficitMonth||\'\')>=from.slice(0,7)&&String(x.data.deficitMonth||\'\')<=to.slice(0,7))'), 'Owner advance coverage total must not become zero solely because no deficit rows matched');
assert(!source.includes("const ownerAdvances=w.records.filter(x=>x.kind==='deficitPayment'&&(scope==='all'||x.data.project===scope)&&x.data.status!=='cancelled'&&String(x.data.date)>=from&&String(x.data.date)<=to)"), 'Owner advance repayment actions must not disappear due to unrelated report date filters');
assert(source.indexOf('<Panel title="دفع العجز — سلف مستحقة للمالك"') < source.indexOf('<Panel title="ملخص الالتزامات والتحصيلات"'), 'Owner deficit and repayment panel must appear before the long commitments summary');

const worker = await fs.readFile(new URL('../cloudflare/workspace.ts', import.meta.url), 'utf8');
assert(source.includes("open('ownerAdvanceGeneral',{date:today(),amount:'',paymentAccount:'cash',memo:'سلفة عامة من المالك على إجمالي المشاريع'})"), 'Dashboard must provide a separate general owner advance action');
assert(source.includes("ownerAdvanceGeneral:'تسجيل سلفة عامة على إجمالي المشاريع'"), 'General owner advance must have a dedicated form title');
assert(source.includes("r.data.project?pname(r.data.project):'إجمالي المشاريع (سلفة عامة)'"), 'General owner advances must be labeled as consolidated rather than assigned to a project');
assert(source.includes("open('repayOwnerAdvance',{id:r.id,project:r.data.project,title:'سلفة المالك'"), 'Outstanding owner advance must open the repayment form');
assert(worker.includes("else if(action==='ownerAdvanceGeneral')"), 'Worker must support posting general owner advances');
assert(worker.includes("{project:'',deficitMonth:'',amount,date:dt,paymentAccount:pay,memo,repaid:0,status:'open',scope:'all'}"), 'General owner advance record must remain unassigned to an individual project');
assert(worker.includes("pair('',pay,'owner_advance',amount)"), 'General owner advance must post against the consolidated ledger only');
assert(worker.includes("d.project?'رد سلفة مالك عن عجز '+String(d.deficitMonth||''):'رد سلفة مالك عامة على إجمالي المشاريع'"), 'Repayment journal must distinguish general advances from project deficit advances');

console.log(JSON.stringify({passed:true,checked:['general owner advance and repayment','daily reports UI','PDF daily report section','Excel daily report sheet','Excel balance sheet totals and internal-funding elimination','owner advance visibility and repayment action scope']}));
