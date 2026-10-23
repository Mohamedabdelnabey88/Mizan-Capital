'use client';
import {useState,type ReactNode} from 'react';
import {Search,ChevronLeft} from 'lucide-react';
export const workspaceGroups=[
 {title:'المتابعة اليومية',ids:['dashboard','projects','daily']},
 {title:'السداد والتحصيل',ids:['commitments','calendar','contracts','team']},
 {title:'الأموال والحسابات',ids:['ledger','capital','loans','personalLoans']},
 {title:'التخطيط والمراجعة',ids:['cashflow','reports','decisions','risks','settings']},
];
export const pageGuides:Record<string,{title:string;description:string;links:string[]}>= {
 dashboard:{title:'ملخص أعمالك',description:'ابدأ بالمستحقات القريبة، ثم راجع الرصيد والربح. افتح أي قسم للاطلاع على تفاصيله.',links:['projects','commitments','daily']},
 projects:{title:'المشاريع والفروع',description:'اختر مشروعًا لتتابع تكاليفه وعقوده وفروعه، وما دفعته وما تبقى عليه.',links:['contracts','capital','reports']},
 daily:{title:'الدخل اليومي',description:'سجّل دخل كل مشروع حسب وسيلة الدفع. مبيعات البطاقات تظل مستحقات حتى تسجيل تسويتها.',links:['ledger','reports']},
 commitments:{title:'السداد والتحصيل',description:'اعرف المطلوب سداده، والمنتظر تحصيله، وما نُفّذ بالفعل. راجع العملية قبل تأكيد السداد.',links:['calendar','ledger','contracts']},
 calendar:{title:'المواعيد والاستحقاقات',description:'حدّد الفترة لعرض الاستحقاقات، أو اختر التقويم الشهري. التنفيذ الفعلي يظهر بتاريخ السداد أو التحصيل.',links:['commitments','contracts']},
 contracts:{title:'العقود والإيجارات',description:'تابع أطراف العقد ومدته وأقساطه. سداد الأقساط وتحصيلها من سجل الاستحقاقات.',links:['projects','commitments']},
 ledger:{title:'سجل الحركات المالية',description:'تتبّع أثر كل عملية على الحسابات. تصحيح الحركة يكون بقيد عكسي يحافظ على سجل المراجعة.',links:['daily','reports','capital']},
 capital:{title:'رأس المال وسلف المالك',description:'اعرف ما موّلته، وما عاد إليك، والمتبقي. التمويل والسلف لا يُحسبان إيرادًا أو ربحًا.',links:['projects','ledger','loans']},
 loans:{title:'قروض وتمويل المشاريع',description:'راجع أصل الدين والفائدة والأقساط المسددة والمتبقية قبل تسجيل الدفعة.',links:['commitments','personalLoans','capital']},
 personalLoans:{title:'القروض الشخصية',description:'تابع القروض المسجلة باسمك وتخصيصاتها للمشاريع، بشكل منفصل عن ربح التشغيل.',links:['loans','capital']},
 team:{title:'الموظفون والرواتب',description:'نظّم بيانات الموظفين وجداول رواتبهم، ثم تابع صرف كل استحقاق.',links:['commitments','calendar']},
 cashflow:{title:'تخطيط السيولة',description:'اختبر قدرة الرصيد على تغطية المواعيد القادمة. التوقع يعتمد على الالتزامات والتحصيلات المسجلة.',links:['commitments','decisions']},
 reports:{title:'التقارير المالية',description:'حدّد المشروع والفترة، ثم راجع الربح والمركز المالي وميزان المراجعة أو صدّر التقرير.',links:['ledger','daily']},
 decisions:{title:'اختبار القرارات',description:'اختبر أثر الصرف أو التوزيع على السيولة والاحتياطي قبل اتخاذ القرار.',links:['cashflow','reports']},
 risks:{title:'المخاطر والمتابعة',description:'تابع المخاطر المسجلة ومواعيد مراجعتها وأثرها على مشروعاتك.',links:['cashflow','projects']},
 settings:{title:'الإعدادات وسجل المراجعة',description:'راجع السياسات والفترات المالية وسجل العمليات والأرشيف.',links:['reports','ledger']},
};
export function NavigationSearch({children}:{children:(query:string)=>ReactNode}){
 const [query,setQuery]=useState('');
 return <><label className="workspace-nav-search"><Search size={16}/><input aria-label="البحث عن صفحة" placeholder="ابحث عن صفحة…" value={query} onChange={e=>setQuery(e.target.value)}/></label>{children(query.trim())}</>;
}
export function PageConnections({tab,label,onNavigate}:{tab:string;label:(id:string)=>string;onNavigate:(id:string)=>void}){
 const guide=pageGuides[tab];if(!guide)return null;
 return <nav className="workspace-connections" aria-label="صفحات مرتبطة"><span>مرتبط بـ</span>{guide.links.map(id=><button key={id} type="button" onClick={()=>onNavigate(id)}>{label(id)}<ChevronLeft size={14}/></button>)}</nav>;
}
