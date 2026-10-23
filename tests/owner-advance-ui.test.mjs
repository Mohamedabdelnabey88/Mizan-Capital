import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync('app/page.tsx','utf8');
assert(source.includes("onClick={()=>open('ownerAdvancePicker',{title:'اختر السلفة المطلوب ردّها'})}"),'overview owner-advance action must open the picker directly');
assert(!source.includes('onClick={()=>go(\'commitments\')}>إدارة السلف وردّها</button>'),'overview repayment action must not route users to Commitments');
assert(source.includes("modal==='ownerAdvancePicker'"),'owner advance picker modal must be rendered');
assert(source.includes("onClick={()=>open('repayOwnerAdvance',{id:r.id,project:r.data.project,advanceDate:r.data.date,title:"),'picker must open the repayment form for the selected advance');
assert(source.includes("amount:(remaining/100).toFixed(2)"),'repayment form must default to the exact outstanding balance');
assert(source.includes("if(!await load())throw Error(")&&source.includes("toast.success('تم الحفظ وتحديث الحسابات')"),'successful repayment must reload the workspace');
assert(source.includes("modal!=='ownerAdvancePicker'&&<button type=\"submit\""),'picker must not submit a financial transaction itself');
console.log('Owner advance UI regression tests passed.');
