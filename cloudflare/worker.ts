import {GET,POST} from './workspace';
import {verifyAccess,login,logout,AccessError,type AccessEnvironment} from './access';
export type WorkerEnvironment=AccessEnvironment & {DB:D1Database;ASSETS:Fetcher};
function secured(response:Response){
 const headers=new Headers(response.headers);
 headers.set('Cache-Control','no-store');
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','same-origin');
 headers.set('X-Frame-Options','DENY');
 return new Response(response.body,{status:response.status,headers});
}
export default {
 async fetch(request:Request,env:WorkerEnvironment):Promise<Response>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/'))return env.ASSETS.fetch(request);
  try{
   if(url.pathname==='/auth/login')return secured(await login(request,env));
   if(url.pathname==='/auth/logout')return secured(await logout(request,env));
   if(url.pathname==='/auth/health'){
    const sessions=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth_sessions','auth_attempts') ORDER BY name").all();
    return secured(Response.json({ok:true,tables:sessions.results?.map((r:any)=>r.name)||[]}));
   }
   const identity=await verifyAccess(request,env);
   if(url.pathname==='/api/session'){
    if(request.method!=='GET')return secured(new Response(null,{status:405,headers:{Allow:'GET'}}));
    return secured(Response.json({email:identity.email}));
   }
   if(url.pathname!=='/api/workspace')return secured(Response.json({error:'غير موجود'},{status:404}));
   if(!['GET','POST'].includes(request.method))return secured(new Response(null,{status:405,headers:{Allow:'GET, POST'}}));
   if(request.method==='POST'){
    const origin=request.headers.get('Origin');
    if(origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return secured(Response.json({error:'طلب غير مسموح'},{status:403}));
    const length=Number(request.headers.get('Content-Length')||0);
    if(length>100000)return secured(Response.json({error:'حجم الطلب أكبر من المسموح'},{status:413}));
   }
   const headers=new Headers(request.headers);
   for(const name of [...headers.keys()])if(name.toLowerCase().startsWith('oai-authenticated-'))headers.delete(name);
   headers.set('oai-authenticated-user-id',identity.workspace);
   headers.set('oai-authenticated-user-email',identity.email);
   const trusted=new Request(request,{headers});
   return secured(await (request.method==='POST'?POST(trusted):GET(trusted)));
  }catch(error){
   const status=error instanceof AccessError?error.status:503;
   const message=error instanceof AccessError?error.message:'تعذر إتمام الطلب. حاول مجددًا.';
   return secured(Response.json({error:message},{status}));
  }
 }
};
