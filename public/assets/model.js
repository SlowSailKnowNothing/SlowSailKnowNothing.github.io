export const SECTION_LABELS = {projects:'最近专注的项目', phone:'手机使用', sleep:'睡眠', exercise:'运动', reading:'最近在读', thoughts:'最近思考'};
export const METRICS = {
  exercise: {label:'运动', field:'exerciseMinutes', description:'按运动分钟数着色；确认运动但未记时长会单独标示。', title:'运动记录', legend:[['missing','未记录'],['done','已运动 · 时长未记录'],['not_done','确认未运动'],['zero','0 分钟'],['low','1–19 分钟'],['mid','20–39 分钟'],['high','40+ 分钟']]},
  reading: {label:'阅读', field:'readingMinutes', description:'按阅读分钟数着色，每格一天。', title:'阅读时长', legend:[['missing','未记录'],['zero','0 分钟'],['low','1–19 分钟'],['mid','20–39 分钟'],['high','40+ 分钟']]},
  review: {label:'复盘', field:'reviewCompleted', description:'按当天是否完成复盘着色，每格一天。', title:'复盘状态', legend:[['missing','未记录'],['zero','确认未完成'],['high','已完成']]}
};
export function dateInTimezone(timezone, now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function dayKey(date) { return date.toISOString().slice(0,10); }
export function calendarDays(today) {
  const end = new Date(today+'T12:00:00Z');
  const weekday = (end.getUTCDay()+6)%7;
  end.setUTCDate(end.getUTCDate()+(6-weekday));
  const start = new Date(end); start.setUTCDate(start.getUTCDate()-83);
  return Array.from({length:84},(_,index)=>{const date=new Date(start);date.setUTCDate(date.getUTCDate()+index);return dayKey(date);});
}
export function habitValue(day,metric) {
  if(metric==='exercise' && (day?.exerciseMinutes===null || day?.exerciseMinutes===undefined)){
    if(day?.exerciseCompleted===true)return 'completed';
    if(day?.exerciseCompleted===false)return 'not_completed';
  }
  return day?.[METRICS[metric].field]??null;
}
export function levelFor(value, metric) {
  if(metric==='exercise' && value==='completed')return 'done';
  if(metric==='exercise' && value==='not_completed')return 'not_done';
  if(value===null || value===undefined)return 'missing';
  if(metric==='review') return value ? 'high' : 'zero';
  if(value===0)return 'zero';
  return value<20?'low':value<40?'mid':'high';
}
export function valueText(value,metric) {
  if(metric==='exercise' && value==='completed')return '已运动，时长未记录';
  if(metric==='exercise' && value==='not_completed')return '确认未运动';
  if(value===null||value===undefined)return '未记录';
  if(metric==='review')return value?'已完成':'确认未完成';
  return `${value} 分钟`;
}
export function validateData(data) {
  if(!data||data.schemaVersion!==1)throw new Error('Unsupported schema version');
  if(!['Asia/Shanghai','Etc/UTC'].includes(data.timezone))throw new Error('Unsupported timezone');
  if(data.updatedAt!==null&&(typeof data.updatedAt!=='string'||!Number.isFinite(Date.parse(data.updatedAt))))throw new Error('Invalid updatedAt');
  if(data.summaryDate!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.summaryDate)||!Number.isFinite(Date.parse(data.summaryDate))||new Date(data.summaryDate).toISOString().slice(0,10)!==data.summaryDate))throw new Error('Invalid summary date');
  for(const key of Object.keys(SECTION_LABELS)){
    const section=data.sections?.[key];
    if(!section||!Array.isArray(section.paragraphs)||section.paragraphs.length>8||section.paragraphs.some(x=>typeof x!=='string'||[...x].length>2000))throw new Error(`Invalid ${key} section`);
  }
  if(!Array.isArray(data.days)||!Array.isArray(data.archive))throw new Error('Missing records');
  const seen=new Set();
  for(const d of data.days){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date||seen.has(d.date))throw new Error('Invalid or duplicate date');
    seen.add(d.date);
    for(const k of ['exerciseMinutes','readingMinutes'])if(d[k]!==null&&d[k]!==undefined&&(!Number.isInteger(d[k])||d[k]<0||d[k]>1440))throw new Error('Invalid minutes');
    if(d.exerciseCompleted!==null&&d.exerciseCompleted!==undefined&&typeof d.exerciseCompleted!=='boolean')throw new Error('Invalid exercise status');
    if(d.reviewCompleted!==null&&d.reviewCompleted!==undefined&&typeof d.reviewCompleted!=='boolean')throw new Error('Invalid review status');
  }
  for(const item of data.archive)if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||typeof item.title!=='string'||!Array.isArray(item.paragraphs)||item.paragraphs.some(x=>typeof x!=='string'))throw new Error('Invalid archive');
  return data;
}
