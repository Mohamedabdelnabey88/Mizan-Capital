import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync('app/page.tsx','utf8');
assert(ui.includes("fundingRows.filter(f=>projectPageProjects.some(p=>p.id===f.project)&&String(f.date)<=to)"),
 'Capital funding details must include balances originated before the reporting period');
assert(!ui.includes("String(f.date)>=from&&String(f.date)<=to"),
 'Capital detail must not exclude opening outstanding funding');
assert(ui.includes("cardReceivables(w,scope,to)"),
 'Exported card receivables must honor report end date');
assert(ui.includes("moneyCell(cashAndBank(w,scope,to),5)"),
 'Exported cash/bank must honor report end date');
assert(ui.includes('التمويلات المسجلة حتى '),
 'Capital table must explain lifetime balance and period movements');
console.log('Capital and liquidity as-of-date linkage passed.');
