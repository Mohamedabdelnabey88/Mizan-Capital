'use client';
import {useEffect,useState} from 'react';
import {ChevronLeft,ListFilter} from 'lucide-react';

/** Builds a compact contents list from the sections actually rendered on each page. */
export function WorkspaceOutline({page}:{page:string}){
 const [sections,setSections]=useState<{id:string;title:string}[]>([]);
 useEffect(()=>{
  const root=document.getElementById('workspace-main');if(!root)return;
  const update=()=>{
   const headings=Array.from(root.querySelectorAll<HTMLElement>('.panel-head h3,details.workspace-disclosure>summary'));
   const next=headings.filter(h=>!h.closest('[hidden],[data-state="inactive"]')&&!h.parentElement?.closest('details:not([open]) .panel')).map((h,index)=>{
    const id=`workspace-section-${page}-${index}`;h.id=id;
    return {id,title:h.firstChild?.textContent?.trim()||h.textContent?.trim()||'قسم'};
   });
   setSections(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  update();const observer=new MutationObserver(update);observer.observe(root,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[page]);
 if(sections.length<2)return null;
 return <nav className="workspace-outline" aria-label="أقسام الصفحة"><span><ListFilter size={16}/>في هذه الصفحة</span><div>{sections.map(section=><button type="button" key={section.id} onClick={()=>{const target=document.getElementById(section.id);target?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});target?.setAttribute('tabindex','-1');target?.focus({preventScroll:true});}}>{section.title}<ChevronLeft size={13}/></button>)}</div></nav>;
}
