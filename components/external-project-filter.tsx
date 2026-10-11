'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Building2 } from 'lucide-react';

type Project={id:string;data:{name?:string}};
export function ExternalProjectFilter({projects,selected,onChange,context='salary'}:{projects:Project[];selected:string[];onChange:(ids:string[])=>void;context?:'salary'|'liabilities'}){
  const [open,setOpen]=useState(false);
  const title=context==='salary'?'تصفية الرواتب حسب المشروع':'تصفية الالتزامات حسب المشروع';
  const selectedNames=useMemo(()=>projects.filter(p=>selected.includes(p.id)).map(p=>p.data.name||'مشروع بدون اسم'),[projects,selected]);
  const toggle=(id:string)=>onChange(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
  return (
    <div className="project-filter-wrap">
      <div className="project-filter-heading"><span>{title}</span><span className="project-filter-count">{selected.length?selected.length:'الكل'}</span></div>
      <div className="project-filter-control">
        <button type="button" className={`project-filter-trigger ${open?'is-open':''}`} aria-expanded={open} aria-label={title} onClick={()=>setOpen(v=>!v)}>
          <span className="project-filter-trigger-icon"><Building2 size={15}/></span>
          <span className="project-filter-trigger-text">{selected.length===0?'جميع المشاريع':selected.length===1?selectedNames[0]:`تم اختيار ${selected.length} مشاريع`}</span>
          <ChevronDown size={16} className="project-filter-chevron"/>
        </button>
        {open&&<div className="project-filter-menu" role="group" aria-label={title}>
          <div className="project-filter-menu-head"><b>اختر المشاريع</b><button type="button" onClick={()=>onChange([])}><RotateCcw size={13}/> عرض الكل</button></div>
          {projects.length===0?<div className="project-filter-empty">لا توجد مشاريع تشغيلية</div>:projects.map(p=><label key={p.id} className={`project-filter-option ${selected.includes(p.id)?'selected':''}`}>
            <input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/>
            <span className="project-filter-check">{selected.includes(p.id)&&<Check size={12}/>}</span>
            <span className="project-filter-option-name">{p.data.name||'مشروع بدون اسم'}</span>
          </label>)}
          <button type="button" className="project-filter-done" onClick={()=>setOpen(false)}>تم</button>
        </div>}
      </div>
      {selected.length>0&&<div className="project-filter-selected">{selectedNames.slice(0,2).map((name,i)=><span className="project-filter-chip" key={selected[i]}>{name}</span>)}{selected.length>2&&<span className="project-filter-chip more">+{selected.length-2}</span>}<button type="button" className="project-filter-clear" onClick={()=>onChange([])}>مسح</button></div>}
      <p className="project-filter-hint">{selected.length?'الأرقام تعرض المشاريع المحددة فقط':'الأرقام تشمل جميع المشاريع التشغيلية'}</p>
    </div>
  );
}
