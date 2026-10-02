const BACKEND='https://mizan-capital.famaradona89.workers.dev';
export async function POST(request:Request){
 const upstream=await fetch(BACKEND+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:await request.text(),redirect:'manual',cache:'no-store'});
 const headers=new Headers({'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
 const cookie=upstream.headers.get('set-cookie'); if(cookie) headers.set('set-cookie',cookie);
 return new Response(upstream.body,{status:upstream.status,headers});
}