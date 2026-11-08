import {readdir,lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {privacyIssues,validatePublicReadingLibrary} from './content-schema.js';
function validateGeneratedJson(name,text){
 let value;try{value=JSON.parse(text);}catch{throw new Error('Invalid generated JSON: '+name);}
 // Build writes canonical JSON. Reject hidden duplicate keys or discarded bytes.
 if(JSON.stringify(value)!==text)throw new Error('Non-canonical generated JSON: '+name);
 if(name==='data/reading-library.json'){validatePublicReadingLibrary(value);return;}
 const fields=['schemaVersion','contentHash','readingVersion','cardCount'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k))||value.schemaVersion!==1||typeof value.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(value.contentHash)||typeof value.readingVersion!=='string'||!/^[a-f0-9]{64}$/.test(value.readingVersion)||!Number.isInteger(value.cardCount)||value.cardCount<0||value.cardCount>12000)throw new Error('Invalid generated build metadata');
}
async function validateFiles(root,manifest,generated=false){
 const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Forbidden non-regular publish root');
 const all=[...manifest.public,...manifest.serverOnly];const allowed=new Set(all);
 if(allowed.size!==all.length||all.some(p=>typeof p!=='string'||p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.'))))throw new Error('Invalid public-file allowlist');
 const found=new Set();
 async function walk(dir,relative=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const name=relative?relative+'/'+entry.name:entry.name;const file=path.join(dir,entry.name);const stat=await lstat(file);
   if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new Error('Forbidden non-regular publish input: '+name);
   if(stat.isDirectory()){if(!all.some(x=>x.startsWith(name+'/')))throw new Error('Unknown publish directory: '+name);await walk(file,name);continue;}
   if(!allowed.has(name))throw new Error('Unknown publish file: '+name);found.add(name);
   if(stat.size>40000000)throw new Error('Oversized publish file: '+name);const bytes=await readFile(file);const ext=path.extname(name);
   if(['.html','.js','.css','.svg','.txt','.json'].includes(ext)){
    const text=bytes.toString('utf8');if(text.includes('\ufffd'))throw new Error('Invalid UTF-8 asset: '+name);
    if(generated&&['data/reading-library.json','build-info.json'].includes(name)){validateGeneratedJson(name,text);continue;}
    const issues=privacyIssues(text);if(issues.length)throw new Error('Sensitive publish content: '+name+' ('+issues.join(',')+')');
   }else if(ext==='.woff2'){if(bytes.subarray(0,4).toString()!=='wOF2')throw new Error('Invalid WOFF2 asset');}
   else if(ext==='.webp'){if(bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP')throw new Error('Invalid WebP asset');}
   else throw new Error('Unsupported publish file type: '+name);
  }
 }
 await walk(root);for(const name of all)if(!found.has(name))throw new Error('Missing publish asset: '+name);
 return manifest.public.slice();
}
export async function validatePublicFiles(root,manifest){return validateFiles(root,manifest);}
export async function verifyOutputFiles(root,manifest){
 // Exactly the declared files plus two generated public-only artifacts.
 return validateFiles(root,{public:[...manifest.public,'data/reading-library.json','build-info.json'],serverOnly:[]},true);
}
