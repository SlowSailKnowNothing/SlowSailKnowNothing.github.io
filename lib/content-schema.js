// Only this explicit public DTO can be committed by the administration API.
import {validateData,SECTION_LABELS} from '../public/assets/model.js';
import {validatePublicReading} from '../public/assets/reading-model.js';
const fail=()=>{const e=new Error('invalid_content');e.status=400;throw e;};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function keys(x,allowed){if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail();}
function text(x,max=4000){if(typeof x!=='string'||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(x))fail();return x;}
function list(x,max){if(!Array.isArray(x)||x.length>max)fail();return x;}
function timestamp(x){if(x!==null&&(typeof x!=='string'||x.length>40||!Number.isFinite(Date.parse(x))))fail();return x;}
function publicBookUrl(x){
 if(x===null)return null;if(typeof x!=='string'||x.length>2000)fail();
 let u;try{u=new URL(x);}catch{fail();}if(u.protocol!=='https:'||u.hostname!=='weread.qq.com'||u.username||u.password||u.port)fail();return x;
}
export function privacyIssues(value){
 const raw=typeof value==='string'?value:JSON.stringify(value);
 const tests=[['secret',/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/],['email',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],['identity_number',/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?!\d)/i],['phone',/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/]];
 return tests.filter(([,test])=>test.test(raw)).map(([name])=>name);
}
export function validatePublicSite(value){
 try{
  keys(value,['schemaVersion','today','reading']);if(value.schemaVersion!==1)fail();
  const t=value.today;keys(t,['schemaVersion','timezone','updatedAt','summaryDate','sections','days','archive']);validateData(t);
  keys(t.sections,Object.keys(SECTION_LABELS));for(const key of Object.keys(SECTION_LABELS)){keys(t.sections[key],['paragraphs']);for(const p of t.sections[key].paragraphs)text(p,4000);}
  for(const d of list(t.days,10000))keys(d,['date','exerciseMinutes','readingMinutes','exerciseCompleted','reviewCompleted']);
  const dates=new Set();for(const a of list(t.archive,3000)){keys(a,['date','title','paragraphs']);if(dates.has(a.date)||new Date(a.date).toISOString().slice(0,10)!==a.date)fail();dates.add(a.date);text(a.title,160);for(const p of list(a.paragraphs,12))text(p,4000);}
  const r=value.reading;keys(r,['schemaVersion','updatedAt','currentBooks','week','entries']);validatePublicReading(r);timestamp(r.updatedAt);
  for(const b of list(r.currentBooks,50)){keys(b,['id','title','author','sourceUrl']);text(b.id,120);text(b.title,300);if(b.author!==undefined)text(b.author,300);if(b.sourceUrl!==undefined)publicBookUrl(b.sourceUrl);}
  if(r.week!==null){keys(r.week,['label','totalSeconds','readingSeconds','listeningSeconds']);text(r.week.label,120);}
  for(const c of list(r.entries,100)){keys(c,['id','illustration','bookId','bookTitle','author','chapterTitle','topics','quoteText','thoughtText','assistantSummary','sourceUrl','illustrationOrigin']);for(const k of ['id','bookId','bookTitle'])text(c[k],300);for(const k of ['author','chapterTitle','illustrationOrigin'])if(c[k]!==undefined)text(c[k],300);for(const q of list(c.topics,16))text(q,80);text(c.quoteText,20000);text(c.thoughtText,10000);text(c.assistantSummary,4000);if(c.sourceUrl!==undefined)publicBookUrl(c.sourceUrl);if(c.illustration!==undefined&&(typeof c.illustration!=='string'||!/^\/assets\/[A-Za-z0-9/_-]+\.(webp|png|svg|jpg)$/.test(c.illustration)))fail();}
  if(privacyIssues(value).length)fail();
  return JSON.parse(JSON.stringify(value));
 }catch(e){if(e.message==='invalid_content')throw e;fail();}
}

// A frozen public reading corpus is an independent trust boundary. Do not pass
// through unknown fields from exports, object stores, or repository contents.
export function validatePublicReadingLibrary(value){
 try{
  keys(value,['version','snapshotTotal','items','books','topics']);
  if(typeof value.version!=='string'||!/^[a-f0-9]{64}$/.test(value.version)||!Number.isInteger(value.snapshotTotal)||value.snapshotTotal<0||value.snapshotTotal>12000)fail();
  const opaque=(id,prefix)=>{if(typeof id!=='string'||!new RegExp('^'+prefix+'-[a-f0-9]{24}$').test(id))fail();return id;};
  const bookIds=new Set(),topicIds=new Set(),cardIds=new Set();
  const books=list(value.books,12000).map(b=>{keys(b,['bookId','bookTitle','author','count']);opaque(b.bookId,'pb');if(bookIds.has(b.bookId)||!Number.isInteger(b.count)||b.count<1||b.count>value.snapshotTotal)fail();bookIds.add(b.bookId);return {bookId:b.bookId,bookTitle:text(b.bookTitle,300),author:text(b.author,300),count:b.count};});
  const topics=list(value.topics,500).map(t=>{keys(t,['topic','count']);text(t.topic,80);if(!t.topic.trim()||t.topic!==t.topic.trim()||topicIds.has(t.topic)||!Number.isInteger(t.count)||t.count<1||t.count>value.snapshotTotal)fail();topicIds.add(t.topic);return {topic:t.topic,count:t.count};});
  const bookMap=new Map(books.map(b=>[b.bookId,b]));const bookCounts=new Map(),topicCounts=new Map();
  const items=list(value.items,12000).map(c=>{
   keys(c,['id','bookId','bookTitle','author','chapterTitle','topics','quoteText','thoughtText','sourceUrl','quoteAvailability']);opaque(c.id,'pc');opaque(c.bookId,'pb');if(cardIds.has(c.id)||!bookIds.has(c.bookId))fail();cardIds.add(c.id);
   const book=bookMap.get(c.bookId);if(c.bookTitle!==book.bookTitle||c.author!==book.author||c.sourceUrl!==null||!['present','unavailable'].includes(c.quoteAvailability))fail();
   text(c.bookTitle,300);text(c.author,300);text(c.chapterTitle,500);text(c.quoteText,20000);text(c.thoughtText,20000);
   if((c.quoteAvailability==='present')!==Boolean(c.quoteText.trim()))fail();
   const categoryIds=list(c.topics,16).map(t=>{if(!topicIds.has(t))fail();return t;});if(new Set(categoryIds).size!==categoryIds.length)fail();
   bookCounts.set(c.bookId,(bookCounts.get(c.bookId)||0)+1);for(const t of categoryIds)topicCounts.set(t,(topicCounts.get(t)||0)+1);
   return {id:c.id,bookId:c.bookId,bookTitle:c.bookTitle,author:c.author,chapterTitle:c.chapterTitle,topics:categoryIds,quoteText:c.quoteText,thoughtText:c.thoughtText,sourceUrl:null,quoteAvailability:c.quoteAvailability};
  });
  if(items.length!==value.snapshotTotal||books.some(b=>bookCounts.get(b.bookId)!==b.count)||topics.some(t=>topicCounts.get(t.topic)!==t.count))fail();
  const result={version:value.version,snapshotTotal:value.snapshotTotal,items,books,topics};
  // Opaque IDs and the version are already constrained to fixed-length hex.
  // Their random digits can resemble phone numbers; exclude only these exact
  // validated fields, never display text, URLs, or unknown input properties.
  const display={snapshotTotal:result.snapshotTotal,
   items:result.items.map(({id,bookId,...visible})=>visible),
   books:result.books.map(({bookId,...visible})=>visible),topics:result.topics};
  if(privacyIssues(display).length)fail();
  return result;
 }catch(e){if(e.message==='invalid_content')throw e;fail();}
}
