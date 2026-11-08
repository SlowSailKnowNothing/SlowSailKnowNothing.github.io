import {SECTION_LABELS,METRICS,dateInTimezone,calendarDays,habitValue,levelFor,valueText,validateData} from './model.js';
const $=id=>document.getElementById(id);
let data, metric='exercise', selectedDate=null, today, dates;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function renderSections(){
  const fragment=document.createDocumentFragment();
  for(const [key,label] of Object.entries(SECTION_LABELS)){
    const section=el('section','entry');section.id=key;const heading=el('h2','',label);heading.id=key+'-heading';section.setAttribute('aria-labelledby',heading.id);section.append(heading);
    const paragraphs=data.sections[key].paragraphs;
    if(!paragraphs.length)section.append(el('p','empty','待记录。'));
    else paragraphs.forEach(p=>section.append(el('p','',p)));
    fragment.append(section);
  }
  $('sections').replaceChildren(fragment);
  if(data.updatedAt){const dt=new Date(data.updatedAt);$('page-meta').textContent=`${data.summaryDate?data.summaryDate.replaceAll('-','/')+' 的近况 · ':''}${new Intl.DateTimeFormat('zh-CN',{timeZone:data.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(dt)} · 更新于 ${new Intl.DateTimeFormat('zh-CN',{timeZone:data.timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(dt)}`;}
  else $('page-meta').textContent='等待第一条记录';
}
function renderHeatmap(focusDate){
  const m=METRICS[metric], byDate=new Map(data.days.map(d=>[d.date,d]));
  $('habit-panel').setAttribute('aria-labelledby','tab-'+metric);
  $('metric-description').textContent=m.description;
  $('date-range').textContent=`${dates[0].slice(5).replace('-','.')}–${today.slice(5).replace('-','.')} · 12 周`;
  let month=''; const monthFrag=document.createDocumentFragment();
  for(let i=0;i<12;i++){const date=dates[i*7];const current=date.slice(0,7);monthFrag.append(el('span','',current!==month?Number(date.slice(5,7))+'月':''));month=current;}
  $('months').replaceChildren(monthFrag);
  const fragment=document.createDocumentFragment();let recorded=0;
  for(const date of dates){
    const value=habitValue(byDate.get(date),metric),future=date>today;
    if(!future&&value!==null)recorded++;
    const button=el('button','day '+(future?'future':levelFor(value,metric)));button.type='button';button.dataset.date=date;button.disabled=future;
    const description=`${date}，${m.label}：${future?'尚未到来':valueText(value,metric)}`;
    button.title=description;button.setAttribute('aria-label',description);button.setAttribute('aria-pressed',String(date===selectedDate));
    button.tabIndex=date===(focusDate||selectedDate||today)?0:-1;
    button.addEventListener('click',()=>{selectedDate=date;selectDay(button,description)});
    button.addEventListener('keydown',event=>{
      let offset={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[event.key];
      let index=dates.indexOf(date);if(event.key==='Home')offset=-index;if(event.key==='End')offset=dates.indexOf(today)-index;
      if(offset!==undefined){event.preventDefault();const target=$('heatmap').children[Math.max(0,Math.min(dates.indexOf(today),index+offset))];$('heatmap').querySelectorAll('button').forEach(b=>b.tabIndex=-1);target.tabIndex=0;target.focus();}
    });fragment.append(button);
  }
  $('heatmap').replaceChildren(fragment);
  $('record-count').textContent=recorded?`这 12 周记录了 ${recorded} 天`:'待记录';
  const legend=document.createDocumentFragment();legend.append(el('p','legend-title',m.title));
  for(const [cls,label] of m.legend){const row=el('div','legend-row');const swatch=el('span','swatch '+cls);swatch.setAttribute('aria-hidden','true');row.append(swatch,el('span','',label));legend.append(row);}$('legend').replaceChildren(legend);
  if(selectedDate)$('day-detail').textContent=`${selectedDate}，${m.label}：${valueText(habitValue(byDate.get(selectedDate),metric),metric)}`;
  else $('day-detail').textContent='选择一天，查看记录。';
}
function selectDay(button,description){
  $('heatmap').querySelectorAll('button').forEach(b=>{b.tabIndex=b===button?0:-1;b.setAttribute('aria-pressed',String(b===button))});$('day-detail').textContent=description;
}
function activateTab(button){
  metric=button.dataset.metric;document.querySelectorAll('[role="tab"]').forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1});renderHeatmap();
}
document.querySelectorAll('[role="tab"]').forEach((button,index)=>{
  button.addEventListener('click',()=>activateTab(button));
  button.addEventListener('keydown',event=>{let next;const tabs=[...document.querySelectorAll('[role="tab"]')];if(event.key==='ArrowRight')next=(index+1)%3;if(event.key==='ArrowLeft')next=(index+2)%3;if(event.key==='Home')next=0;if(event.key==='End')next=2;if(next!==undefined){event.preventDefault();activateTab(tabs[next]);tabs[next].focus();}});
});
$('archive-toggle').addEventListener('click',()=>{const open=$('archive').hidden;$('archive').hidden=!open;$('archive-toggle').setAttribute('aria-expanded',String(open));if(open)$('archive').scrollIntoView({block:'nearest'});});
$('about-open').addEventListener('click',()=>$('about').showModal());$('about-close').addEventListener('click',()=>$('about').close());
$('about').addEventListener('click',e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}});
function renderArchive(){
  $('archive-empty').hidden=data.archive.length>0;
  for(const item of [...data.archive].sort((a,b)=>b.date.localeCompare(a.date))){const li=el('li');const details=el('details');details.append(el('summary','',`${item.date} · ${item.title}`));item.paragraphs.forEach(p=>details.append(el('p','',p)));li.append(details);$('archive-list').append(li);}
}
async function init(){
  try{const response=await fetch('./data/today.json',{cache:'no-store'});if(!response.ok)throw new Error('Data request failed');data=validateData(await response.json());today=dateInTimezone(data.timezone);dates=calendarDays(today);renderSections();renderHeatmap();renderArchive();}
  catch(error){$('error').hidden=false;$('page-meta').textContent='记录暂不可用';document.querySelectorAll('[role="tab"]').forEach(b=>b.disabled=true);console.error(error);}
}
init();
