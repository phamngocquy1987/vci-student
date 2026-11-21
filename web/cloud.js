import { createClient } from '@supabase/supabase-js';
export function loginAddress(value,adminEmail='') {
  const username=String(value||'').trim().toLowerCase();
  const isEmail=v=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  if(isEmail(username))return username;
  if(!/^[a-z0-9_.-]{1,100}$/.test(username))throw new Error('Mã đăng nhập hoặc email không hợp lệ.');
  if(username==='admin'&&adminEmail){
    const email=String(adminEmail).trim().toLowerCase();
    if(!isEmail(email))throw new Error('Email quản trị trong cấu hình chưa hợp lệ.');
    return email;
  }
  return `${username}@login.vci.edu.vn`;
}
export function createCloud(config) {
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl||'') || !config.supabaseKey) throw new Error('Chưa cấu hình Supabase. Xem hướng dẫn TRIỂN-KHAI-SUPABASE.');
  const client=createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'vci-cloud-session'}});
  const error=(e)=>{let message=e?.message||'Không kết nối được dịch vụ dữ liệu.';if(e?.code==='23505')message='Tài khoản, lớp hoặc link lịch đã tồn tại.';if(e?.code==='23514')message='Dữ liệu không hợp lệ. Kiểm tra lại các ô đã nhập.';const err=new Error(message);err.status=e?.code==='28000'?401:400;return err;};
  const rpc=async(name,args)=>{const r=await client.rpc(name,args);if(r.error)throw error(r.error);return r.data;};
  const invoke=async(route,body)=>{
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session)throw Object.assign(new Error('Vui lòng đăng nhập lại.'),{status:401});
    const response=await fetch(`${config.supabaseUrl}/functions/v1/vci-api`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabaseKey,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({route,body})});
    const data=await response.json().catch(()=>({detail:'Không đọc được phản hồi.'}));
    if(!response.ok)throw Object.assign(new Error(data.detail||'Yêu cầu không thành công.'),{status:response.status});
    return data;
  };
  return {
    pendingImport(){return this.userId?sessionStorage.getItem(`vci-import-${this.userId}`):null;},
    async request(path,options={}) {
      const url=new URL(path,'https://local.invalid'),route=url.pathname,method=options.method||'GET';
      let body=options.body||{};
      if(route==='/meta')return {name:'VCI Student',version:'1.0-supabase',demo:false};
      if(route==='/login'){
        const email=loginAddress(body.username,config.adminEmail);
        const {error:e}=await client.auth.signInWithPassword({email,password:body.password});
        if(e)throw new Error(e.status===429?'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.':'Sai tài khoản hoặc mật khẩu.');
        try{const me=await rpc('vci_read',{route:'/me',params:{}});this.userId=me.user.id;return me;}catch(e){await client.auth.signOut({scope:'local'});throw e;}
      }
      if(route==='/logout'){const {error:e}=await client.auth.signOut();if(e)throw error(e);return {ok:true};}
      if(route==='/me'){
        const {data:{session}}=await client.auth.getSession();
        if(!session)return null;
      }
      if(route==='/password'){
        if(typeof body.new_password!=='string'||body.new_password.length<10||body.new_password.length>200)throw new Error('Mật khẩu mới phải từ 10 đến 200 ký tự.');
        const {data:{user}}=await client.auth.getUser();
        const verifier=createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        const checked=await verifier.auth.signInWithPassword({email:user?.email,password:body.old_password});
        if(checked.error)throw new Error('Mật khẩu hiện tại không đúng.');
        const changed=await client.auth.updateUser({password:body.new_password});
        if(changed.error)throw error(changed.error);
        await verifier.auth.signOut();await client.auth.signOut({scope:'local'});
        return {ok:true};
      }
      const resume=route.match(/^\/student-imports\/([^/]+)\/resume$/);
      if(resume){try{const b=await rpc('vci_write',{method:'GET',route:`/student-imports/${resume[1]}/status`,body:{}});return {...b,id:resume[1]};}catch(e){sessionStorage.removeItem(`vci-import-${this.userId}`);throw e;}}
      if(route==='/student-imports/preview' || route==='/imports/preview'){
        const excel=await import('./excel.js');
        body=await excel.parseUpload(body,route.includes('student-'),this.classes||[]);
      }
      if(route==='/students'&&method==='POST' || /^\/students\/\d+\/password$/.test(route))return invoke(route,body);
      if(/^\/student-imports\/[^/]+\/confirm$/.test(route)){
        let result;
        do{
          result=await invoke(route,body);
          options.onProgress?.(result.created,result.count);
        }while(!result.done);
        sessionStorage.removeItem(`vci-import-${this.userId}`);
        return result;
      }
      if(method==='GET' && !route.endsWith('/impact')){
        const data=await rpc('vci_read',{route,params:Object.fromEntries(url.searchParams)});
        if(route==='/classes')this.classes=data;
        if(route==='/me')this.userId=data.user.id;
        return data;
      }
      const result=await rpc('vci_write',{method,route,body});
      if(route==='/student-imports/preview'&&!result.errors.length)sessionStorage.setItem(`vci-import-${this.userId}`,result.id);
      return result;
    },
    async download(path) {
      const excel=await import('./excel.js');
      const url=new URL(path,'https://local.invalid');
      if(url.pathname==='/students/template.xlsx')return excel.downloadStudentTemplate((this.classes||[]).find(c=>c.id===Number(url.searchParams.get('class_id'))));
      if(url.pathname==='/template.xlsx')return excel.downloadScheduleTemplate(this.classes?.[0]);
      const match=url.pathname.match(/^\/student-imports\/([^/]+)\/accounts.xlsx$/);
      if(match){const rows=await rpc('vci_write',{method:'GET',route:`/student-imports/${match[1]}/accounts`,body:{}});return excel.downloadAccounts(rows);}
      throw new Error('Không tìm thấy tệp tải về.');
    },
    async clearSession(){await client.auth.signOut({scope:'local'});}
  };
}
