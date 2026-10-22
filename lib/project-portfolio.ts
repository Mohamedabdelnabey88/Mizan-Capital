/** Project hierarchy selectors used by cards, branch search and roll-up accounting. */
export type PortfolioProject={id:string;data:{parentId?:unknown;name?:unknown;activity?:unknown}};
export type PortfolioLease={data:{status?:unknown;startDate?:unknown;endDate?:unknown}};
/** Descendants are unique and never include the parent, even in malformed cyclic imports. */
export function projectDescendantIds(projects:PortfolioProject[],parentId:string){
 const children=new Map<string,string[]>();
 for(const project of projects){const parent=String(project.data.parentId||'');if(!parent)continue;const list=children.get(parent)||[];list.push(project.id);children.set(parent,list);}
 const seen=new Set<string>([parentId]),result:string[]=[],queue=[parentId];
 for(let index=0;index<queue.length;index++)for(const id of children.get(queue[index])||[]){if(seen.has(id))continue;seen.add(id);result.push(id);queue.push(id);}
 return result;
}
/** Text search includes all descendant levels, not only immediate units. */
export function matchesProjectTree(projects:PortfolioProject[],project:PortfolioProject,search:string){
 const query=search.trim().toLocaleLowerCase('ar');
 if(!query)return true;
 const ids=new Set([project.id,...projectDescendantIds(projects,project.id)]);
 return projects.some(p=>ids.has(p.id)&&[p.data.name,p.data.activity].some(text=>String(text||'').toLocaleLowerCase('ar').includes(query)));
}
/** Return an ongoing lease first, otherwise the next future lease; never an expired lease. */
export function relevantLease<T extends PortfolioLease>(leases:T[],asOf:string){
 const active=leases.filter(l=>l.data.status==='active'&&String(l.data.startDate||'')<=asOf&&String(l.data.endDate||'')>=asOf)
   .sort((a,b)=>String(b.data.startDate).localeCompare(String(a.data.startDate)));
 if(active.length)return active[0];
 return leases.filter(l=>l.data.status==='active'&&String(l.data.startDate||'')>asOf&&String(l.data.endDate||'')>=String(l.data.startDate||''))
   .sort((a,b)=>String(a.data.startDate).localeCompare(String(b.data.startDate)))[0];
}
