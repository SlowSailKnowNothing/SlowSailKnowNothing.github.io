import {readFile} from 'node:fs/promises';
import {validatePublicSite,validatePublicReadingLibrary} from '../lib/content-schema.js';
import {validatePublicFiles,verifyOutputFiles} from '../lib/build-boundary.js';
const manifest=JSON.parse(await readFile('config/public-files.json','utf8'));
await validatePublicFiles('public',manifest);await verifyOutputFiles('dist',manifest);
validatePublicSite(JSON.parse(await readFile('content/public-site.json','utf8')));
validatePublicReadingLibrary(JSON.parse(await readFile('content/reading-library.json','utf8')));
validatePublicReadingLibrary(JSON.parse(await readFile('dist/data/reading-library.json','utf8')));
console.log('Explicit publish allowlist, input/output file types, public DTOs and sensitive-pattern scan passed. Manual semantic privacy and rights review is still required.');
