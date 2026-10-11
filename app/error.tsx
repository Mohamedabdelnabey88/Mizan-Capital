'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Mizan page error:', error.digest || error.name || 'unknown');
  }, [error]);

  return (
    <main dir="rtl" lang="ar" style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f6f8f7',fontFamily:'Arial,Tahoma,sans-serif',color:'#1b2925'}}>
      <section style={{width:'min(100%,520px)',background:'#fff',border:'1px solid #e1e8e4',borderRadius:20,padding:28,boxShadow:'0 12px 40px rgba(20,50,40,.08)'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#b45309',marginBottom:12}}>تعذر عرض الصفحة</div>
        <h1 style={{fontSize:24,margin:'0 0 12px'}}>حدث خطأ مؤقت في ميزان</h1>
        <p style={{fontSize:15,lineHeight:1.9,color:'#52625b',margin:'0 0 22px'}}>لم يتم حذف أو تعديل أي بيانات بسبب عرض هذه الرسالة. يمكنك إعادة تحميل الجزء المتعطل، أو تحديث الصفحة كاملة إذا استمر الخطأ.</p>
        {error.digest && <p style={{fontSize:12,color:'#718078',margin:'0 0 16px'}}>رمز التشخيص: {error.digest}</p>}
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button onClick={reset} style={{border:0,borderRadius:10,padding:'11px 18px',background:'#176b55',color:'#fff',fontWeight:700,cursor:'pointer'}}>إعادة المحاولة</button>
          <button onClick={() => window.location.reload()} style={{border:'1px solid #d5dfda',borderRadius:10,padding:'11px 18px',background:'#fff',color:'#263b33',fontWeight:700,cursor:'pointer'}}>تحديث الصفحة</button>
        </div>
      </section>
    </main>
  );
}
