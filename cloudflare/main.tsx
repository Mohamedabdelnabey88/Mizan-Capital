import {lazy,Suspense,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,ShieldCheck,Wallet,Users,Mail,LoaderCircle} from 'lucide-react';
import '../app/globals.css';
import './login.css';
const Home=lazy(()=>import('../app/page'));
function App(){
 const [status,setStatus]=useState<'loading'|'ready'|'login'|'setup'|'denied'>('loading');
 const [email,setEmail]=useState('');
 const [message,setMessage]=useState('');
 const [password,setPassword]=useState('');
 const [submitting,setSubmitting]=useState(false);
 async function submitLogin(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(submitting)return;
  setSubmitting(true);setMessage('');
  try{
   const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:email.trim(),password})});
   const payload=await response.json().catch(()=>({})) as {error?:string};
   if(!response.ok){setMessage(payload.error||'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.');return;}
   window.location.replace('/');
  }catch{setMessage('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وأعد المحاولة.');}
  finally{setSubmitting(false);}
 }
 useEffect(()=>{const controller=new AbortController();
  fetch('/api/session',{cache:'no-store',redirect:'manual',signal:controller.signal}).then(async response=>{
   if(response.status===503){setStatus('setup');return;}
   if(response.status===403){setStatus('denied');return;}
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json')){setStatus('login');return;}
   const data=await response.json() as {email?:unknown};if(typeof data.email!=='string'){setStatus('login');return;}
   setEmail(data.email);setStatus('ready');
  }).catch(error=>{if(error.name!=='AbortError'){setMessage('تعذر التحقق من الجلسة. يمكنك تسجيل الدخول أو المحاولة مجددًا.');setStatus('login');}});
  return()=>controller.abort();
 },[]);
 if(status==='ready'&&location.pathname!=='/login')return <Suspense fallback={<div className="mizan-loading" role="status">جاري فتح مساحة العمل…</div>}><Home signInHref="/login" signOutHref="/auth/logout"/></Suspense>;
 return <main className="mizan-login" dir="rtl"><section className="login-story" aria-label="ميزان"><div className="login-brand"><span><Wallet size={29}/></span><div><b>ميزان</b><small>MIZAN CAPITAL</small></div></div><div className="login-story-body"><span className="login-kicker">وضوح في الأرقام. ثقة في القرار.</span><h1>صورة مالية واحدة،<br/>لفريقك كله.</h1><p>تابعوا المشاريع والالتزامات والتدفقات النقدية من مساحة عمل مشتركة، بأرقام محدثة وسجل واضح للعمليات.</p><div className="login-features"><span><Users size={19}/> مساحة مشتركة لفريقك</span><span><ShieldCheck size={19}/> دخول خاص لكل مستخدم</span></div></div><small className="login-story-footer">إدارة رأس المال تبدأ برؤية واضحة.</small></section><section className="login-form-side"><div className="login-card"><span className="login-icon"><ShieldCheck size={28}/></span><p className="login-kicker">أهلًا بك في ميزان</p><h2>{status==='ready'?'مساحة العمل جاهزة':'تسجيل الدخول'}</h2><p className="login-description">ادخل ببريدك الإلكتروني وكلمة المرور للوصول إلى مساحة ميزان.</p>{status==='loading'?<p className="login-status" role="status"><LoaderCircle className="login-spinner" size={19}/>جاري التحقق من الجلسة…</p>:status==='setup'?<div className="login-notice" role="status">الموقع جاهز، وجاري استكمال إعداد تسجيل الدخول. تواصل مع مسؤول المساحة لتفعيل الدخول.</div>:status==='denied'?<><div className="login-notice" role="alert">هذا البريد غير مصرح له بدخول مساحة ميزان. اطلب من مسؤول المساحة إضافته.</div><a className="login-cta" href="/auth/logout">تغيير الحساب<ArrowLeft size={18}/></a></>:<>{status==='ready'?<><div className="login-method"><Mail size={21}/><div><b>{email}</b><small>تم التحقق من هويتك</small></div></div><button type="button" className="login-cta" onClick={()=>window.location.replace("/")}>فتح مساحة العمل<ArrowLeft size={18}/></button><a className="login-switch" href="/auth/logout">تسجيل الخروج وتغيير الحساب</a></>:<form className="login-credentials" onSubmit={submitLogin}><label htmlFor="mizan-email">البريد الإلكتروني</label><input id="mizan-email" type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required disabled={submitting}/><label htmlFor="mizan-password">كلمة المرور</label><input id="mizan-password" type="password" name="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="كلمة المرور" minLength={8} required disabled={submitting}/>{message&&<p className="login-notice" role="alert">{message}</p>}<button className="login-cta" type="submit" disabled={submitting}>{submitting?'جاري تسجيل الدخول…':'تسجيل الدخول'}<ArrowLeft size={18}/></button></form>}</>}<p className="login-private"><ShieldCheck size={15}/> الدخول متاح فقط لأعضاء الفريق المعتمدين</p></div><footer className="login-footer">ميزان — إدارة رأس المال والمشاريع</footer></section></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
