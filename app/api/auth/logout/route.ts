const BACKEND='https://mizan-capital.famaradona89.workers.dev';
async function out(request:Request){
 const upstream=await fetch(BACKEND+'/auth/logout',{method:'POST',headers:{cookie:request.headers.get('cookie')||''},redirect:'manual',cache:'no-store'});
 const headers=new Headers({location:'/login','cache-control':'no-store'}); const cookie=upstream.headers.get('set-cookie'); if(cookie) headers.set('set-cookie',cookie);
 return new Response(null,{status:302,headers});
}
export async function GET(r:Request){return out(r)} export async function POST(r:Request){return out(r)}