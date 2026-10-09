import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scoped = "dailyReports.filter(r=>String(r.data.date)>=from&&String(r.data.date)<=to&&(scope==='all'||r.data.project===scope))";
const unscoped = "dailyReports.filter(r=>scope==='all'||r.data.project===scope)";
assert.equal(source.split(scoped).length - 1, 3, 'UI, PDF, and Excel daily reports must all respect the selected date range and project');
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
console.log(JSON.stringify({passed:true,checked:['daily reports UI','PDF daily report section','Excel daily report sheet','Excel balance sheet totals and internal-funding elimination']}));
