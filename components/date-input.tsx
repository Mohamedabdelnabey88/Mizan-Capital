'use client';
import {useEffect,useId,useRef,useState,type ChangeEvent,type FocusEvent,type InputHTMLAttributes} from 'react';
import {CalendarDays,Check,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {DayPicker} from 'react-day-picker';
import {arSA} from 'react-day-picker/locale';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {today} from '@/lib/finance';
import {calendarMonths,calendarValueLabel,parseCalendarDate,serializeCalendarDate,withinCalendarBounds,type CalendarPrecision} from '@/lib/calendar-date';
import './date-input.css';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'min'|'max'> & {type?:CalendarPrecision;value?:string;min?:string;max?:string};

/** A single styled, keyboard accessible picker for every date/month field, including financial dialogs. */
export function DateInput({type='date',value='',min,max,required,disabled,readOnly,onChange,onBlur,name,id,className='',placeholder,'aria-label':label,...rest}:Props){
 const [open,setOpen]=useState(false),[invalid,setInvalid]=useState(false),[displayMonth,setDisplayMonth]=useState(()=>parseCalendarDate(value,type)||parseCalendarDate(today())!);
 const input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),generatedId=useId();
 const inputId=id||generatedId,precision=type,selected=parseCalendarDate(value,precision),month=displayMonth.getMonth(),year=displayMonth.getFullYear();
 const title=precision==='month'?'اختر الشهر والسنة':'اختر التاريخ',current=today(),currentValue=precision==='month'?current.slice(0,7):current;
 const firstYear=min?Number(min.slice(0,4)):Math.min(1900,year),lastYear=max?Number(max.slice(0,4)):Math.max(new Date().getFullYear()+50,year);
 const valid=!value?!required:withinCalendarBounds(value,precision,min,max);
 useEffect(()=>{input.current?.setCustomValidity(valid?'':!value?'اختر '+(precision==='month'?'شهرًا':'تاريخًا')+' قبل المتابعة.':'التاريخ خارج الفترة المسموح بها.');},[valid,value,precision]);
 const change=(next:string)=>{
  if(next&&!withinCalendarBounds(next,precision,min,max))return;
  setInvalid(false);onChange?.({target:{value:next,name:name||''},currentTarget:{value:next,name:name||''}} as ChangeEvent<HTMLInputElement>);setOpen(false);
 };
 const openPicker=(next:boolean)=>{if(next&&(disabled||readOnly))return;if(next){const preferred=selected||parseCalendarDate(current)!;const low=parseCalendarDate(min||'',precision),high=parseCalendarDate(max||'',precision);setDisplayMonth(low&&preferred<low?low:high&&preferred>high?high:preferred);}setOpen(next);};
 const changeYear=(nextYear:number)=>{const lower=min&&nextYear===Number(min.slice(0,4))?Number(min.slice(5,7))-1:0,upper=max&&nextYear===Number(max.slice(0,4))?Number(max.slice(5,7))-1:11;setDisplayMonth(new Date(nextYear,Math.max(lower,Math.min(upper,month)),1,12));};
 const move=(amount:number)=>setDisplayMonth(new Date(year,month+(precision==='month'?amount*12:amount),1,12));
 const previous=precision==='month'?String(year-1)+'-12':serializeCalendarDate(new Date(year,month-1,1,12),'month');
 const next=precision==='month'?String(year+1)+'-01':serializeCalendarDate(new Date(year,month+1,1,12),'month');
 return <span className={'mizan-date-field '+className} data-empty={!value} data-invalid={invalid}>
  <input {...rest} ref={input} className="mizan-date-validation" id={inputId+'-value'} type="text" tabIndex={-1} aria-hidden="true" name={name} value={value} required={required} disabled={disabled} readOnly={readOnly} onChange={()=>{}} onInvalid={event=>{event.preventDefault();setInvalid(true);openPicker(true);trigger.current?.focus();}}/>
  <Popover open={open} onOpenChange={openPicker}><PopoverTrigger asChild><button ref={trigger} id={inputId} type="button" role="combobox" aria-expanded={open} aria-controls={inputId+'-picker'} aria-haspopup="dialog" aria-required={required||undefined} className="mizan-date-trigger" disabled={disabled} aria-label={label} aria-invalid={invalid||undefined} aria-describedby={invalid?inputId+'-error':undefined} onBlur={event=>onBlur?.(event as unknown as FocusEvent<HTMLInputElement>)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();openPicker(true);}}}>
   <span className="mizan-date-symbol"><CalendarDays size={19}/></span><span className="mizan-date-value"><strong>{calendarValueLabel(value,precision)||placeholder||(precision==='month'?'حدد الشهر والسنة':'حدد اليوم والشهر والسنة')}</strong>{value&&<small dir="ltr">{value}</small>}</span><ChevronLeft size={15} className="mizan-date-chevron"/>
  </button></PopoverTrigger>
  <PopoverContent id={inputId+'-picker'} aria-label={title} dir="rtl" className="mizan-date-popover" align="start" sideOffset={9} collisionPadding={12} onOpenAutoFocus={event=>{if(precision==='month'){event.preventDefault();requestAnimationFrame(()=>document.getElementById(inputId+'-months')?.querySelector<HTMLElement>('button[aria-pressed=true],button:not(:disabled)')?.focus());}}}>
   <div className="mizan-date-heading"><span><CalendarDays size={17}/>{title}</span><button type="button" aria-label="إغلاق التقويم" onClick={()=>setOpen(false)}><X size={17}/></button></div>
   <div className="mizan-date-navigation"><button type="button" aria-label={precision==='month'?'السنة السابقة':'الشهر السابق'} disabled={!!min&&previous<min.slice(0,7)} onClick={()=>move(-1)}><ChevronRight size={18}/></button><div>{precision==='date'&&<select aria-label="اختر الشهر" value={month} onChange={event=>setDisplayMonth(new Date(year,Number(event.target.value),1,12))}>{calendarMonths.map((name,index)=><option key={name} value={index} disabled={!!min&&year===Number(min.slice(0,4))&&index<Number(min.slice(5,7))-1||!!max&&year===Number(max.slice(0,4))&&index>Number(max.slice(5,7))-1}>{name}</option>)}</select>}<select aria-label="اختر السنة" value={year} onChange={event=>changeYear(Number(event.target.value))}>{Array.from({length:Math.max(1,lastYear-firstYear+1)},(_,index)=>firstYear+index).map(year=><option key={year} value={year}>{year}</option>)}</select></div><button type="button" aria-label={precision==='month'?'السنة التالية':'الشهر التالي'} disabled={!!max&&next>max.slice(0,7)} onClick={()=>move(1)}><ChevronLeft size={18}/></button></div>
   {precision==='date'?<DayPicker locale={arSA} dir="rtl" weekStartsOn={6} mode="single" selected={selected} month={displayMonth} onMonthChange={setDisplayMonth} onSelect={date=>{if(date)change(serializeCalendarDate(date));}} autoFocus hideNavigation showOutsideDays fixedWeeks disabled={[...(min?[{before:parseCalendarDate(min)!}]:[]),...(max?[{after:parseCalendarDate(max)!}]:[])]} className="mizan-day-picker" classNames={{month_caption:'mizan-date-hidden',outside:'mizan-date-outside',today:'mizan-date-today',selected:'mizan-date-selected',disabled:'mizan-date-disabled'}} formatters={{formatWeekdayName:date=>['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'][date.getDay()],formatDay:date=>String(date.getDate())}}/>:<div className="mizan-month-grid" id={inputId+'-months'} role="group" aria-label={'أشهر سنة '+year}>{calendarMonths.map((name,index)=>{const date=year+'-'+String(index+1).padStart(2,'0');return <button type="button" key={name} aria-pressed={date===value} disabled={!withinCalendarBounds(date,'month',min,max)} className={date===current.slice(0,7)?'mizan-month-current':''} onClick={()=>change(date)}><span>{String(index+1).padStart(2,'0')}</span>{name}{date===value&&<Check size={14}/>}</button>;})}</div>}
   <div className="mizan-date-selection"><span>{value?(precision==='month'?'الشهر المحدد':'التاريخ المحدد'):'لم تحدد '+(precision==='month'?'شهرًا':'تاريخًا')+' بعد'}</span>{value&&<b>{calendarValueLabel(value,precision)}</b>}</div>
   <div className="mizan-date-footer"><button type="button" disabled={!withinCalendarBounds(currentValue,precision,min,max)} onClick={()=>change(currentValue)}>{precision==='month'?'هذا الشهر':'اليوم'}</button>{!required&&<button type="button" disabled={!value} onClick={()=>change('')}>مسح الاختيار</button>}<span>تقويم ميلادي</span></div>
  </PopoverContent></Popover>
  {invalid&&<span id={inputId+'-error'} className="mizan-date-error" role="alert">{value?'اختر تاريخًا داخل النطاق المسموح.':'اختر '+(precision==='month'?'الشهر':'التاريخ')+' للمتابعة.'}</span>}
 </span>;
}
