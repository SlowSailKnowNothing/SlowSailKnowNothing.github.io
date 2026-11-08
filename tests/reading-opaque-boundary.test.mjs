import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyIssues,validatePublicReadingLibrary} from '../lib/content-schema.js';
const fixture=()=>({version:'a'.repeat(64),snapshotTotal:1,items:[{id:'pc-'+'b'.repeat(24),bookId:'pb-'+'c'.repeat(24),bookTitle:'Book',author:'Author',chapterTitle:'Chapter',topics:['Topic'],quoteText:'An approved passage.',thoughtText:'A reflection.',sourceUrl:null,quoteAvailability:'present'}],books:[{bookId:'pb-'+'c'.repeat(24),bookTitle:'Book',author:'Author',count:1}],topics:[{topic:'Topic',count:1}]});
test('strictly valid opaque IDs and version hashes may contain phone-like digit runs',()=>{
 const x=fixture(),hex='a13800138000'+'a'.repeat(12);assert.equal(hex.length,24);
 x.items[0].id='pc-'+hex;x.items[0].bookId=x.books[0].bookId='pb-'+hex;x.version=hex+'a'.repeat(40);
 assert.ok(privacyIssues(x).includes('phone'),'global scanner must remain strict');
 assert.deepEqual(validatePublicReadingLibrary(x),x);
});
test('all display text retains phone and secret scanning, including titles authors and topics',()=>{
 const injectors=[x=>v=>x.items[0].chapterTitle=v,x=>v=>x.items[0].quoteText=v,x=>v=>x.items[0].thoughtText=v,x=>v=>{x.items[0].bookTitle=x.books[0].bookTitle=v;},x=>v=>{x.items[0].author=x.books[0].author=v;},x=>v=>{x.items[0].topics=[v];x.topics[0].topic=v;}];
 for(const value of ['13800138000','ghp_'+'x'.repeat(36),'contact@example.org','11010519491231002X','-----BEGIN PRIVATE KEY-----'])for(const inject of injectors){const x=fixture();inject(x)(value);assert.throws(()=>validatePublicReadingLibrary(x),/invalid_content/);}
 // URLs are currently null-only, and cannot become an unscanned escape hatch.
 for(const value of ['https://example.org/13800138000','https://example.org/ghp_'+'x'.repeat(36)]){const x=fixture();x.items[0].sourceUrl=value;assert.throws(()=>validatePublicReadingLibrary(x),/invalid_content/);}
});
test('opaque exemptions do not permit invalid IDs hashes types or nested scalar data',()=>{
 const injectors=[x=>x.items[0].id='pc-13800138000',x=>x.items[0].id='pc-'+'z'.repeat(24),x=>x.items[0].id='pc-'+'a'.repeat(24)+'13800138000',x=>x.items[0].id={id:'pc-'+'b'.repeat(24)},x=>{x.items[0].bookId=x.books[0].bookId='pb-'+'z'.repeat(24);},x=>x.version='a'.repeat(64)+'13800138000',x=>x.version={hash:'a'.repeat(64)},x=>{x.items[0].bookTitle=x.books[0].bookTitle={value:'13800138000'};},x=>x.items[0].thoughtText={value:'safe'},x=>x.items[0].topics=[{topic:'Topic'}],x=>x.items[0].sourceUrl={url:null},x=>x.books[0].count={value:1},x=>x.topics[0].count='1',x=>x.items[0].hidden={secret:'ghp_'+'x'.repeat(36)}];
 for(const inject of injectors){const x=fixture();inject(x);assert.throws(()=>validatePublicReadingLibrary(x),/invalid_content/);}
});
