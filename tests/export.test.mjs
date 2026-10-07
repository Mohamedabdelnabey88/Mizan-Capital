import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source=await fs.readFile(new URL('../lib/export.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const bytes=mod.buildXlsxBytes([
 {name:'حركة / رئيسية',title:'ميزان كابيتال',subtitle:'اختبار بنية Excel',heads:['البيان','المبلغ','التاريخ'],rows:[
  [{v:'إيراد تجريبي'},{v:1234.56,style:4},{v:'2026-10-05',style:6}],
  [{v:'نص & XML <safe>'},{v:-20,style:5},{v:'2026-10-06',style:6}]
 ],widths:[30,16,16],total:[{v:'الإجمالي',style:3},{v:1214.56,style:5},{v:'',style:8}]},
 {name:'حركة / رئيسية',title:'ورقة ثانية',subtitle:'Duplicate name test',heads:['A'],rows:[[{v:'ok'}]],widths:[20]}
]);

const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
assert.equal(new TextDecoder().decode(b.slice(0,4)),'PK\x03\x04');

const u16=(o)=>b[o]|(b[o+1]<<8);
const u32=(o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;
const dec=new TextDecoder();
let p=0, names=[];
while(p+4<=b.length){
 const sig=u32(p);
 if(sig===0x04034b50){
  const nameLen=u16(p+26), extraLen=u16(p+28), size=u32(p+18);
  const name=dec.decode(b.slice(p+30,p+30+nameLen));
  names.push(name);
  assert.equal(u16(p+6),0x800,'ZIP entries must declare UTF-8 filenames');
  assert.equal(u16(p+8),0,'ZIP entries must use store compression in this deterministic writer');
  assert.equal(u32(p+14),size);
  assert.equal(u32(p+22),size);
  p+=30+nameLen+extraLen+size;
 } else if(sig===0x02014b50){
  break;
 } else {
  throw new Error('Invalid ZIP local header at offset '+p);
 }
}
const required=['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'];
for(const n of required) assert(names.includes(n),'Missing XLSX part: '+n);
assert.equal(names.length,7);

const centralOffset=b.length-22-u32(b.length-6);
const eocdOffset=b.length-22;
assert.equal(u32(eocdOffset),0x06054b50);
assert.equal(u16(eocdOffset+10),7);
assert.equal(u16(eocdOffset+8),7);
assert(centralOffset>0);

console.log(JSON.stringify({passed:true,bytes:b.length,entries:names.length,validated:required}));
