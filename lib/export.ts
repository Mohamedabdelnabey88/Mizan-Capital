export type ExportCell={v:string|number;style?:number};
export type ExportSheet={name:string;title:string;subtitle:string;heads:string[];rows:ExportCell[][];widths:number[];total?:ExportCell[]};

const xmlSafe=(value:string)=>Array.from(String(value)).filter(ch=>{const c=ch.codePointAt(0)||0;return c===9||c===10||c===13||(c>=0x20&&c<=0xd7ff)||(c>=0xe000&&c<=0xfffd)||(c>=0x10000&&c<=0x10ffff)}).join('');
const xmlEsc=(v:string)=>xmlSafe(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll(String.fromCharCode(34),'&quot;').replaceAll(String.fromCharCode(39),'&apos;');
const safeSheetNames=(sheets:ExportSheet[])=>{
 const used=new Set<string>();
 return sheets.map((sheet,index)=>{
  let name=xmlSafe(sheet.name).replace(/[\\/:?*\[\]]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||('Sheet '+(index+1));
  const base=name;
  let n=2;
  while(used.has(name.toLocaleLowerCase())){const suffix=' ('+n+++')';name=base.slice(0,31-suffix.length)+suffix;}
  used.add(name.toLocaleLowerCase());
  return {...sheet,name};
 });
};
const col=(n:number)=>{let s='';for(let x=n+1;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
const bytes=(s:string)=>new TextEncoder().encode(s);
const u16=(n:number)=>new Uint8Array([n&255,(n>>>8)&255]);
const u32=(n:number)=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
const concat=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;};
const crc32=(data:Uint8Array)=>{let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};

const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);-"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><sz val="10"/><color rgb="FF66736B"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B4F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2EC"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9E2DB"/></left><right style="thin"><color rgb="FFD9E2DB"/></right><top style="thin"><color rgb="FFD9E2DB"/></top><bottom style="thin"><color rgb="FFD9E2DB"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0"/><xf numFmtId="0" fontId="3" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>';

const sheetXml=(sheet:ExportSheet)=>{const all=[sheet.heads.map(v=>({v,style:3})),...(sheet.rows||[])];if(sheet.total)all.push(sheet.total.map(v=>({...v,style:v.style??5})));const lastRow=all.length+3,lastCol=Math.max(0,sheet.heads.length-1),lastRef=col(lastCol)+lastRow;const cols=sheet.widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');const rows=all.map((row,ri)=>{const rn=ri+4;const cells=row.map((cell,ci)=>{const r=col(ci)+rn;if(typeof cell.v==='number'&&Number.isFinite(cell.v))return '<c r="'+r+'" s="'+(cell.style??4)+'" t="n"><v>'+cell.v+'</v></c>';return '<c r="'+r+'" s="'+(cell.style??8)+'" t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(String(cell.v??''))+'</t></is></c>';}).join('');return '<row r="'+rn+'" ht="'+(ri===0?30:21)+'" customHeight="1">'+cells+'</row>';}).join('');return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+lastRef+'"/><sheetFormatPr defaultRowHeight="21"/><cols>'+cols+'</cols><sheetData><row r="1" ht="34" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>'+xmlEsc(sheet.title)+'</t></is></c></row><row r="2" ht="22" customHeight="1"><c r="A2" s="2" t="inlineStr"><is><t>'+xmlEsc(sheet.subtitle)+'</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t></t></is></c></row>'+rows+'</sheetData><mergeCells count="2"><mergeCell ref="A1:'+col(lastCol)+'1"/><mergeCell ref="A2:'+col(lastCol)+'2"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>';};

const zipStore=(files:{name:string;body:string}[])=>{const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;for(const f of files){const name=bytes(f.name),data=bytes(f.body),crc=crc32(data);const lh=concat([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);local.push(lh);const ch=concat([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);central.push(ch);offset+=lh.length;}const body=concat(local),cd=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cd.length),u32(body.length),u16(0)]);return concat([body,cd,end]);};

export const moneyCell=(halala:number,style=4):ExportCell=>({v:Number((halala/100).toFixed(2)),style});
export const dateCell=(value:string):ExportCell=>({v:value,style:6});
export const percentCell=(value:number):ExportCell=>({v:Number((value/100).toFixed(4)),style:7});

export function buildXlsxBytes(sheets:ExportSheet[]){
 if(!Array.isArray(sheets)||sheets.length===0) throw new Error('لا توجد بيانات لتصديرها إلى Excel.');
 const normalized=safeSheetNames(sheets);
 const files:{name:string;body:string}[]=[{name:'[Content_Types].xml',body:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+normalized.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},{name:'_rels/.rels',body:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},{name:'xl/workbook.xml',body:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="Microsoft Excel"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="18000" windowHeight="12000"/></bookViews><sheets>'+normalized.map((s,i)=>'<sheet name="'+xmlEsc(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><calcPr fullCalcOnLoad="1"/></workbook>'},{name:'xl/_rels/workbook.xml.rels',body:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+normalized.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},{name:'xl/styles.xml',body:styles}];
 normalized.forEach((s,i)=>files.push({name:'xl/worksheets/sheet'+(i+1)+'.xml',body:sheetXml(s)}));
 const out=zipStore(files);
 if(out.length<100) throw new Error('تعذر إنشاء ملف Excel صالح.');
 return out;
}

export function downloadXlsx(sheets:ExportSheet[],fileName:string){
 if(typeof document==='undefined') throw new Error('تصدير Excel متاح من المتصفح فقط.');
 const safeName=(fileName||'Mizan-Capital.xlsx').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim()||'Mizan-Capital.xlsx';
 const finalName=safeName.toLowerCase().endsWith('.xlsx')?safeName:safeName+'.xlsx';
 const blob=new Blob([buildXlsxBytes(sheets)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;
 a.download=finalName;
 a.setAttribute('download',finalName);
 a.rel='noopener';
 a.style.position='fixed';
 a.style.left='-9999px';
 a.style.width='1px';
 a.style.height='1px';
 document.body.appendChild(a);
 try{a.click();}finally{setTimeout(()=>{a.remove();URL.revokeObjectURL(url)},300000);}
 return blob.size;
}
export function escapeHtml(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll(String.fromCharCode(34),'&quot;').replaceAll(String.fromCharCode(39),'&#39;');}
