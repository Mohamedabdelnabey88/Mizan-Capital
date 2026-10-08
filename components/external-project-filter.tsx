'use client';

type Project={id:string;data:{name?:string}};

export function ExternalProjectFilter({projects,selected,onChange}:{projects:Project[];selected:string[];onChange:(ids:string[])=>void}){
  return (
    <div className="field wide">
      <span>تصفية المشاريع</span>
      <select
        className="picker"
        multiple
        size={Math.min(4,Math.max(2,projects.length))}
        value={selected}
        onChange={e=>onChange(Array.from(e.target.selectedOptions).map(o=>o.value))}
        aria-label="تصفية الالتزامات الخارجية حسب المشاريع"
      >
        {projects.map(p=><option key={p.id} value={p.id}>{p.data.name||'مشروع بدون اسم'}</option>)}
      </select>
      <button type="button" className="text-button" onClick={()=>onChange([])}>عرض جميع المشاريع</button>
    </div>
  );
}
