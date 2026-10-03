// Mizan production auth: deployed through the Cloudflare production workflow.
export type AccessEnvironment={DB:D1Database};

const SESSION_COOKIE='mizan_session';
const SESSION_SECONDS=60*60*24*7;
const LOGIN_WINDOW_SECONDS=15*60;
const MAX_ATTEMPTS=5;
const USERS=[{
  email:'famaradona89@gmail.com',
  workspace:'cloudflare-owner',
  iterations:210000,
  salt:'nqjxDvXZeKczfg_L5_XInw',
  verifier:'oM-jcXP6aBfAKc1GKFFFl5Xlh8edlCYB85bgCUgNS28'
}] as const;

export class AccessError extends Error{
  constructor(public status:number,message:string){super(message);}
}
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeB64url(value:string){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function sha256(value:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
function constantTime(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
async function verifyPassword(password:string,user:(typeof USERS)[number]){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:decodeB64url(user.salt),iterations:user.iterations},material,256);
  return constantTime(new Uint8Array(bits),decodeB64url(user.verifier));
}
function cookieValue(request:Request,name:string){
  const header=request.headers.get('cookie')||'';
  for(const part of header.split(';')){const [k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='));}
  return '';
}
function sessionCookie(token:string,maxAge=SESSION_SECONDS){
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function attemptKey(request:Request,email:string){return sha256((request.headers.get('cf-connecting-ip')||'unknown')+'|'+email);}
async function checkRateLimit(request:Request,env:AccessEnvironment,email:string){
  const key=await attemptKey(request,email),now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare('SELECT count, first_attempt FROM auth_attempts WHERE id=?').bind(key).first<any>();
  if(row&&now-row.first_attempt<LOGIN_WINDOW_SECONDS&&row.count>=MAX_ATTEMPTS)throw new AccessError(429,'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.');
  if(row&&now-row.first_attempt>=LOGIN_WINDOW_SECONDS)await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(key).run();
  return key;
}
async function recordFailure(env:AccessEnvironment,key:string){
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO auth_attempts(id,count,first_attempt) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET count=CASE WHEN ?-first_attempt>=? THEN 1 ELSE count+1 END,
    first_attempt=CASE WHEN ?-first_attempt>=? THEN ? ELSE first_attempt END`)
    .bind(key,now,now,LOGIN_WINDOW_SECONDS,now,LOGIN_WINDOW_SECONDS,now).run();
}
export async function login(request:Request,env:AccessEnvironment){
  if(request.method!=='POST')throw new AccessError(405,'طريقة الطلب غير مسموحة.');
  const ct=request.headers.get('content-type')||'';
  if(!ct.includes('application/json'))throw new AccessError(415,'نوع الطلب غير مدعوم.');
  const raw=await request.text();if(raw.length>10000)throw new AccessError(413,'الطلب أكبر من المسموح.');
  let body:any;try{body=JSON.parse(raw);}catch{throw new AccessError(400,'بيانات الدخول غير صحيحة.');}
  const email=String(body.email||'').trim().toLowerCase();
  const password=String(body.password||'');
  if(password.length<8||password.length>200||!/^\S+@\S+\.\S+$/.test(email))throw new AccessError(401,'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  const key=await checkRateLimit(request,env,email);
  const user=USERS.find(u=>u.email===email);
  if(!user||!await verifyPassword(password,user)){await recordFailure(env,key);throw new AccessError(401,'البريد الإلكتروني أو كلمة المرور غير صحيحة.');}
  await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(key).run();
  const random=new Uint8Array(32);crypto.getRandomValues(random);const token=b64url(random),id=await sha256(token);
  const now=Math.floor(Date.now()/1000),expires=now+SESSION_SECONDS;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires<=?').bind(now).run();
  await env.DB.prepare('INSERT INTO auth_sessions(id,email,workspace,expires,created) VALUES(?,?,?,?,?)').bind(id,user.email,user.workspace,expires,now).run();
  return new Response(JSON.stringify({ok:true,email:user.email}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Set-Cookie':sessionCookie(token)}});
}
export async function logout(request:Request,env:AccessEnvironment){
  const token=cookieValue(request,SESSION_COOKIE);
  if(token){try{await env.DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(await sha256(token)).run();}catch{}}
  return new Response(null,{status:302,headers:{Location:'/login','Set-Cookie':sessionCookie('',0)}});
}
export async function verifyAccess(request:Request,env:AccessEnvironment):Promise<{workspace:string;email:string}>{
  const token=cookieValue(request,SESSION_COOKIE);
  if(!token||token.length>256)throw new AccessError(401,'سجل الدخول للوصول إلى بياناتك.');
  const id=await sha256(token),now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare('SELECT email,workspace,expires FROM auth_sessions WHERE id=?').bind(id).first<any>();
  if(!row||row.expires<=now){if(row)await env.DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(id).run();throw new AccessError(401,'انتهت الجلسة. سجل الدخول مجددًا.');}
  return {workspace:String(row.workspace),email:String(row.email)};
}
