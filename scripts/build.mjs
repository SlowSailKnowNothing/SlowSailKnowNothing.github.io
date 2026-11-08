import {readFile,writeFile,cp,mkdir,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validatePublicSite,validatePublicReadingLibrary} from '../lib/content-schema.js';
import {validatePublicFiles,verifyOutputFiles} from '../lib/build-boundary.js';
const migration=JSON.parse(await readFile('docs/migration-status.json','utf8'));
if(process.env.VERCEL&&(!migration.complete||!migration.firstBatchApproved))throw new Error('Migration and publication approval incomplete. Production build is blocked.');
for(const dir of ['content','config']){const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Non-regular input directory');}
if((await lstat('content/reading-library.json')).size>32000000)throw new Error('Oversized reading corpus');
for(const input of ['content/public-site.json','content/reading-library.json','config/public-files.json'])if(!(await lstat(input)).isFile()||(await lstat(input)).isSymbolicLink())throw new Error('Non-regular build input');
const manifest=JSON.parse(await readFile('config/public-files.json','utf8'));
const approvedFiles=await validatePublicFiles('public',manifest);
const content=validatePublicSite(JSON.parse(await readFile('content/public-site.json','utf8')));
const library=validatePublicReadingLibrary(JSON.parse(await readFile('content/reading-library.json','utf8')));
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of approvedFiles){await mkdir(path.dirname(path.join('dist',file)),{recursive:true});await cp(path.join('public',file),path.join('dist',file),{dereference:false});}
await mkdir('dist/data',{recursive:true});
await writeFile('dist/data/reading-library.json',JSON.stringify(library));
await writeFile('dist/build-info.json',JSON.stringify({schemaVersion:1,contentHash:createHash('sha256').update(JSON.stringify(content)).digest('hex'),readingVersion:library.version,cardCount:library.snapshotTotal}));
await verifyOutputFiles('dist',manifest);
console.log(`Built and checked local QA site: ${library.snapshotTotal} reading cards; administration HTML remains server gated.`);
