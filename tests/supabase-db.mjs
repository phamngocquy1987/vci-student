import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,raw_app_meta_data jsonb,raw_user_meta_data jsonb,encrypted_password text);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'$$;
` .replace("select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'","select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid"));
await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
await db.exec(await readFile(new URL('../supabase/migrations/202611210001_vci.sql',import.meta.url),'utf8'));
const ids={admin:'00000000-0000-4000-8000-000000000001',one:'00000000-0000-4000-8000-000000000002',two:'00000000-0000-4000-8000-000000000003',rogue:'00000000-0000-4000-8000-000000000004'};
const sessions={};
async function seed(id,vci){await db.query('insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3)',[id,{vci},{}]);const session=crypto.randomUUID();sessions[id]=session;await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,id]);}
async function as(id,callback){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:sessions[id],iat:Math.floor(Date.now()/1000)+1})]);await db.exec('set role authenticated');try{return await callback();}finally{await db.exec('reset role');}}
const read=async(route,params={})=>(await db.query('select public.vci_read($1,$2) result',[route,params])).rows[0].result;
const write=async(method,route,body={})=>(await db.query('select public.vci_write($1,$2,$3) result',[method,route,body])).rows[0].result;
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS',name);}
try{
 await seed(ids.admin,{username:'admin',full_name:'Quản trị kiểm thử',role:'admin'});
 await test('admin creates classes and indexed accounts',async()=>{
  await as(ids.admin,async()=>{await write('POST','/classes',{code:'CCN03.11A',campus:'Đắk Lắk',year:2026});await write('POST','/classes',{code:'K11B',campus:'Hà Nội',year:2025});});
  await seed(ids.one,{username:'000000000001',full_name:'Đặng Thị Ánh',national_id:'000000000001',role:'student',class_id:1});
  await seed(ids.two,{username:'000000000002',full_name:'Sinh viên khác',national_id:'000000000002',role:'student',class_id:2});
 });
 const link={class_id:1,academic_year:'2026-2027',semester:'1',kind:'hoc',title:'Lịch lớp một',url:'https://drive.google.com/file/d/test/view',note:'',active:true};
 await test('atomic link versions and notices',async()=>{await as(ids.admin,async()=>{const l=await write('POST','/timetable-links',link);assert.equal(l.version,1);const before=(await read('/notices')).length;await assert.rejects(write('PUT',`/timetable-links/${l.id}`,{...link,version:99}),/thay đổi/);assert.equal((await read('/notices')).length,before);await write('PUT',`/timetable-links/${l.id}`,{...link,version:1,active:false});});});
 await test('student RLS denies other classes, profiles, imports and mutations',async()=>{await as(ids.one,async()=>{assert.equal((await read('/classes')).length,1);assert.deepEqual(await read('/timetable-links'),[]);assert.equal((await db.query('select * from public.vci_accounts')).rows.length,1);assert.equal((await db.query('select * from public.vci_student_details')).rows.length,0);assert.equal((await db.query('select * from public.vci_student_imports')).rows.length,0);await assert.rejects(read('/students'),/quản trị/);await assert.rejects(write('POST','/classes',{code:'bad'}),/quản trị/);await assert.rejects(db.query("update public.vci_accounts set role='admin'"),/permission denied/);});});
 await test('anonymous visitors cannot read or invoke account functions',async()=>{await db.exec('set role anon');try{await assert.rejects(read('/classes'),/permission denied/);await assert.rejects(db.query('select * from public.vci_accounts'),/permission denied/);}finally{await db.exec('reset role');}});
 await test('user metadata cannot create an admin account',async()=>{await db.query('insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3)',[ids.rogue,{}, {vci:{role:'admin'}}]);assert.equal((await db.query('select * from public.vci_accounts where auth_id=$1',[ids.rogue])).rows.length,0);});
 await test('server search is accent insensitive and respects class/year',async()=>{await as(ids.admin,async()=>{assert.equal((await read('/students',{search:'dang anh',field:'name'})).total,1);assert.equal((await read('/students',{search:'000000000001',field:'national_id'})).total,1);assert.equal((await read('/students',{search:'CCN03.11A',field:'class',year:'2026'})).total,1);assert.equal((await read('/students',{search:'anh',class_id:'2'})).total,0);});});
 const school={_row:7,source_format:'school',source_index:1,username:'000000000003',national_id:'000000000003',full_name:'Sinh viên nhập mẫu',class_code:'CCN03.11A',campus:'Đắk Lắk',birth_date:'2008-01-01'};let batch;
 await test('Excel preview validates duplicates without creating accounts',async()=>{await as(ids.admin,async()=>{const b=await write('POST','/student-imports/preview',{rows:[school,school],errors:[]});assert.ok(b.errors.length);batch=await write('POST','/student-imports/preview',{rows:[school],errors:[]});assert.equal(batch.errors.length,0);assert.equal((await read('/students')).total,2);});});
 await test('legacy four-column Excel remains supported',async()=>{await as(ids.admin,async()=>{const b=await write('POST','/student-imports/preview',{rows:[{username:'LEGACY001',full_name:'Sinh viên mẫu cũ',class_code:'K11B',campus:'Hà Nội',_row:2}],errors:[]});assert.deepEqual(b.errors,[]);});});
 await test('Auth trigger provisions imports atomically and retries cannot duplicate',async()=>{
  await seed('00000000-0000-4000-8000-000000000005',{...school,role:'student',class_id:1,import_id:batch.id,import_index:0});
  await assert.rejects(seed(crypto.randomUUID(),{...school,role:'student',class_id:1,import_id:batch.id,import_index:0}),/duplicate/);
  await as(ids.admin,async()=>{assert.equal((await write('POST',`/student-imports/${batch.id}/status`)).done,true);assert.equal((await write('GET',`/student-imports/${batch.id}/accounts`)).length,1);});
 });
 const s={class_code:'CCN03.11A',campus:'Đắk Lắk',date:'2026-12-01',start:'07:30',end:'10:00',subject:'Môn A',lecturer:'GV A',room:'P1',kind:'hoc',status:'hoc',note:''};
 await test('schedule preview rolls back; publish is atomic and checks conflicts',async()=>{await as(ids.admin,async()=>{const preview=await write('POST','/imports/preview',{rows:[{...s,_row:2}],errors:[]});assert.deepEqual(preview.errors,[]);assert.equal((await db.query('select * from public.vci_schedules')).rows.length,0);await write('POST',`/imports/${preview.id}/publish`);const bad=await write('POST','/imports/preview',{rows:[{...s,start:'08:00',_row:2}],errors:[]});assert.equal(bad.errors.length,1);await assert.rejects(write('POST',`/imports/${bad.id}/publish`));assert.equal((await db.query('select * from public.vci_schedules')).rows.length,1);});});
 await test('invalid Drive domains, school years and campuses are rejected',async()=>{await as(ids.admin,async()=>{for(const url of ['https://drive.google.com.evil.test/x','javascript:alert(1)','https://evil.test/x','https://drive.google.com@evil.test/x'])await assert.rejects(write('POST','/timetable-links',{...link,semester:'2',url}));await assert.rejects(write('POST','/timetable-links',{...link,semester:'2',academic_year:'2026-2028'}));await assert.rejects(write('POST','/classes',{code:'bad',campus:'Tự điền'}));});});
 await test('class deletion requires typed confirmation, flags and current revision',async()=>{await as(ids.admin,async()=>{const impact=await write('GET','/classes/1/impact');await assert.rejects(write('DELETE','/classes/1',{confirmation_code:'CCN03.11A',revision:impact.revision}),/xác nhận/);await write('POST','/notices',{class_id:1,title:'Mới',body:'Nội dung'});await assert.rejects(write('DELETE','/classes/1',{confirmation_code:'CCN03.11A',revision:impact.revision,delete_students:true,delete_related:true}),/thay đổi/);const latest=await write('GET','/classes/1/impact');await write('DELETE','/classes/1',{confirmation_code:'CCN03.11A',revision:latest.revision,delete_students:true,delete_related:true});assert.equal((await read('/students')).total,1);});assert.equal((await db.query('select * from auth.users where id=$1',[ids.one])).rows.length,0);});
 await test('password reset denies old sessions even after JWT refresh',async()=>{await db.query('update auth.users set encrypted_password=$1 where id=$2',['NEW_HASH',ids.two]);await assert.rejects(as(ids.two,()=>read('/classes')),/kết thúc/);sessions[ids.two]=crypto.randomUUID();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[ids.two],ids.two]);await as(ids.two,async()=>assert.equal((await read('/classes')).length,1));});
 await test('expired/revoked sessions cannot read data',async()=>{await db.query('delete from auth.sessions where user_id=$1',[ids.two]);await assert.rejects(as(ids.two,()=>read('/classes')),/kết thúc/);});
 await test('20,000 synthetic records are paginated and searchable without returning all profiles',async()=>{
  const c=await as(ids.admin,()=>write('POST','/classes',{code:'QUYMO-TEST',campus:'Cần Thơ',year:2026}));
  await db.exec(`create temporary table scale_fixture as select gen_random_uuid() id,n from generate_series(1,20000) n;
   insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) select id,'{}','{}' from scale_fixture;`);
  await db.query("insert into public.vci_accounts(auth_id,username,full_name,role,class_id) select id,'LOAD'||lpad(n::text,6,'0'),'Sinh viên quy mô '||n,'student',$1 from scale_fixture",[c.id]);
  await db.query('insert into public.vci_student_details(account_id) select id from public.vci_accounts where class_id=$1',[c.id]);
  await as(ids.admin,async()=>{const p=await read('/students',{class_id:String(c.id)});assert.equal(p.total,20000);assert.equal(p.rows.length,100);const last=await read('/students',{class_id:String(c.id),offset:'19900'});assert.equal(last.rows.length,100);assert.equal(last.rows.at(-1).username,'LOAD020000');assert.equal((await read('/students',{search:'LOAD020000'})).total,1);});
 });
 console.log(`PASS: ${checks} Supabase PostgreSQL/RLS integration checks (local PGlite; hosted Auth/Edge not exercised).`);
}finally{await db.close();}
