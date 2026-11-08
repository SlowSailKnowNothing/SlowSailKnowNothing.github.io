import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validatePublicSite,privacyIssues} from '../lib/content-schema.js';import {paginateReading} from '../lib/reading-api.js';
const currentContent=()=>JSON.parse(readFileSync(new URL('../content/public-site.json',import.meta.url)));
// Synthetic test-only values never enter publication data.
const fixture=()=>({schemaVersion:1,today:{schemaVersion:1,timezone:'Etc/UTC',updatedAt:null,sections:Object.fromEntries(['projects','phone','sleep','exercise','reading','thoughts'].map(key=>[key,{paragraphs:[]}])),days:[{date:'2026-01-01',exerciseMinutes:null},{date:'2026-01-02',exerciseMinutes:null}],archive:[{date:'2026-01-01',title:'Synthetic archive',paragraphs:['Test paragraph.']}]},reading:{schemaVersion:1,updatedAt:null,currentBooks:[],week:null,entries:[{id:'test-entry',bookId:'test-book',bookTitle:'Synthetic book',author:'Test author',chapterTitle:'Test chapter',topics:['Test topic'],quoteText:'',thoughtText:'Synthetic test reflection.',assistantSummary:'',sourceUrl:null,illustration:'/assets/test.webp',illustrationOrigin:'test'}]}});
test('current real public DTO validates and copies without requiring bootstrap entries',()=>{const x=currentContent();assert.deepEqual(validatePublicSite(x),x);assert.notEqual(validatePublicSite(x),x);});
test('synthetic reading entry fixture itself validates',()=>assert.deepEqual(validatePublicSite(fixture()),fixture()));
test('unknown private payload rejected at every layer',()=>{for(const inject of [x=>x.privateNotes='x',x=>x.today.tokens=[],x=>x.today.days[0].heartRate=99,x=>x.today.sections.projects.rawChats=[]]){const x=fixture();inject(x);assert.throws(()=>validatePublicSite(x));}});
test('missing/zero distinction remains',()=>{const x=fixture();x.today.days[0].exerciseMinutes=0;x.today.days[1].exerciseMinutes=null;assert.equal(validatePublicSite(x).today.days[0].exerciseMinutes,0);assert.equal(validatePublicSite(x).today.days[1].exerciseMinutes,null);});
test('sensitive content scanner blocks obvious identifiers',()=>{assert.deepEqual(privacyIssues('contact@example.org'),['email']);const x=fixture();x.today.sections.projects.paragraphs=['phone: 13800138000'];assert.throws(()=>validatePublicSite(x));});
test('bad dates and external illustrations rejected',()=>{const x=fixture();x.today.archive[0].date='2026-02-30';assert.throws(()=>validatePublicSite(x));const y=fixture();y.reading.entries[0].illustration='https://example.org/x.png';assert.throws(()=>validatePublicSite(y));});
test('reading paging binds snapshot and keeps deterministic shuffle',()=>{const lib={version:'a'.repeat(64),snapshotTotal:3,items:[1,2,3].map(i=>({id:String(i),bookId:'pb-'+String(i).repeat(24),topics:['one']})),books:[],topics:[]};assert.throws(()=>paginateReading(lib,new URL('https://site.test/api/reading/cards?offset=1')),/conflict/);const url=new URL('https://site.test/api/reading/cards?limit=1&seed='+'b'.repeat(32));assert.deepEqual(paginateReading(lib,url),paginateReading(lib,url));assert.equal(paginateReading(lib,url).nextOffset,1);assert.throws(()=>paginateReading(lib,new URL('https://site.test/?limit=100')));});

test('every optional reading URL/illustration field rejects nested objects and scalar impostors',()=>{
 for(const bad of [{privateNote:'hidden'},['https://weread.qq.com/'],42,false,'','http://weread.qq.com/','https://evil.example/','https://user:password@weread.qq.com/','https://weread.qq.com:8443/']){
  const x=fixture();x.reading.currentBooks=[{id:'book',title:'title',sourceUrl:bad}];assert.throws(()=>validatePublicSite(x),/invalid_content/);
  const y=fixture();y.reading.entries[0].sourceUrl=bad;assert.throws(()=>validatePublicSite(y),/invalid_content/);
 }
 for(const bad of [{private:'hidden'},[],0,false,null,'']){const x=fixture();x.reading.entries[0].illustration=bad;assert.throws(()=>validatePublicSite(x));}
 for(const good of [null,'https://weread.qq.com/web/reader/example']){const x=fixture();x.reading.currentBooks=[{id:'book',title:'title',sourceUrl:good}];assert.equal(validatePublicSite(x).reading.currentBooks[0].sourceUrl,good);}
});
test('nested scalar and timestamp fields cannot carry extra data',()=>{
 const cases=[x=>x.reading.updatedAt=2026,x=>x.reading.updatedAt={},x=>x.reading.currentBooks=[{id:{private:'x'},title:'book'}],x=>x.reading.currentBooks=[{id:'id',title:{raw:'x'}}],x=>x.reading.currentBooks=[{id:'id',title:'book',author:{secret:'x'}}],x=>x.reading.entries[0].illustrationOrigin={secret:'x'},x=>x.reading.entries[0].chapterTitle=[],x=>x.reading.entries[0].author=[],x=>x.reading.week={label:'week',totalSeconds:0,readingSeconds:0,listeningSeconds:0,raw:{secret:'x'}}];
 for(const inject of cases){const x=fixture();inject(x);assert.throws(()=>validatePublicSite(x),/invalid_content/);}
});
