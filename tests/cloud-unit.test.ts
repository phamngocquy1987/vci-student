import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {spawnSync} from 'node:child_process';
import {createHandler,loginEmail} from '../supabase/functions/vci-api/handler.ts';
import {parseUpload,studentHeaders,scheduleHeaders} from '../web/excel.js';
import {loginAddress} from '../web/cloud.js';
test('admin accepts the configured school email while CCCD login retains its existing mapping',()=>{
 assert.equal(loginAddress('admin','admin@vci.edu.vn'),'admin@vci.edu.vn');
 assert.equal(loginAddress(' ADMIN@VCI.EDU.VN ','admin@vci.edu.vn'),'admin@vci.edu.vn');
 assert.equal(loginAddress('000000000001','admin@vci.edu.vn'),'000000000001@login.vci.edu.vn');
 assert.equal(loginAddress('admin'),'admin@login.vci.edu.vn');
 assert.throws(()=>loginAddress('a@@vci.edu.vn'));
});
const env=(key:string)=>({SUPABASE_URL:'https://vci-test.supabase.co',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',ALLOWED_ORIGINS:'https://school.example'}[key]);
function request(body:any,token='valid',origin='https://school.example'){return new Request('https://edge.example/vci-api',{method:'POST',headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});}
function fixture(role='admin'){
 const created:any[]=[],rows=Array.from({length:7},(_,index)=>({username:`0000000000${index+10}`,national_id:`0000000000${index+10}`,full_name:`Sinh viên ${index}`,class_id:1,source_format:'school'}));
 const indices:number[]=[];
 const factory=(_url:string,key:string)=>key==='service-test'?{auth:{admin:{createUser:async(input:any)=>{created.push(input);indices.push(input.app_metadata.vci.import_index);return {data:{user:{id:crypto.randomUUID()}},error:null};}}},from:()=>({insert:async()=>({error:null})})}:{auth:{getUser:async(token:string)=>token==='valid'?{data:{user:{id:'user'}},error:null}:{data:null,error:{message:'bad'}}},rpc:async(name:string,args:any)=>({data:args.route==='/me'?{user:{role,username:'admin'}}:{rows,count:rows.length,errors:[],created_indices:indices,created:indices.length,done:indices.length===rows.length},error:null})};
 return {handler:createHandler(factory,env),created};
}
test('edge denies untrusted origins, missing tokens, invalid tokens and student privilege escalation',async()=>{
 const {handler,created}=fixture('student');
 assert.equal((await handler(request({},'valid','https://evil.example'))).status,403);
 assert.equal((await handler(request({},''))).status,401);
 assert.equal((await handler(request({},'invalid'))).status,401);
 assert.equal((await handler(request({route:'/students',body:{role:'admin'}}))).status,403);
 assert.equal(created.length,0);
});
test('edge handles CORS preflight only for configured origins',async()=>{
 const {handler}=fixture();const response=await handler(new Request('https://edge.example',{method:'OPTIONS',headers:{Origin:'https://school.example'}}));
 assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://school.example');
});
test('edge provisions only students and never copies passwords or arbitrary metadata',async()=>{
 const {handler,created}=fixture();const response=await handler(request({route:'/students',body:{username:'012345678901',full_name:'Sinh viên mẫu',class_id:1,password:'012345678901',role:'admin',evil:'secret'}}));
 assert.equal(response.status,200);assert.equal(created[0].app_metadata.vci.role,'student');assert.equal(created[0].app_metadata.vci.password,undefined);assert.equal(created[0].app_metadata.vci.evil,undefined);assert.equal(created[0].email,'012345678901@login.vci.edu.vn');
});
test('bulk provisioning is bounded and resumes without overwriting completed accounts',async()=>{
 const {handler,created}=fixture(),route='/student-imports/00000000-0000-4000-8000-000000000001/confirm';
 const first=await (await handler(request({route}))).json();assert.equal(first.created,5);assert.equal(first.done,false);
 const second=await (await handler(request({route}))).json();assert.equal(second.created,7);assert.equal(second.done,true);
 const third=await (await handler(request({route}))).json();assert.equal(third.created,7);assert.equal(created.length,7);
 assert.ok(created.every(x=>x.password===x.app_metadata.vci.national_id));
});
test('invalid account identifiers and passwords are rejected before provisioning',async()=>{
 assert.throws(()=>loginEmail('a@evil.example'));
 const {handler,created}=fixture();assert.equal((await handler(request({route:'/students',body:{username:'student',full_name:'Mẫu',class_id:1,password:'short'}}))).status,400);assert.equal(created.length,0);
});
test('the static build rejects server secrets and legacy service_role JWTs',()=>{
 for(const key of ['sb_secret_DO_NOT_PUBLISH',`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.x`]){
  const result=spawnSync(process.execPath,['tools/build_cloud.mjs'],{env:{...process.env,SUPABASE_URL:'https://vci-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:key},encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/must never enter the web build/);assert.ok(!result.stderr.includes(key));
 }
});
async function upload(w:ExcelJS.Workbook,classId='1'){const b=await w.xlsx.writeBuffer();const f=new FormData();f.append('file',new Blob([b]),'roster.xlsx');f.append('class_id',classId);return f;}
const classes=[{id:1,code:'CCN03.11A',campus:'Đắk Lắk'}];
test('school Excel handles heading, split names, dates, CCCD leading zeros and summary',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('DanhSach');s.mergeCells('A4:I4');s.getCell('A4').value='DANH SÁCH LỚP CCN03.11A - NGÀNH CNTT';s.getRow(6).values=studentHeaders;s.getRow(7).values=[1,'Đặng Thị','Ánh',new Date('2008-01-01T00:00:00Z'),'Đắk Lắk','Nữ','Kinh','000000000001',''];s.getCell('H7').numFmt='@';s.getRow(8).values=['','Tổng danh sách có 1 sinh viên'];
 const parsed=await parseUpload(await upload(w),true,classes);assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].username,'000000000001');assert.equal(parsed.rows[0].full_name,'Đặng Thị Ánh');assert.equal(parsed.rows[0].birth_date,'2008-01-01');
});
test('school Excel rejects formulas, missing leading zero and wrong class title',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('DanhSach');s.getRow(1).values=studentHeaders;s.getRow(2).values=[1,'Mẫu','A','','','','',12345678901,''];s.getRow(3).values=[2,'Mẫu','B','','','','',{formula:'1+1'},''];
 const parsed=await parseUpload(await upload(w),true,classes);assert.equal(parsed.rows.length,0);assert.equal(parsed.errors.length,2);
 s.insertRow(1,[]);s.getCell('A1').value='DANH SÁCH LỚP KHAC - NGÀNH CNTT';await assert.rejects(parseUpload(await upload(w),true,classes),/khác lớp/);
});
test('schedule Excel preserves HH:MM and rejects invalid dates',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Lich');s.addRow(scheduleHeaders);s.addRow(['CCN03.11A','Đắk Lắk','01/12/2026','07:30','10:00','Môn A','GV A','P1','hoc','hoc','']);s.addRow(['CCN03.11A','Đắk Lắk','31/02/2026','07:30','10:00','Môn B','GV A','P1','hoc','hoc','']);
 const parsed=await parseUpload(await upload(w),false,classes);assert.equal(parsed.rows[0].date,'2026-12-01');assert.equal(parsed.rows[0].start,'07:30');assert.equal(parsed.errors.length,1);
});
