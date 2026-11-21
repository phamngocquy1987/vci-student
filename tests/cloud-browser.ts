// Browser + real PostgreSQL/RLS + real Supabase client + real Edge handler.
// Auth/HTTP gateway is an isolated local test double; no hosted project is used.
import {PGlite} from '@electric-sql/pglite';
import {createClient} from '@supabase/supabase-js';
import {createHandler} from '../supabase/functions/vci-api/handler.ts';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ExcelJS from 'exceljs';
import {studentHeaders} from '../web/excel.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.execPath,['tools/build_cloud.mjs'],{cwd:root,env:{...process.env,VCI_BUILD_TEST:'1',SUPABASE_URL:'https://vci-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_VCI_TEST_ONLY'},stdio:'inherit',windowsHide:true});
const db=new PGlite(),tokens=new Map<string,any>(),refreshTokens=new Map<string,any>();
let queue=Promise.resolve();
function locked<T>(fn:()=>Promise<T>):Promise<T>{const p=queue.then(fn);queue=p.then(()=>{},()=>{});return p;}
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text unique,encrypted_password text,raw_app_meta_data jsonb,raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
await db.exec(await readFile(path.join(root,'supabase/migrations/202611210001_vci.sql'),'utf8'));
async function seed(username:string,role:string,classId?:number,name?:string){const id=crypto.randomUUID();await db.query('insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values($1,$2,$3,$4)',[id,`${username.toLowerCase()}@login.vci.edu.vn`,'CloudTest@2026',{vci:{username,full_name:name||username,role,class_id:classId,national_id:role==='student'&&/^\d{12}$/.test(username)?username:''}}]);return id;}
await db.exec(`insert into public.vci_classes(code,campus,year) values('CCN03.11A','Đắk Lắk',2026),('K11B','Hà Nội',2025);`);
const adminId=await seed('admin','admin'),studentId=await seed('000000000001','student',1,'Sinh viên lớp một');
await seed('000000000002','student',2,'Đặng Thị Ánh');
for(let i=0;i<101;i++)await seed(`TEST${String(i).padStart(3,'0')}`,'student',2,`Sinh viên thử ${i}`);
await db.exec(`insert into public.vci_timetable_links(class_id,academic_year,semester,kind,title,url) values(2,'2026-2027','1','hoc','Lịch riêng lớp hai','https://drive.google.com/file/d/PRIVATE_CLASS_2/view');`);
const userJSON=(u:any)=>({id:u.id,email:u.email,aud:'authenticated',role:'authenticated',app_metadata:u.raw_app_meta_data,user_metadata:{},identities:[],created_at:new Date().toISOString()});
async function sessionFor(u:any){const sid=crypto.randomUUID();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,u.id]);const claims={sub:u.id,session_id:sid,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'};const encode=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode(claims)}.test-signature`,refresh=crypto.randomUUID();tokens.set(token,{u,claims});refreshTokens.set(refresh,{u,claims});return {access_token:token,refresh_token:refresh,token_type:'bearer',expires_in:3600,expires_at:claims.exp,user:userJSON(u)};}
let base='';
const factory=(url:string,key:string,options:any={})=>createClient(url,key,{...options,global:{...options.global,fetch:(url:any,options:any)=>fetch(String(url).replace('https://vci-test.supabase.co',`${base}/sb`),options)}});
const edge=createHandler(factory as any,key=>({SUPABASE_URL:'https://vci-test.supabase.co',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',ALLOWED_ORIGINS:base}[key]));
async function dispatch(p:string,req:any,body:string){
 const url=new URL(p,'http://local'),route=url.pathname;
 const token=req.headers.authorization?.replace(/^Bearer /,''),session=tokens.get(token),service=token==='service-test';
 const json=body?JSON.parse(body):{};
 if(route==='/functions/v1/vci-api'){
  const res=await edge(new Request('https://vci-test.supabase.co/functions/v1/vci-api',{method:req.method,headers:req.headers,body:req.method==='OPTIONS'?undefined:body}));return {status:res.status,data:await res.text(),headers:Object.fromEntries(res.headers)};
 }
 return locked(async()=>{
  if(route==='/auth/v1/token'){
   const u=(await db.query('select * from auth.users where email=$1',[json.email])).rows[0];
   if(!u||u.encrypted_password!==json.password)return {status:400,data:{error:'invalid_grant',error_description:'Invalid login credentials',msg:'Invalid login credentials'}};
   return {data:await sessionFor(u)};
  }
  if(route==='/auth/v1/user'&&session){
   if(req.method==='PUT'){await db.query('update auth.users set encrypted_password=$1 where id=$2',[json.password,session.u.id]);}
   const u=(await db.query('select * from auth.users where id=$1',[session.u.id])).rows[0];
   return u?{data:userJSON(u)}:{status:401,data:{message:'No user'}};
  }
  if(route==='/auth/v1/logout'&&session){await db.query('delete from auth.sessions where user_id=$1',[session.u.id]);return {data:{}};}
  if(route==='/auth/v1/admin/users'&&service&&req.method==='POST'){
   const id=crypto.randomUUID();try{await db.query('insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values($1,$2,$3,$4)',[id,json.email,json.password,json.app_metadata]);return {data:userJSON({id,email:json.email,raw_app_meta_data:json.app_metadata})};}catch{return {status:422,data:{message:'Account conflict'}};}
  }
  if(route.startsWith('/auth/v1/admin/users/')&&service&&req.method==='PUT'){const id=route.split('/').at(-1);await db.query('update auth.users set encrypted_password=$1 where id=$2',[json.password,id]);return {data:userJSON((await db.query('select * from auth.users where id=$1',[id])).rows[0])};}
  if(route==='/rest/v1/vci_audit'&&service){await db.query('insert into public.vci_audit(actor,action,detail) values($1,$2,$3)',[json.actor,json.action,json.detail]);return {data:null,status:201};}
  if(route==='/rest/v1/vci_accounts'&&service){const id=url.searchParams.get('id')?.slice(3);const u=(await db.query("select auth_id,username from public.vci_accounts where id=$1 and role='student'",[id])).rows[0];return u?{data:u}:{status:404,data:{message:'Not found'}};}
  if(route.startsWith('/rest/v1/rpc/')&&session){
   await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(session.claims)]);await db.exec('set role authenticated');
   try{
    const fn=route.split('/').at(-1);if(!['vci_read','vci_write'].includes(fn!))throw new Error('Unknown RPC');
    const result=fn==='vci_read'?await db.query('select public.vci_read($1,$2) result',[json.route,json.params]):await db.query('select public.vci_write($1,$2,$3) result',[json.method,json.route,json.body]);
    return {data:result.rows[0].result};
   }catch(e:any){return {status:e.code==='28000'?401:400,data:{code:e.code,message:e.message}};}finally{await db.exec('reset role');}
  }
  return {status:401,data:{message:'Invalid test session'}};
 });
}
const mime:any={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();
  if(req.url?.startsWith('/sb/')){const r=await dispatch(req.url.slice(3),req,body);res.writeHead(r.status||200,{'content-type':'application/json','access-control-allow-origin':base,'access-control-allow-headers':'*',...r.headers});res.end(typeof r.data==='string'?r.data:JSON.stringify(r.data));return;}
  const p=decodeURIComponent(new URL(req.url!,base).pathname);if(!p.startsWith('/vci-test/')){res.writeHead(404).end();return;}
  const local=path.resolve(root,'dist-test',p.slice('/vci-test/'.length)||'index.html');if(!local.startsWith(path.join(root,'dist-test')+path.sep))throw new Error('bad path');
  const buffer=await readFile(local);res.writeHead(200,{'Content-Type':mime[path.extname(local)]||'application/octet-stream'});res.end(buffer);
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({message:String(e)}));}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address()as any).port}`;
 let browser:any,debugPage:any;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1040},locale:'vi-VN'}),errors:string[]=[];
 let dropConfirm=false;
 async function connect(c:any){await c.route('https://vci-test.supabase.co/**',async(route:any)=>{const req=route.request(),url=req.url().replace('https://vci-test.supabase.co',`${base}/sb`),body=req.postData();const response=await fetch(url,{method:req.method(),headers:req.headers(),body:body||undefined});if(dropConfirm&&url.includes('/functions/')&&body?.includes('/confirm')){dropConfirm=false;await route.abort('failed');return;}await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});}
 await connect(context);const page=await context.newPage();debugPage=page;page.on('pageerror',(e:any)=>errors.push(e.message));
 const app=`${base}/vci-test/`;
 async function login(p:any,username:string,password='CloudTest@2026'){await p.getByLabel('Mã sinh viên / Tài khoản').fill(username);await p.getByLabel('Mật khẩu',{exact:true}).fill(password);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();}
 await page.goto(app);await login(page,'admin');await expect(page.getByRole('heading',{name:'Tổng quan đào tạo'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Tổng quan đào tạo'})).toBeVisible();
 await page.getByRole('button',{name:'Thêm link lịch học',exact:true}).click();await page.getByLabel('Lớp nhận lịch',{exact:true}).selectOption('1');await page.getByLabel('Năm học',{exact:true}).selectOption('2026-2027');await page.getByLabel('Học kỳ',{exact:true}).selectOption('1');await page.getByLabel('Tên tài liệu lịch',{exact:true}).fill('Lịch học lớp CCN03.11A');await page.getByLabel('Link Google Drive / Google Sheets',{exact:true}).fill('https://drive.google.com/file/d/CLASS_1/view');await page.getByRole('button',{name:'Lưu link lịch',exact:true}).click();await expect(page.getByRole('heading',{name:'Lịch học lớp CCN03.11A',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Lớp & sinh viên',exact:true}).click();await expect(page.getByText('1–100 / 103 sinh viên',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Trang sau',exact:true}).click();await expect(page.getByText('101–103 / 103 sinh viên',{exact:true})).toBeVisible();
 await page.getByLabel('Tìm kiếm sinh viên').fill('dang anh');await expect(page.getByText('Đặng Thị Ánh',{exact:true})).toBeVisible();await expect(page.getByText('1–1 / 1 sinh viên',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Xóa tìm kiếm',exact:true}).click();
 await page.getByRole('button',{name:'CCN03.11A',exact:true}).click();await expect(page.getByRole('heading',{name:'Danh sách sinh viên lớp CCN03.11A',exact:true})).toBeVisible();await expect(page.getByText('1–1 / 1 sinh viên',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Nhập sinh viên Excel',exact:true}).click();await page.getByLabel('Lớp nhận danh sách',{exact:true}).selectOption('1');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Tải mẫu Excel sinh viên',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('VCI-SinhVien-Mau.xlsx');const downloaded=new ExcelJS.Workbook();await downloaded.xlsx.readFile(await download.path());expect(downloaded.worksheets[0].getCell('A4').value).toContain('CCN03.11A');
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Lop');sheet.getRow(1).values=studentHeaders;for(let i=0;i<7;i++)sheet.addRow([i+1,'Sinh viên nhập',`Mẫu ${i}`,'01/01/2008','Đắk Lắk','Nam','Kinh',`0000000001${String(i).padStart(2,'0')}`,'']);
 await page.locator('#student-excel-file').setInputFiles({name:'danh-sach.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});await page.getByRole('button',{name:'Kiểm tra danh sách',exact:true}).click();await expect(page.getByText('7 sinh viên · 0 lỗi',{exact:true})).toBeVisible();dropConfirm=true;await page.getByRole('button',{name:'Tạo 7 tài khoản',exact:true}).click();await expect(page.locator('#form-error')).not.toBeEmpty();
 await page.reload();await expect(page.getByRole('heading',{name:'Tổng quan đào tạo'})).toBeVisible();await page.getByRole('button',{name:'Lớp & sinh viên',exact:true}).click();await page.getByRole('button',{name:'Nhập sinh viên Excel',exact:true}).click();await page.getByRole('button',{name:'Tiếp tục danh sách đang tạo',exact:true}).click();await page.getByRole('button',{name:'Tạo 7 tài khoản',exact:true}).click();await expect(page.getByText('Đã tạo 7 tài khoản sinh viên.',{exact:true})).toBeVisible();
 expect((await locked(()=>db.query('select count(*)::int n from public.vci_accounts where import_id is not null'))).rows[0].n).toBe(7);
 const studentContext=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN'});await connect(studentContext);const student=await studentContext.newPage();student.on('pageerror',(e:any)=>errors.push(e.message));await student.goto(app);await login(student,'000000000100','000000000100');await expect(student.getByRole('heading',{name:/Xin chào/})).toBeVisible();await expect(student.getByRole('heading',{name:'Lịch học lớp CCN03.11A',exact:true})).toBeVisible();await expect(student.getByText('Lịch riêng lớp hai',{exact:true})).toHaveCount(0);await expect(student.getByRole('button',{name:'Lớp & sinh viên',exact:true})).toHaveCount(0);
 await page.getByLabel('Tìm kiếm sinh viên').fill('000000000100');await expect(page.getByText('1–1 / 1 sinh viên',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cấp lại mật khẩu',exact:true}).last().click();await page.getByLabel('Mật khẩu mới (ít nhất 10 ký tự)',{exact:true}).fill('ResetCloud@2026');await page.getByRole('button',{name:'Cấp lại mật khẩu',exact:true}).last().click();await expect(page.locator('#modal')).not.toBeVisible();await student.getByRole('button',{name:'Làm mới',exact:true}).click();await expect(student.getByRole('heading',{name:'Đăng nhập VCI',exact:true})).toBeVisible();await login(student,'000000000100','ResetCloud@2026');await expect(student.getByRole('heading',{name:/Xin chào/})).toBeVisible();
 await student.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();await student.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('ResetCloud@2026');await student.getByLabel('Mật khẩu mới (ít nhất 10 ký tự)',{exact:true}).fill('ChangedCloud@2026');await student.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill('ChangedCloud@2026');await student.getByRole('button',{name:'Đổi mật khẩu',exact:true}).last().click();await expect(student.getByRole('heading',{name:'Đăng nhập VCI',exact:true})).toBeVisible();await login(student,'000000000100','ChangedCloud@2026');await expect(student.getByRole('heading',{name:/Xin chào/})).toBeVisible();
 await page.getByRole('button',{name:'Cài ứng dụng VCI',exact:true}).click();await expect(page.getByRole('heading',{name:'Cài ứng dụng VCI',exact:true})).toBeVisible();await page.getByRole('button',{name:'Đã hiểu',exact:true}).click();
 await mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/supabase-quan-tri.png'),fullPage:true});await student.screenshot({path:path.join(root,'test-results/supabase-iphone.png'),fullPage:true});
 const manifest=await (await page.request.get(`${app}manifest.webmanifest`)).json();expect(manifest.display).toBe('standalone');expect(manifest.start_url).toBe('./');expect(errors).toEqual([]);
 console.log('PASS: cloud browser integration: real SQL/RLS, Supabase client, Edge handler, subpath hosting, session restore, server search/pagination, Excel download/import/resume, student isolation, password reset/change, mobile layout, install help. Hosted Supabase Auth/Edge not exercised.');
 await studentContext.close();await context.close();
}catch(e:any){console.log('Cloud browser failure:',e.message.split('\n').slice(0,5).join(' '));console.log('Dialog:',await debugPage?.locator('#modal-body').innerText());console.log('Import state:',(await locked(()=>db.query('select id,finished,jsonb_array_length(rows) count,(select count(*) from public.vci_accounts a where a.import_id=b.id)::int created from public.vci_student_imports b'))).rows);throw new Error('Cloud browser check failed; see diagnostics above.');}finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();}
