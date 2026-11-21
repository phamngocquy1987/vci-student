import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,process.env.VCI_BUILD_TEST==='1'?'dist-test':'dist');
// This file holds only the public project URL and publishable/anon key.
// Repository variables remain available to override it for another project.
let publicConfig={};
try{publicConfig=JSON.parse(await readFile(path.join(root,'deployment/public-config.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const url=process.env.SUPABASE_URL||publicConfig.supabaseUrl||'',key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||publicConfig.supabaseKey||'';
const adminEmail=String(process.env.SUPABASE_ADMIN_EMAIL||publicConfig.adminEmail||'').trim().toLowerCase();
if(adminEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))throw new Error('Invalid administrator email in public configuration.');
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error('Set SUPABASE_URL to the project URL.');
let validKey=key.startsWith('sb_publishable_');
try{validKey ||= JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{}
if(!validKey)throw new Error('Use ONLY a Supabase publishable/anon key. Secret and service_role keys must never enter the web build.');
await mkdir(output,{recursive:true});
// This exact build directory is always inside this checkout; do not clean any
// parent or user-specified path. The workflow uploads only this directory.
if(path.dirname(output)!==root||!['dist','dist-test'].includes(path.basename(output)))throw new Error('Invalid output directory');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
await cp(path.join(root,'admin'),path.join(output,'assets'),{recursive:true});
let html=await readFile(path.join(root,'admin/index.html'),'utf8');
html=html.replace('<title>','<link rel="manifest" href="manifest.webmanifest"><title>');
html=html.replace('<title>',`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ${url} ${url.replace('https:','wss:')}; object-src 'none'; base-uri 'self'; form-action 'self'"><title>`);
// Public frontend key is intended to be visible. Database RLS provides access control.
await writeFile(path.join(output,'assets/config.js'),`window.VCI_CONFIG = ${JSON.stringify({mode:'supabase',supabaseUrl:url,supabaseKey:key,adminEmail})};\n`);
await writeFile(path.join(output,'index.html'),html);
await rm(path.join(output,'assets/index.html'));
await build({entryPoints:{cloud:path.join(root,'web/cloud.js'),excel:path.join(root,'web/excel.js')},outdir:path.join(output,'assets/cloud'),bundle:true,splitting:true,format:'esm',platform:'browser',target:['safari16','chrome110'],minify:true,legalComments:'linked',chunkNames:'chunks/[name]-[hash]'});
for(const size of [192,512])await sharp(path.join(root,'admin/brand/app-icon.png')).resize(size,size).flatten({background:'#ffffff'}).png().toFile(path.join(output,`assets/brand/icon-${size}.png`));
await writeFile(path.join(output,'manifest.webmanifest'),JSON.stringify({id:'./',name:'VCI Student · Cổng đào tạo',short_name:'VCI Student',lang:'vi',start_url:'./',scope:'./',display:'standalone',background_color:'#ffffff',theme_color:'#086344',icons:[192,512].map(s=>({src:`assets/brand/icon-${s}.png`,sizes:`${s}x${s}`,type:'image/png',purpose:'any'}))},null,2));
await cp(path.join(root,'web/offline.html'),path.join(output,'offline.html'));
await writeFile(path.join(output,'.nojekyll'),'');
const domain=process.env.VCI_CUSTOM_DOMAIN?.trim();
if(domain){if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))throw new Error('Invalid custom domain');await writeFile(path.join(output,'CNAME'),domain+'\n');}
async function files(dir){const list=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())list.push(...await files(p));else list.push(p);}return list;}
const staticFiles=await files(output),hash=createHash('sha256');for(const file of staticFiles)hash.update(await readFile(file));
const cacheName=`vci-static-${hash.digest('hex').slice(0,12)}`;
const precache=staticFiles.map(p=>'./'+path.relative(output,p).split(path.sep).join('/')).filter(p=>!['./CNAME','./.nojekyll','./assets/cloud/excel.js'].includes(p)&&!p.endsWith('.LEGAL.txt'));
await writeFile(path.join(output,'sw.js'),`const CACHE=${JSON.stringify(cacheName)},FILES=${JSON.stringify(precache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('vci-static-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(new URL('./offline.html',self.registration.scope))));return;}
 if(FILES.some(p=>new URL(p,self.registration.scope).href===u.origin+u.pathname))e.respondWith(caches.match(u.origin+u.pathname).then(r=>r||fetch(e.request)));
});\n`);
console.log(`Built GitHub Pages app in ${path.basename(output)}/. No student records or server secrets are included.`);
