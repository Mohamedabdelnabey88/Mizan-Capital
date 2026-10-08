import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scoped = "dailyReports.filter(r=>String(r.data.date)>=from&&String(r.data.date)<=to&&(scope==='all'||r.data.project===scope))";
const unscoped = "dailyReports.filter(r=>scope==='all'||r.data.project===scope)";
assert.equal(source.split(scoped).length - 1, 3, 'UI, PDF, and Excel daily reports must all respect the selected date range and project');
assert.equal(source.split(unscoped).length - 1, 0, 'No daily report list/export should ignore the selected date range');
console.log(JSON.stringify({passed:true,checked:['daily reports UI','PDF daily report section','Excel daily report sheet']}));
