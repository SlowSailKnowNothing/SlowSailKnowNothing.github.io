export function readingDuration(seconds){
  if(seconds===null||seconds===undefined)return '待同步';
  if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid duration');
  if(seconds===0)return '0 分钟';
  if(seconds<60)return '不足 1 分钟';
  const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
  return hours?`${hours} 小时${minutes%60?` ${minutes%60} 分钟`:''}`:`${minutes} 分钟`;
}
export function safeReadingLink(value){
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='weread.qq.com'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function validatePublicReading(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.currentBooks)||!Array.isArray(data.entries))throw new Error('Invalid reading snapshot');
  if(data.updatedAt!==null&&!Number.isFinite(Date.parse(data.updatedAt)))throw new Error('Invalid update time');
  if(data.week!==null){
    if(typeof data.week.label!=='string')throw new Error('Missing week label');
    for(const field of ['totalSeconds','readingSeconds','listeningSeconds'])if(data.week[field]!==null&&(!Number.isInteger(data.week[field])||data.week[field]<0))throw new Error('Invalid reading statistics');
  }
  for(const book of data.currentBooks)if(typeof book.id!=='string'||typeof book.title!=='string')throw new Error('Invalid book');
  const ids=new Set();
  for(const entry of data.entries){
    if(typeof entry.id!=='string'||ids.has(entry.id)||typeof entry.bookId!=='string'||typeof entry.bookTitle!=='string'||!Array.isArray(entry.topics)||entry.topics.some(x=>typeof x!=='string'))throw new Error('Invalid entry');
    ids.add(entry.id);
    for(const field of ['quoteText','thoughtText','assistantSummary'])if(typeof entry[field]!=='string')throw new Error('Attribution fields must stay separate');
    // Approved associated excerpts are rendered in a scrollable card, never silently truncated.
    // This is an input-size guard, not an editorial claim that long excerpts are unapproved.
    if(entry.quoteText.length>20000)throw new Error('Associated excerpt exceeds the bounded card payload');
    if(entry.sourceUrl&&!safeReadingLink(entry.sourceUrl))throw new Error('Unverified source URL');
  }
  return data;
}
export function readingGroups(entries,mode){
  const groups=new Map();
  for(const entry of entries){
    const keys=mode==='topic'?(entry.topics.length?entry.topics:['未分类']):[entry.bookTitle];
    for(const key of keys){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b,'zh-CN'));
}
