'use client';

export default function GlobalError({reset}:{error:Error & {digest?:string};reset:()=>void}) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{margin:0,minHeight:'100vh',fontFamily:'Arial,Tahoma,sans-serif',background:'#f6f8f7',color:'#1b2925'}}>
        <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24}}>
          <section style={{width:'min(100%,520px)',background:'#fff',border:'1px solid #e1e8e4',borderRadius:20,padding:28,boxShadow:'0 12px 40px rgba(20,50,40,.08)'}}>
            <p style={{fontSize:13,fontWeight:700,color:'#b45309'}}>تعذر تحميل التطبيق</p>
            <h1 style={{fontSize:24}}>حدث خطأ غير متوقع</h1>
            <p style={{fontSize:15,lineHeight:1.9,color:'#52625b'}}>لم يتم حذف أو تعديل أي بيانات بسبب هذا الخطأ. أعد المحاولة، وإذا استمر فحدّث الصفحة.</p>
            <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              <button onClick={reset} style={{border:0,borderRadius:10,padding:'11px 18px',background:'#176b55',color:'#fff',fontWeight:700,cursor:'pointer'}}>إعادة المحاولة</button>
              <button onClick={()=>window.location.reload()} style={{border:'1px solid #d5dfda',borderRadius:10,padding:'11px 18px',background:'#fff',color:'#263b33',fontWeight:700,cursor:'pointer'}}>تحديث الصفحة</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
