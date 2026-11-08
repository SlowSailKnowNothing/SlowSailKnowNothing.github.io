import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validatePublicReadingLibrary} from './content-schema.js';
let loading;
export function loadReading(){return loading??=(async()=>{const path=new URL('../content/reading-library.json',import.meta.url);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32000000)throw new Error('reading_input_invalid');return validatePublicReadingLibrary(JSON.parse(await readFile(path,'utf8')));})();}
export function paginateReading(library,url){
 const q=url.searchParams,allowed=['offset','limit','bookId','topic','version','seed'];
 for(const key of q.keys())if(!allowed.includes(key)&&key!=='route'||q.getAll(key).length!==1)throw new Error('invalid_query');
 const integer=(key,fallback)=>{if(!q.has(key))return fallback;const x=q.get(key);if(!/^(0|[1-9][0-9]*)$/.test(x))throw new Error('invalid_query');return Number(x);};
 const offset=integer('offset',0),limit=integer('limit',20),version=q.get('version'),seed=q.get('seed'),bookId=q.get('bookId'),topic=q.get('topic');
 if(offset>12000||limit<1||limit>20||seed&&!/^[a-f0-9]{32}$/.test(seed)||bookId&&!/^pb-[a-f0-9]{24}$/.test(bookId)||topic&&topic.length>80)throw new Error('invalid_query');
 if(offset>0&&!version||version&&version!==library.version)throw new Error('snapshot_conflict');
 let entries=library.items.filter(x=>(!bookId||x.bookId===bookId)&&(!topic||x.topics.includes(topic)));
 if(seed)entries=entries.map(item=>({item,key:createHash('sha256').update(seed+library.version+item.id).digest('hex')})).sort((a,b)=>a.key.localeCompare(b.key)).map(x=>x.item);
 return {version:library.version,snapshotTotal:library.snapshotTotal,total:entries.length,items:entries.slice(offset,offset+limit),nextOffset:offset+limit<entries.length?offset+limit:null,books:library.books,topics:library.topics};
}
export async function readingCards(url){try{return Response.json(paginateReading(await loadReading(),url),{headers:{'cache-control':'public, max-age=60'}});}catch(error){const status=error.message==='invalid_query'?400:error.message==='snapshot_conflict'?409:503;return Response.json({error:status===503?'public_reading_unavailable':error.message},{status});}}
