const $ = (q) => document.querySelector(q);
const cloudMode=window.VCI_CONFIG?.mode==='supabase';
let cloud,studentQuerySequence=0,studentSearchTimer;
const studentPage={offset:0,total:0};
async function loadCloudStudents(){
  const sequence=++studentQuerySequence;
  const query=new URLSearchParams({offset:String(studentPage.offset),search:state.studentSearch,field:state.studentSearchField,year:state.yearFilter,class_id:state.rosterClassId});
  const result=await api(`/students?${query}`);
  if(sequence!==studentQuerySequence)return false;
  state.students=result.rows;studentPage.total=result.total;
  return true;
}
async function updateStudentFilters(scroll=false){
  clearTimeout(studentSearchTimer);studentPage.offset=0;
  if(cloudMode)await loadCloudStudents();
  render();
  if(scroll){$('#student-roster').scrollIntoView({behavior:'smooth',block:'start'});$('#student-roster-title').focus({preventScroll:true});}
}
async function download(path){if(cloudMode)return cloud.download(path);window.location.href=`/api${path}`;}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {user:null, csrf:'', page:'overview', classes:[], schedules:[], notices:[], students:[], audit:[], timetableLinks:[], linkClass:'', linkYear:'', linkSemester:'',  legacyOpen:false, week:monday(new Date()), classId:'', rosterClassId:'', yearFilter:'', studentSearch:'', studentSearchField:'all', demo:false, batch:null, studentBatch:null, importClassId:'', lastStudentImportId:''};
const pages = {overview:['▦','Tổng quan'],schedule:['▤','Lịch học'],exams:['▣','Lịch thi'],students:['♙','Lớp & sinh viên'],notices:['♧','Thông báo'],audit:['◷','Lịch sử cập nhật']};
function currentScheduleKind(){return state.page==='exams'?'thi':'hoc';}
function monday(date){const d=new Date(date);d.setHours(12,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d;}
function iso(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function addDays(date,n){const d=new Date(date);d.setDate(d.getDate()+n);return d;}
function displayDate(value,options={day:'2-digit',month:'2-digit',year:'numeric'}){return new Date(value.length===10?`${value}T12:00:00`:value).toLocaleDateString('vi-VN',options);}
function searchText(value){return String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').trim();}
function matchesStudentSearch(student){
  const tokens=searchText(state.studentSearch).split(/\s+/).filter(Boolean);
  const identity=student.national_id||(/^\d{12}$/.test(student.username)?student.username:'');
  const fields={name:[student.full_name],national_id:[identity],class:[student.class_code],all:[student.full_name,identity,student.username,student.class_code,student.campus,student.class_year]};
  const haystack=searchText((fields[state.studentSearchField]||fields.all).join(' '));
  const words=haystack.split(/\s+/);
  return tokens.every(token=>/^[a-z]{1,2}$/.test(token)?words.some(word=>word.startsWith(token)):haystack.includes(token));
}
function classOptions(allLabel='Tất cả lớp'){return `<option value="">${esc(allLabel)}</option>`+state.classes.map(c=>`<option value="${c.id}">${esc(c.code)} · ${esc(c.campus)} · ${c.year||'Chưa phân năm'}</option>`).join('');}
function currentYear(){return Number(new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()));}
function managementYears(){
  return [...new Set([...Array.from({length:currentYear()+11-2000},(_,i)=>2000+i),...state.classes.map(c=>c.year).filter(Boolean)])].sort((a,b)=>b-a);
}
function yearSelect(selected=null){
  return `<label>Năm quản lý<select name="year" aria-label="Năm quản lý"><option value="">Chưa phân năm</option>${managementYears().map(y=>`<option value="${y}" ${Number(selected)===y?'selected':''}>${y}</option>`).join('')}</select></label>`;
}
function campusSelect(selected=''){
  const campuses=['Hà Nội','Hồ Chí Minh','Đắk Lắk','Thái Nguyên','Cần Thơ','Bắc Ninh'];
  return `<label>Cơ sở<select name="campus" aria-label="Cơ sở" required><option value="">Chọn cơ sở</option>${campuses.map(label=>{
    // Keep the stored name for existing Ho Chi Minh classes when only their code is edited.
    const value=label==='Hồ Chí Minh'&&selected==='TP. Hồ Chí Minh'?selected:label;
    return `<option value="${esc(value)}" ${value===selected?'selected':''}>${label}</option>`;
  }).join('')}</select></label>`;
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5000);}
function errorText(detail){if(typeof detail==='string')return detail;if(Array.isArray(detail))return detail.map(d=>d.msg||d.message||'Dữ liệu không hợp lệ').join('\n');return [detail?.message,...(detail?.errors||[]).map(e=>`Dòng ${e.row}: ${e.message}`)].filter(Boolean).join('\n')||'Yêu cầu không thành công';}
async function api(url,options={}){
  if(cloudMode){
    try{return await cloud.request(url,options);}catch(err){
      if(err.status===401&&state.user){await cloud.clearSession();state.user=null;$('#modal').close();renderLogin();}
      throw err;
    }
  }
  const headers={'X-CSRF-Token':state.csrf,...options.headers};
  if(options.body && !(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  const res=await fetch(`/api${url}`,{...options,headers,credentials:'same-origin'});
  const data=await res.json().catch(()=>({detail:'Không đọc được phản hồi từ máy chủ'}));
  if(!res.ok){if(res.status===401&&state.user){state.user=null;$('#modal').close();renderLogin();}throw new Error(errorText(data.detail));}
  return data;
}
function brand(){return `<div class="brand"><img class="brand-logo" src="${new URL('./brand/school-logo.png',import.meta.url).href}" width="72" height="72" alt="Logo Trường Cao đẳng Công Thương Việt Nam"><div class="brand-copy">VCI Student<small>Cổng đào tạo</small></div></div>`;}
function renderLogin(){
  $('#toast').hidden=true;
  $('#app').innerHTML=`<main class="login"><section class="login-story">${brand()}<div><div class="eyebrow">Trường Cao đẳng Công Thương Việt Nam</div><h1>Mỗi ngày học tập.<br>Một bước tiến xa.</h1><p>Lịch học, lịch thi và những thông báo cần thiết — luôn trong tầm tay của bạn.</p><div class="login-tags"><span>Lịch học cá nhân</span><span>Kết nối nhà trường</span></div></div><div class="login-note">Đồng hành cùng sinh viên VCI · Bản phát triển đầu tiên</div></section><section class="login-box"><form id="login-form" class="login-form"><div class="eyebrow muted">Chào mừng trở lại</div><h2>Đăng nhập VCI</h2><p class="muted">Sử dụng tài khoản do nhà trường cung cấp.</p><label>Mã sinh viên / Tài khoản<input name="username" autocomplete="username" required maxlength="100" placeholder="Nhập tài khoản của bạn"></label><label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required maxlength="200" placeholder="Nhập mật khẩu"></label><div id="login-error" class="error" role="alert"></div><button type="submit">Đăng nhập</button>${state.demo?'<div class="demo"><strong>Môi trường dữ liệu minh họa</strong><br>Quản trị: <b>admin</b> · Sinh viên: <b>SV001</b><br>Mật khẩu thử: <b>VciDemo@2026</b><br>Không sử dụng dữ liệu sinh viên thật tại bản thử.</div>':''}<p class="form-hint">Quên mật khẩu? Liên hệ cán bộ phụ trách lớp để được cấp lại.</p><a href="https://vci.edu.vn" target="_blank" rel="noopener">Truy cập website nhà trường</a></form></section></main>`;
  $('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('#login-error').textContent='';try{const data=await api('/login',{method:'POST',body:Object.fromEntries(new FormData(e.target))});$('#toast').hidden=true;state.user=data.user;state.csrf=data.csrf;state.page='overview';await refresh();render();}catch(err){if($('#login-error'))$('#login-error').textContent=err.message;}finally{button.disabled=false;}};
}
async function refresh(){
  const admin=state.user.role==='admin';
  const start=iso(state.week),end=iso(addDays(state.week,6));
  const results=await Promise.all([api('/classes'),api(`/schedules?start=${start}&end=${end}${state.classId?`&class_id=${state.classId}`:''}`),api('/notices'),...(admin?[cloudMode?loadCloudStudents():api('/students'),api('/audit')]:[]),api('/timetable-links')]);
  [state.classes,state.schedules,state.notices]=results;
  if(admin){if(!cloudMode)state.students=results[3];state.audit=results[4];}
  state.timetableLinks=results.at(-1);
}
function statusBadge(row){return `<span class="badge ${esc(row.status)}">${({hoc:'Có lịch',nghi:'Nghỉ học',hoc_bu:'Học bù'})[row.status]||esc(row.status)}</span>${row.kind==='thi'?' <span class="badge thi">Lịch thi</span>':''}`;}
function render(){
  if(!state.user)return renderLogin();
  const admin=state.user.role==='admin';
  const navigation=Object.entries(pages).filter(([key])=>admin||['overview','schedule','exams','notices'].includes(key));
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar">${brand()}<nav aria-label="Điều hướng chính">${navigation.map(([key,[icon,title]])=>`<button data-page="${key}" class="${state.page===key?'active':''}" ${state.page===key?'aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icon}</span>${title}</button>`).join('')}</nav><div class="sidebar-bottom"><strong>Học tập hôm nay.<br>Kiến tạo ngày mai.</strong><p class="small">Trường Cao đẳng<br>Công Thương Việt Nam</p><a href="https://vci.edu.vn" target="_blank" rel="noopener">vci.edu.vn</a></div></aside><main class="main"><header class="topbar"><div><div class="school-name">TRƯỜNG CAO ĐẲNG CÔNG THƯƠNG VIỆT NAM</div><div class="topbar-sub">${admin?'Không gian quản lý đào tạo':'Cổng thông tin sinh viên'}</div></div><div class="user"><div class="avatar">${esc(state.user.full_name.split(' ').at(-1).slice(0,1))}</div><div class="user-info">${esc(state.user.full_name)}<small>${admin?'Quản trị viên':esc(state.user.class_code)}</small></div>${cloudMode?'<button class="ghost" data-action="password-change">Đổi mật khẩu</button>':''}<button class="ghost" data-action="logout">Đăng xuất</button></div></header><div class="content">${state.demo?'<div class="demo"><strong>Bản thử nghiệm</strong> · Dữ liệu minh họa, chưa kết nối hệ thống chính thức của nhà trường.</div>':''}${pageContent(admin)}<div class="footer-note">VCI Student · Bản ${cloudMode?'1.0 Supabase':'0.8'} · Lịch hiển thị theo giờ Việt Nam. Thông báo được tải khi mở hoặc làm mới ứng dụng.</div></div></main></div>`;
  const filter=$('#class-filter');if(filter)filter.value=state.classId;
}
function heading(title,description,actions=''){return `<div class="heading"><div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;}
function pageContent(admin){
  if(state.page==='overview')return overview(admin);
  if(state.page==='schedule'||state.page==='exams'){
    const kind=currentScheduleKind(),title=kind==='thi'?'Lịch thi':'Lịch học';
    return heading(title,`${title} theo lớp, năm học và học kỳ.`,admin?`<button data-action="timetable-new">Thêm link ${kind==='thi'?'lịch thi':'lịch học'}</button>`:'<button class="secondary" data-action="refresh">Làm mới lịch</button>')+timetablePanel(admin,kind)+legacySchedule(admin);
  }
  if(state.page==='students')return studentsPage();
  if(state.page==='notices')return heading('Thông báo','Thông tin từ nhà trường đến đúng người cần nhận.',admin?'<button data-action="notice-new">Soạn thông báo</button>':'<button class="secondary" data-action="refresh">Làm mới</button>')+`<div class="panel">${noticeList(state.notices)}</div>`;
  if(state.page==='audit')return heading('Lịch sử cập nhật','Theo dõi người thực hiện và thời điểm thay đổi.')+`<div class="panel">${state.audit.map(a=>`<article class="timeline"><strong>${esc(a.actor)}</strong> · ${esc(({publish_schedule:'Công bố lịch',timetable_link:'Cập nhật link lịch học kỳ',create_student:'Tạo sinh viên',create_class:'Tạo lớp',update_class:'Sửa lớp',delete_class:'Xóa lớp',import_students:'Nhập sinh viên Excel',notice:'Đăng thông báo',reset_password:'Cấp lại mật khẩu',password:'Đổi mật khẩu'})[a.action]||a.action)}<p>${esc(a.detail)}</p><small class="muted">${esc(new Date(a.created_at).toLocaleString('vi-VN'))}</small></article>`).join('')||'<div class="empty">Chưa có hoạt động.</div>'}</div>`;
  return '';
}
function studentsPage(){
  const visibleClasses=state.classes.filter(c=>!state.yearFilter||(state.yearFilter==='unassigned'?c.year==null:String(c.year)===state.yearFilter));
  const classIds=new Set(visibleClasses.map(c=>c.id));
  const selectedClass=visibleClasses.find(c=>String(c.id)===state.rosterClassId);
  if(!selectedClass)state.rosterClassId='';
  const yearStudents=state.students.filter(s=>classIds.has(s.class_id));
  const scopedStudents=yearStudents.filter(s=>!selectedClass||s.class_id===selectedClass.id);
  const visibleStudents=cloudMode?state.students:scopedStudents.filter(matchesStudentSearch);
  const shownCount=cloudMode?studentPage.total:visibleStudents.length;
  return heading('Lớp & sinh viên','Quản lý lớp và cấp tài khoản cá nhân hoặc hàng loạt.',
    `${state.lastStudentImportId?'<button class="secondary" data-action="student-accounts">Tải mã đăng nhập vừa tạo</button>':''}<button class="secondary" data-action="class-new">Thêm lớp</button><button class="secondary" data-action="student-new">Thêm sinh viên</button><button data-action="student-import">Nhập sinh viên Excel</button>`)+
    `<section class="panel"><div class="toolbar student-search-toolbar"><label class="year-filter-label">Lọc theo năm<select id="year-filter" aria-label="Lọc theo năm"><option value="">Tất cả năm</option><option value="unassigned" ${state.yearFilter==='unassigned'?'selected':''}>Chưa phân năm</option>${managementYears().map(y=>`<option value="${y}" ${String(y)===state.yearFilter?'selected':''}>${y}</option>`).join('')}</select></label><label class="student-search-label">Tìm kiếm sinh viên<input id="student-search" type="search" aria-label="Tìm kiếm sinh viên" placeholder="Nhập tên, CCCD, mã sinh viên hoặc tên lớp…" value="${esc(state.studentSearch)}" autocomplete="off" maxlength="200"></label><label class="student-search-field-label">Tìm theo<select id="student-search-field" aria-label="Tìm theo">${[['all','Tất cả thông tin'],['name','Họ tên sinh viên'],['national_id','Số CCCD'],['class','Tên lớp']].map(([value,label])=>`<option value="${value}" ${state.studentSearchField===value?'selected':''}>${label}</option>`).join('')}</select></label><button class="secondary" data-action="student-search-clear" ${state.studentSearch?'':'disabled'}>Xóa tìm kiếm</button><div class="search-result-hint small muted" role="status" aria-live="polite">${cloudMode?shownCount:visibleStudents.length} / ${cloudMode?state.classes.filter(c=>!state.rosterClassId||String(c.id)===state.rosterClassId).filter(c=>!state.yearFilter||(state.yearFilter==='unassigned'?c.year==null:String(c.year)===state.yearFilter)).reduce((n,c)=>n+(c.student_count||0),0):scopedStudents.length} sinh viên phù hợp${selectedClass?` trong lớp ${esc(selectedClass.code)}`:''}. Có thể nhập tên không dấu.</div></div></section>
    ${searchText(state.studentSearch)?'':`<section class="panel"><div class="panel-header"><h2>Danh sách lớp</h2><span class="muted small">${visibleClasses.length} lớp</span></div>
    <div class="table-wrap"><table><thead><tr><th>Lớp</th><th>Cơ sở</th><th>Năm quản lý</th><th>Số sinh viên</th><th>Thao tác</th></tr></thead><tbody>
    ${visibleClasses.map(c=>`<tr class="${selectedClass?.id===c.id?'selected-class':''}"><td><strong><button class="class-link" data-action="class-roster" data-id="${c.id}" title="Xem danh sách sinh viên lớp ${esc(c.code)}">${esc(c.code)}</button></strong></td><td>${esc(c.campus)}</td><td>${c.year||'<span class="muted">Chưa phân năm</span>'}</td><td>${c.student_count??state.students.filter(s=>s.class_id===c.id).length}</td><td><button class="ghost" data-action="class-edit" data-id="${c.id}">Sửa lớp</button><button class="danger" data-action="class-delete" data-id="${c.id}">Xóa lớp</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Chưa có lớp phù hợp. Chọn năm khác hoặc thêm lớp.</td></tr>'}
    </tbody></table></div></section>`}
    <section class="panel" id="student-roster"><div class="panel-header"><div><h2 id="student-roster-title" tabindex="-1">${selectedClass?`Danh sách sinh viên lớp ${esc(selectedClass.code)}`:searchText(state.studentSearch)?'Kết quả tìm kiếm sinh viên':'Tài khoản sinh viên'}</h2>${selectedClass?`<p class="small muted roster-caption">${esc(selectedClass.campus)} · ${selectedClass.year||'Chưa phân năm'}</p>`:''}</div><div class="actions"><span class="muted small">${shownCount} sinh viên</span>${selectedClass?'<button class="secondary" data-action="roster-all">Xem tất cả lớp</button>':''}</div></div>
    <div class="table-wrap"><table><thead><tr><th>STT</th><th>Mã sinh viên</th><th>Họ tên</th><th>Lớp / Cơ sở</th><th>Năm quản lý</th><th>Thao tác</th></tr></thead><tbody>
    ${visibleStudents.map((s,index)=>`<tr><td>${index+1+(cloudMode?studentPage.offset:0)}</td><td>${esc(s.username)}</td><td><strong>${esc(s.full_name)}</strong></td><td>${esc(s.class_code)}<br><small>${esc(s.campus)}</small></td><td>${s.class_year||'<span class="muted">Chưa phân năm</span>'}</td><td><button class="ghost" data-action="student-profile" data-id="${s.id}">Hồ sơ</button><button class="ghost" data-action="student-reset" data-id="${s.id}">Cấp lại mật khẩu</button></td></tr>`).join('')||`<tr><td colspan="6" class="empty">${searchText(state.studentSearch)?'Không tìm thấy sinh viên phù hợp. Thử từ khóa khác hoặc bỏ bộ lọc lớp/năm.':selectedClass?'Lớp này chưa có sinh viên.':'Chưa có sinh viên phù hợp với năm đang chọn.'}</td></tr>`}
    </tbody></table></div>${cloudMode?`<div class="toolbar"><span class="muted small">${shownCount?studentPage.offset+1:0}–${studentPage.offset+visibleStudents.length} / ${shownCount} sinh viên</span><button class="secondary" data-action="students-prev" ${studentPage.offset===0?'disabled':''}>Trang trước</button><button class="secondary" data-action="students-next" ${studentPage.offset+100>=shownCount?'disabled':''}>Trang sau</button></div>`:''}</section>`;
}
function classEditModal(button){
  const c=state.classes.find(c=>c.id===Number(button.dataset.id));
  if(!c)throw new Error('Lớp không còn tồn tại. Hãy làm mới trang.');
  openModal('Chỉnh sửa lớp',`<p class="form-hint">Sinh viên và lịch học vẫn được giữ trong lớp này. Nếu đổi cơ sở, hệ thống sẽ kiểm tra lại lịch trùng. Các bản Excel đang chờ nhập của lớp cần được tải lại.</p>
    <form id="edit-form">${field('Mã lớp','code','text',c.code,'maxlength="80"')}${campusSelect(c.campus)}${yearSelect(c.year)}${formEnd('Lưu thay đổi')}`);
  bindForm(async values=>{
    const year=values.year?Number(values.year):null;
    await api(`/classes/${c.id}`,{method:'PUT',body:{...values,year}});
    if(state.yearFilter)state.yearFilter=year?String(year):'unassigned';
  },'Đã cập nhật lớp.');
}
async function classDeleteModal(button){
  const impact=await api(`/classes/${Number(button.dataset.id)}/impact`);
  const c=impact.class, n=impact.counts;
  openModal('Xóa lớp và dữ liệu liên quan',`<p>Bạn đang xóa lớp <strong>${esc(c.code)}</strong> tại <strong>${esc(c.campus)}</strong> · ${c.year||'Chưa phân năm'}.</p>
    <div class="error"><strong>Thao tác không thể hoàn tác trong ứng dụng.</strong><br>Sẽ xóa ${n.students} tài khoản sinh viên, ${n.schedules} buổi học/lịch thi, ${n.notices} thông báo riêng và ${n.timetable_links||0} link lịch của lớp. Thông báo toàn trường và các lớp khác được giữ lại.</div>
    <form id="edit-form"><div class="delete-confirmations">
    ${n.students?`<label class="check-row"><input type="checkbox" name="delete_students" required><span>Tôi đồng ý xóa ${n.students} tài khoản sinh viên và các phiên đăng nhập của họ.</span></label>`:''}
    ${n.schedules||n.notices||n.timetable_links?`<label class="check-row"><input type="checkbox" name="delete_related" required><span>Tôi đồng ý xóa ${n.schedules} buổi học/lịch thi, ${n.notices} thông báo riêng và ${n.timetable_links||0} link lịch của lớp.</span></label>`:''}</div>
    ${field(`Nhập lại tên lớp để xác nhận: ${esc(c.code)}`,'confirmation_code','text','','autocomplete="off" maxlength="80"')}
    ${formEnd('Xóa vĩnh viễn',true)}`);
  bindForm(async values=>{
    await api(`/classes/${c.id}`,{method:'DELETE',body:{confirmation_code:values.confirmation_code,revision:impact.revision,delete_students:values.delete_students==='on',delete_related:values.delete_related==='on'}});
    if(state.classId===String(c.id))state.classId='';state.rosterClassId='';studentPage.offset=0;
  },'Đã xóa lớp và dữ liệu đã xác nhận.');
}
function studentImportModal(){
  if(!state.classes.length)throw new Error('Hãy tạo lớp trước khi nhập danh sách sinh viên.');
  state.studentBatch=null;
  openModal('Nhập sinh viên từ Excel',`<p class="muted">Nhập danh sách lớp theo mẫu của trường. Chọn lớp nhận danh sách trước khi tải mẫu hoặc tải file lên.</p>
    ${cloudMode&&cloud.pendingImport()?'<button class="secondary" data-action="student-import-resume">Tiếp tục danh sách đang tạo</button>':''}<label>Lớp nhận danh sách<select id="student-target-class" aria-label="Lớp nhận danh sách" required>${classOptions('Chọn lớp · Cơ sở · Năm quản lý')}</select></label>
    <button class="secondary" data-action="student-template">Tải mẫu Excel sinh viên</button>
    <div class="upload"><strong>Chọn danh sách sinh viên .xlsx</strong><span class="small muted">Tối đa 5 MB · 5.000 sinh viên · Một người mỗi dòng</span><label>File Excel<input id="student-excel-file" type="file" accept=".xlsx"></label></div>
    <p class="form-hint">Các cột: TT, Họ đệm, Tên, Ngày sinh, Nơi sinh, Giới tính, Dân tộc, Số CCCD, Ghi chú. Có thể giữ phần tiêu đề ở trên bảng và dòng tổng ở cuối. Số CCCD bắt buộc đủ 12 chữ số và được dùng làm cả mã đăng nhập lẫn mật khẩu ban đầu. Nhập CCCD dạng văn bản để giữ số 0 đầu.</p>
    <div id="import-error" class="error" role="alert"></div><div class="form-footer"><button class="secondary" data-action="modal-close">Đóng</button><button data-action="student-import-preview">Kiểm tra danh sách</button></div>`);
  $('#student-target-class').value=state.importClassId;
}
function selectedImportClass(){
  const id=$('#student-target-class')?.value;
  if(!id)throw new Error('Hãy chọn lớp nhận danh sách.');
  state.importClassId=id;
  return id;
}
async function previewStudents(button){
  const file=$('#student-excel-file').files[0];
  if(!file)throw new Error('Hãy chọn file danh sách sinh viên.');
  button.disabled=true;
  try{
    const data=new FormData();data.append('file',file);data.append('class_id',selectedImportClass());
    state.studentBatch=await api('/student-imports/preview',{method:'POST',body:data});
    renderStudentPreview();
  }finally{button.disabled=false;}
}
function renderStudentPreview(){
  const b=state.studentBatch;
  const usesCCCD=b.rows.length>0&&b.rows.every(r=>r.source_format==='school');
  openModal('Kiểm tra danh sách sinh viên',`<div class="preview-summary ${b.errors.length?'invalid':''}"><strong>${b.count} sinh viên · ${b.errors.length} lỗi</strong><br>${b.errors.length?'Sửa lỗi trong file và nhập lại. Chưa tạo tài khoản nào.':usesCCCD?'Danh sách hợp lệ. Mã đăng nhập và mật khẩu ban đầu của mỗi sinh viên đều là Số CCCD tương ứng.':'Danh sách hợp lệ. Xem lại thông tin rồi đặt mật khẩu ban đầu.'}</div>
    ${b.errors.length?`<ul class="error-list">${b.errors.map(e=>`<li>${e.row?'Dòng '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}
    <div class="preview-table"><table><thead><tr><th>TT / Dòng</th><th>Họ đệm</th><th>Tên</th><th>Ngày sinh</th><th>Nơi sinh</th><th>Giới tính</th><th>Dân tộc</th><th>Số CCCD</th><th>Ghi chú</th><th>Mã đăng nhập</th></tr></thead><tbody>${b.rows.slice(0,200).map(r=>`<tr><td>${r.source_index||r._row}<br><small>Dòng ${r._row}</small></td><td>${esc(r.surname??r.full_name)}</td><td>${esc(r.given_name||'')}</td><td>${r.birth_date?esc(displayDate(r.birth_date)):'—'}</td><td>${esc(r.birth_place||'')}</td><td>${esc(r.gender||'')}</td><td>${esc(r.ethnicity||'')}</td><td>${esc(r.national_id||'')}</td><td>${esc(r.note||'')}</td><td>${esc(r.username)}</td></tr>`).join('')}</tbody></table></div>
    <p class="form-hint">${b.count>200?'Hiển thị 200 dòng đầu. ':''}Tài khoản đã tồn tại sẽ không bị ghi đè. ${usesCCCD?'Không cần nhập mật khẩu chung: hệ thống lấy mật khẩu ban đầu từ Số CCCD của từng sinh viên.':'Mật khẩu ban đầu áp dụng cho danh sách này;'} Sinh viên có thể đổi mật khẩu trong mục Tài khoản sau khi đăng nhập. Danh sách lớn có thể mất vài phút để tạo tài khoản.${cloudMode?' Hệ thống tạo từng đợt nhỏ. Nếu gián đoạn, bấm tạo lại hoặc chọn Tiếp tục danh sách đang tạo trong phiên trình duyệt này; tài khoản đã tạo không bị ghi đè.':''}</p>
    <form id="edit-form">${!usesCCCD&&!b.errors.length&&b.count?`${field('Mật khẩu ban đầu (ít nhất 10 ký tự)','password','password','','minlength="10" maxlength="200" autocomplete="new-password"')}${field('Nhập lại mật khẩu ban đầu','password_confirm','password','','minlength="10" maxlength="200" autocomplete="new-password"')}`:''}
    <div id="form-error" class="error" role="alert"></div><div class="form-footer"><button class="secondary" type="button" data-action="student-import">Chọn lại file</button><button type="submit" ${b.errors.length||!b.count?'disabled':''}>Tạo ${b.count} tài khoản</button></div></form>`);
  bindForm(async values=>{
    if(!usesCCCD&&values.password!==values.password_confirm)throw new Error('Mật khẩu nhập lại không khớp.');
    await api(`/student-imports/${b.id}/confirm`,{method:'POST',body:usesCCCD?{}:{password:values.password},onProgress:(created,total)=>{const btn=$('#edit-form button[type="submit"]');if(btn)btn.textContent=`Đã tạo ${created}/${total}…`;}});
    state.lastStudentImportId=b.id;
  },`Đã tạo ${b.count} tài khoản sinh viên.`);
}
async function studentProfileModal(button){
  const s=await api(`/students/${Number(button.dataset.id)}`);
  const fields=[['Mã đăng nhập',s.username],['Họ và tên',s.full_name],['Lớp',s.class_code],['Cơ sở',s.campus],['Năm quản lý',s.class_year||'Chưa phân năm'],['Ngày sinh',s.birth_date?displayDate(s.birth_date):''],['Nơi sinh',s.birth_place],['Giới tính',s.gender],['Dân tộc',s.ethnicity],['Số CCCD',s.national_id]];
  openModal('Hồ sơ sinh viên',`<div class="form-grid">${fields.map(([title,value])=>`<div><p class="small muted">${title}</p><p><strong>${esc(value||'Chưa có thông tin')}</strong></p></div>`).join('')}</div><p class="small muted">Ghi chú</p><p class="profile-note">${esc(s.note||'Không có')}</p><div class="form-footer"><button class="secondary" data-action="modal-close">Đóng</button></div>`);
}
function semesterTitle(value){return ({'1':'Học kỳ I','2':'Học kỳ II',summer:'Học kỳ hè'})[value]||value;}
function openSchedulePage(page){state.page=page;state.linkClass='';state.linkYear='';state.linkSemester='';state.legacyOpen=false;render();window.scrollTo({top:0,behavior:'auto'});}
function examOverview(){return `<section class="panel"><div class="panel-header"><div><h2>Lịch thi</h2><p class="small muted roster-caption">${state.timetableLinks.filter(l=>l.kind==='thi'&&l.active).length} tài liệu đã công bố theo học kỳ</p></div><button class="secondary" data-page="exams">Xem lịch thi</button></div></section>`;}
function defaultAcademicYear(){const now=new Date();const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).formatToParts(now);const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);const start=month>=8?year:year-1;return `${start}-${start+1}`;}
function academicYears(){return [...new Set([...Array.from({length:currentYear()+6-2020},(_,i)=>`${2020+i}-${2021+i}`),...state.timetableLinks.map(l=>l.academic_year)])].sort().reverse();}
function timetablePanel(admin,kind='hoc'){
  const rows=state.timetableLinks.filter(l=>l.kind===kind&&(!state.linkClass||String(l.class_id)===state.linkClass)&&(!state.linkYear||l.academic_year===state.linkYear)&&(!state.linkSemester||l.semester===state.linkSemester));
  return `<section class="panel"><div class="panel-header"><h2>${kind==='thi'?'Lịch thi':'Lịch học'} theo học kỳ</h2><span class="small muted">${rows.length} tài liệu</span></div>
    <div class="toolbar timetable-filters">${admin?`<label>Lớp<select data-link-filter="linkClass" aria-label="Lọc link theo lớp"><option value="">Tất cả lớp</option>${state.classes.map(c=>`<option value="${c.id}" ${String(c.id)===state.linkClass?'selected':''}>${esc(c.code)} · ${esc(c.campus)}</option>`).join('')}</select></label>`:''}
    <label>Năm học<select data-link-filter="linkYear" aria-label="Lọc link theo năm học"><option value="">Tất cả năm học</option>${academicYears().map(y=>`<option value="${y}" ${y===state.linkYear?'selected':''}>${y}</option>`).join('')}</select></label>
    <label>Học kỳ<select data-link-filter="linkSemester" aria-label="Lọc link theo học kỳ"><option value="">Tất cả học kỳ</option>${['1','2','summer'].map(s=>`<option value="${s}" ${s===state.linkSemester?'selected':''}>${semesterTitle(s)}</option>`).join('')}</select></label></div>
    <div class="panel-body timetable-cards">${rows.map(l=>`<article class="timetable-card"><div class="notice-top"><span class="badge">${l.academic_year} · ${semesterTitle(l.semester)}</span>${admin?`<span class="badge ${l.active?'':'hoc_bu'}">${l.active?'Đã công bố':'Đang ẩn'}</span>`:''}</div><h3>${esc(l.title)}</h3><p class="small muted">${esc(l.class_code)} · ${esc(l.campus)} · ${l.kind==='thi'?'Lịch thi':'Lịch học'}</p>${l.note?`<p class="timetable-note">${esc(l.note)}</p>`:''}<p class="small muted">Cập nhật: ${esc(new Date(l.updated_at).toLocaleString('vi-VN'))} · Lần ${l.version}</p><div class="actions"><a class="open-timetable" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Mở lịch trên Drive</a>${admin?`<button class="secondary" data-action="timetable-edit" data-id="${l.id}">Sửa link</button><button class="ghost" data-action="timetable-visibility" data-id="${l.id}">${l.active?'Ẩn lịch':'Công bố'}</button>`:''}</div></article>`).join('')||`<div class="empty"><strong>Chưa có link lịch phù hợp</strong>${admin?`Chọn “Thêm link ${kind==='thi'?'lịch thi':'lịch học'}” để gắn tài liệu cho lớp, năm học và học kỳ.`:'Nhà trường chưa công bố link lịch cho lựa chọn này.'}</div>`}</div>
    <div class="panel-body timetable-help small muted">${admin?'Dùng link file hoặc thư mục Drive/Google Sheets. PĐT cần cấp quyền Người xem cho đúng sinh viên. App lưu link; chưa tự kiểm tra quyền truy cập hoặc nội dung file.':'Lịch mở trên Google Drive. Nếu tài liệu yêu cầu quyền truy cập, hãy liên hệ phòng đào tạo.'}</div></section>`;
}
function legacySchedule(admin){return `<details id="legacy-schedule" class="legacy-schedule" ${state.legacyOpen?'open':''}><summary>${currentScheduleKind()==='thi'?'Lịch thi':'Lịch học'} từng buổi (tùy chọn)</summary><p class="form-hint">Dùng khi nhà trường muốn quản lý lịch theo ngày và giờ trong ứng dụng.</p>${admin?`<div class="actions"><button class="secondary" data-action="schedule-new">${currentScheduleKind()==='thi'?'Thêm buổi thi':'Thêm buổi học'}</button><button class="secondary" data-action="import">Nhập lịch từ Excel</button></div>`:''}${schedulePanel(admin)}</details>`;}
function timetableModal(id){
  if(!state.classes.length)throw new Error('Hãy tạo lớp trước khi gắn link lịch.');
  const link=state.timetableLinks.find(l=>l.id===Number(id));
  const kind=link?.kind||currentScheduleKind(),label=kind==='thi'?'lịch thi':'lịch học';
  openModal(link?`Cập nhật link ${label}`:`Thêm link ${label} theo học kỳ`,`<p class="form-hint">Chọn đúng lớp và học kỳ rồi dán link do PĐT cung cấp. Có thể dùng một link thư mục cho các bản lịch cập nhật trong cùng kỳ.</p><form id="edit-form"><div class="form-grid">
    <label class="span-2">Lớp nhận lịch<select name="class_id" aria-label="Lớp nhận lịch" required ${link?'disabled':''}>${classOptions('Chọn lớp')}</select></label>
    <label>Năm học<select name="academic_year" aria-label="Năm học" required>${academicYears().map(y=>`<option value="${y}" ${y===(link?.academic_year||defaultAcademicYear())?'selected':''}>${y}</option>`).join('')}</select></label>
    <label>Học kỳ<select name="semester" aria-label="Học kỳ">${['1','2','summer'].map(s=>`<option value="${s}" ${s===(link?.semester||'1')?'selected':''}>${semesterTitle(s)}</option>`).join('')}</select></label>
    <div class="span-2">${field('Tên tài liệu lịch','title','text',link?.title||(kind==='thi'?'Lịch thi học kỳ':'Thời khóa biểu học kỳ'),'maxlength="200"')}</div>
    <div class="span-2">${field('Link Google Drive / Google Sheets','url','url',link?.url||'','maxlength="3000" placeholder="https://drive.google.com/…"')}</div>
    <label class="span-2">Ghi chú<textarea name="note" maxlength="1500" placeholder="Ví dụ: mở sheet CTY01.11A; lịch áp dụng từ tuần…">${esc(link?.note||'')}</textarea></label>
    <label class="check-row span-2"><input name="active" type="checkbox" ${link?.active===false?'':'checked'}><span>Công bố cho sinh viên của lớp</span></label></div>${formEnd('Lưu link lịch')}`);
  $('#edit-form select[name=class_id]').value=String(link?.class_id||state.linkClass||'');
  bindForm(async values=>{
    const body={...values,kind,class_id:Number(link?.class_id||values.class_id),active:values.active==='on',...(link?{version:link.version}:{})};
    await api(link?`/timetable-links/${link.id}`:'/timetable-links',{method:link?'PUT':'POST',body});
    state.linkClass='';state.linkYear='';state.linkSemester='';
  },'Đã lưu link lịch theo học kỳ.');
}
function timetableVisibility(button){
  const l=state.timetableLinks.find(l=>l.id===Number(button.dataset.id));
  openModal(l.active?'Ẩn lịch với sinh viên':'Công bố lịch cho sinh viên',`<p><strong>${esc(l.title)}</strong><br>${esc(l.class_code)} · ${l.academic_year} · ${semesterTitle(l.semester)}</p><p>${l.active?'Sinh viên sẽ không thấy link này sau khi làm mới ứng dụng.':'Sinh viên của lớp sẽ thấy link này khi mở hoặc làm mới ứng dụng.'}</p><form id="edit-form">${formEnd(l.active?'Xác nhận ẩn':'Xác nhận công bố')}`);
  bindForm(()=>api(`/timetable-links/${l.id}`,{method:'PUT',body:{class_id:l.class_id,academic_year:l.academic_year,semester:l.semester,kind:l.kind,title:l.title,url:l.url,note:l.note,active:!l.active,version:l.version}}),'Đã cập nhật trạng thái link lịch.');
}
function overview(admin){
  const published=state.timetableLinks.filter(l=>l.active);
  return heading(admin?'Tổng quan đào tạo':`Xin chào, ${esc(state.user.full_name.split(' ').at(-1))}!`,admin?'Lịch học của PĐT được gắn đúng lớp và học kỳ.':`${esc(state.user.class_code)} · ${esc(state.user.campus)}`,'<button class="secondary" data-action="refresh">Làm mới</button>')+
  `<section class="hero"><div><div class="eyebrow">Lịch học theo học kỳ</div><h2>${admin?'Đưa lịch của PĐT đến đúng lớp.':'Lịch học của lớp, ngay trong tầm tay.'}</h2><p>${admin?'Dán link Drive, chọn lớp, năm học và học kỳ. Sinh viên mở tài liệu lịch do nhà trường công bố.':'Chọn năm học và học kỳ để mở lịch do phòng đào tạo cung cấp.'}</p></div><button data-action="${admin?'timetable-new':'open-schedule'}">${admin?'Thêm link lịch học':'Xem lịch của tôi'}</button></section>
  <section class="stats"><div class="stat"><div><span class="muted small">Lịch đã công bố</span><strong>${published.length}</strong><span class="muted small">Tài liệu theo học kỳ</span></div><div class="stat-icon">▤</div></div><div class="stat"><div><span class="muted small">${admin?'Sinh viên':'Thông báo'}</span><strong>${admin?(cloudMode?state.classes.reduce((n,c)=>n+(c.student_count||0),0):state.students.length):state.notices.length}</strong><span class="muted small">${admin?'Đã có tài khoản':'Gần đây'}</span></div><div class="stat-icon">♙</div></div><div class="stat"><div><span class="muted small">${admin?'Lớp đào tạo':'Tài liệu lịch học'}</span><strong>${admin?state.classes.length:published.filter(l=>l.kind==='hoc').length}</strong><span class="muted small">${admin?'Trên hệ thống':'Theo lớp của bạn'}</span></div><div class="stat-icon">▦</div></div></section>
  ${timetablePanel(admin)}${examOverview()}<div class="two-cols"><section class="panel"><div class="panel-header"><h2>Thông báo gần đây</h2><button class="ghost" data-page="notices">Xem tất cả</button></div>${noticeList(state.notices.slice(0,3))}</section><section class="panel"><div class="panel-header"><h2>Kết nối VCI</h2></div><div class="panel-body"><h3>Website nhà trường</h3><p class="muted">Tin tức, hoạt động và thông tin tuyển sinh của Trường Cao đẳng Công Thương Việt Nam.</p><a href="https://vci.edu.vn" target="_blank" rel="noopener">Mở vci.edu.vn</a></div></section></div>${legacySchedule(admin)}`;
}
function schedulePanel(admin){
  const kind=currentScheduleKind(),rows=state.schedules.filter(r=>r.kind===kind);
  return `<section class="panel"><div class="panel-header"><h2>${kind==='thi'?'Lịch thi theo tuần':'Thời khóa biểu theo tuần'}</h2><span class="muted small">${rows.length} buổi</span></div><div class="toolbar"><div class="week-control"><button class="secondary" data-action="prev-week" aria-label="Tuần trước">‹</button><span>${displayDate(iso(state.week))} – ${displayDate(iso(addDays(state.week,6)))}</span><button class="secondary" data-action="next-week" aria-label="Tuần sau">›</button><button class="ghost" data-action="this-week">Tuần này</button></div>${admin?`<select id="class-filter" aria-label="Lọc theo lớp">${classOptions()}</select>`:''}</div>${admin?scheduleTable(rows):studentCards(rows)}</section>`;
}
function scheduleTable(rows){return `<div class="table-wrap"><table><thead><tr><th>Ngày / Giờ</th><th>Môn học / Lớp</th><th>Phòng / Cơ sở</th><th>Giảng viên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${displayDate(r.date)}</strong><small>${esc(r.start)} – ${esc(r.end)}</small></td><td><strong>${esc(r.subject)}</strong><small>${esc(r.class_code)}</small></td><td><strong>${esc(r.room)}</strong><small>${esc(r.campus)}</small></td><td>${esc(r.lecturer)}</td><td>${statusBadge(r)}</td><td><button class="ghost" data-action="schedule-edit" data-id="${r.id}">Sửa</button>${r.status!=='nghi'?`<button class="ghost" data-action="schedule-cancel" data-id="${r.id}">Báo nghỉ</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="empty"><strong>Chưa có lịch trong tuần này</strong>Chọn tuần khác hoặc nhập lịch từ Excel để bắt đầu.</td></tr>'}</tbody></table></div>`;}
function studentCards(rows){let last='';return `<div class="panel-body student-cards">${rows.map(r=>{const heading=last!==r.date?`<h3 class="student-day">${esc(displayDate(r.date,{weekday:'long',day:'2-digit',month:'2-digit'}))}</h3>`:'';last=r.date;return `${heading}<article class="lesson-card ${r.status==='nghi'?'cancelled':''}"><div class="lesson-time">${esc(r.start)}<small>${esc(r.end)}</small></div><div class="lesson-info"><h3>${esc(r.subject)}</h3>${statusBadge(r)}<p>Phòng ${esc(r.room)} · ${esc(r.campus)}<br>${esc(r.lecturer)}${r.note?`<br>${esc(r.note)}`:''}</p></div></article>`;}).join('')||'<div class="empty"><strong>Chưa có lịch trong tuần này</strong>Hãy chọn tuần khác hoặc kiểm tra lại sau.</div>'}</div>`;}
function noticeList(rows){return rows.map(n=>`<article class="notice"><div class="notice-top"><span class="badge">${esc(n.class_code)}${n.campus?' · '+esc(n.campus):''}</span><small>${displayDate(n.created_at)}</small></div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('')||'<div class="empty">Chưa có thông báo.</div>';}
function openModal(title,body){$('#modal-body').innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="ghost" data-action="modal-close" aria-label="Đóng">✕</button></div>${body}`;if(!$('#modal').open)$('#modal').showModal();}
function field(label,name,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" required ${extra}></label>`;}
function formEnd(label='Lưu',danger=false){return `<div class="error" id="form-error" role="alert"></div><div class="form-footer"><button class="secondary" type="button" data-action="modal-close">Đóng</button><button type="submit" ${danger?'class="danger"':''}>${label}</button></div></form>`;}
function bindForm(handler,success='Đã lưu thành công.'){$('#edit-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter,label=button.textContent;button.disabled=true;button.textContent='Đang xử lý…';$('#form-error').textContent='';try{await handler(Object.fromEntries(new FormData(e.target)));$('#modal').close();await refresh();render();toast(success);}catch(err){if($('#form-error'))$('#form-error').textContent=err.message;else toast(err.message);}finally{button.disabled=false;button.textContent=label;}};}
function importModal(){state.batch=null;openModal('Nhập lịch từ Excel',`<p class="muted">Kiểm tra trước khi công bố. Sinh viên chỉ thấy lịch sau bước xác nhận.</p><button class="secondary" data-action="template">Tải mẫu Excel</button><div class="upload"><div class="upload-icon" aria-hidden="true">▤</div><strong>Chọn file lịch học .xlsx</strong><span class="muted small">Tối đa 5 MB · 5.000 dòng · Một buổi học mỗi dòng</span><label><span class="sr-only">File Excel</span><input id="excel-file" type="file" accept=".xlsx"></label></div><p class="form-hint">Các cột: Lớp, Cơ sở, Ngày, Bắt đầu, Kết thúc, Môn học, Giảng viên, Phòng, Loại, Trạng thái, Ghi chú. Phải tạo lớp trước khi nhập.</p><div id="import-error" class="error" role="alert"></div><div class="form-footer"><button class="secondary" data-action="modal-close">Đóng</button><button id="preview-button" data-action="import-preview">Kiểm tra & xem trước</button></div>`);}
async function previewImport(button){const file=$('#excel-file').files[0];if(!file)throw new Error('Hãy chọn file Excel trước.');button.disabled=true;try{const form=new FormData();form.append('file',file);state.batch=await api('/imports/preview',{method:'POST',body:form});renderPreview();}finally{button.disabled=false;}}
function renderPreview(){const b=state.batch;openModal('Kiểm tra lịch trước khi công bố',`<div class="preview-summary ${b.errors.length?'invalid':''}"><strong>${b.count} buổi học · ${b.errors.length} lỗi</strong><br>${b.errors.length?'Sửa các lỗi trong file rồi nhập lại. Chưa có lịch nào được công bố.':'Dữ liệu hợp lệ. Kiểm tra nội dung trước khi công bố.'}</div>${b.errors.length?`<ul class="error-list">${b.errors.map(e=>`<li>${e.row?'Dòng '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}<div class="preview-table"><table><thead><tr><th>Dòng</th><th>Lớp / Cơ sở</th><th>Ngày / Giờ</th><th>Môn / Phòng</th></tr></thead><tbody>${b.rows.slice(0,200).map(r=>`<tr><td>${r._row}</td><td>${esc(r.class_code)}<br><small>${esc(r.campus)}</small></td><td>${esc(r.date)}<br><small>${esc(r.start)}–${esc(r.end)}</small></td><td>${esc(r.subject)}<br><small>${esc(r.room)} · ${esc(r.lecturer)}</small></td></tr>`).join('')}</tbody></table></div><p class="form-hint">${b.count>200?'Hiển thị 200 dòng đầu. ':''}Buổi trùng lớp, ngày, giờ bắt đầu và loại sẽ được cập nhật. Những buổi khác được giữ nguyên. Để chuyển giờ học, báo nghỉ buổi cũ rồi tạo buổi mới.</p><div id="import-error" class="error" role="alert"></div><div class="form-footer"><button class="secondary" data-action="import">Chọn lại file</button><button data-action="import-publish" ${b.errors.length||!b.count?'disabled':''}>Công bố ${b.count} buổi</button></div>`);}
function scheduleModal(id){const row=state.schedules.find(r=>r.id===Number(id));const kind=row?.kind||currentScheduleKind();const c=row?state.classes.find(c=>c.id===row.class_id):state.classes[0];if(!c)throw new Error('Hãy thêm lớp trước khi tạo lịch.');openModal(row?`Chỉnh sửa ${kind==='thi'?'buổi thi':'buổi học'}`:`Thêm ${kind==='thi'?'buổi thi':'buổi học'}`,`<p class="form-hint">${row?'Ngày, lớp, giờ bắt đầu và loại xác định một buổi học. Muốn chuyển giờ hoặc lớp, báo nghỉ buổi cũ rồi tạo buổi mới.':'Lịch sẽ được công bố ngay khi lưu thành công.'}</p><form id="edit-form"><div class="form-grid"><label class="span-2">Lớp / Cơ sở<select name="class_id" ${row?'disabled':''}>${state.classes.map(c=>`<option value="${c.id}" ${c.id===(row?.class_id||state.classes[0].id)?'selected':''}>${esc(c.code)} · ${esc(c.campus)}</option>`).join('')}</select></label>${field('Ngày','date','date',row?.date||iso(state.week),row?'disabled':'')}${field('Môn học','subject','text',row?.subject||'','maxlength="200"')}${field('Bắt đầu','start','time',row?.start||'07:30',row?'disabled':'')}${field('Kết thúc','end','time',row?.end||'10:00')}${field('Giảng viên','lecturer','text',row?.lecturer||'','maxlength="150"')}${field('Phòng học','room','text',row?.room||'','maxlength="100"')}<label>Loại<select name="kind" disabled><option value="hoc">Lịch học</option><option value="thi" ${kind==='thi'?'selected':''}>Lịch thi</option></select></label><label>Trạng thái<select name="status"><option value="hoc">Có lịch</option><option value="nghi" ${row?.status==='nghi'?'selected':''}>Nghỉ học</option><option value="hoc_bu" ${row?.status==='hoc_bu'?'selected':''}>Học bù</option></select></label><label class="span-2">Ghi chú<textarea name="note" maxlength="1000">${esc(row?.note||'')}</textarea></label></div>${formEnd('Lưu & công bố')}`);bindForm(async values=>{const cls=state.classes.find(c=>c.id===Number(values.class_id||row?.class_id));await api('/schedules',{method:'POST',body:{...values,kind,class_code:cls.code,campus:cls.campus,...(row?{date:row.date,start:row.start,kind:row.kind}:{})}});});}
const actions={
  'timetable-new':()=>timetableModal(),
  'timetable-edit':button=>timetableModal(button.dataset.id),
  'timetable-visibility':timetableVisibility,
  'student-search-clear':async()=>{state.studentSearch='';await updateStudentFilters();$('#student-search').focus({preventScroll:true});},
  'class-roster':async button=>{state.rosterClassId=button.dataset.id;await updateStudentFilters(true);},
  'roster-all':async()=>{state.rosterClassId='';await updateStudentFilters(true);},
  'students-prev':async()=>{studentPage.offset=Math.max(0,studentPage.offset-100);await loadCloudStudents();render();},
  'students-next':async()=>{studentPage.offset+=100;await loadCloudStudents();render();},
  'refresh':async()=>{await refresh();render();toast('Đã cập nhật dữ liệu.');},
  'logout':async()=>{await api('/logout',{method:'POST'});state.user=null;state.csrf='';state.classId='';state.rosterClassId='';studentPage.offset=0;++studentQuerySequence;clearTimeout(studentSearchTimer);state.studentSearch='';state.studentSearchField='all';state.linkClass='';state.linkYear='';state.linkSemester='';state.legacyOpen=false;state.timetableLinks=[];state.students=[];state.audit=[];state.lastStudentImportId='';renderLogin();},
  'modal-close':()=>$('#modal').close(),
  'open-schedule':()=>openSchedulePage('schedule'),
  'prev-week':async()=>{state.week=addDays(state.week,-7);await refresh();render();},
  'next-week':async()=>{state.week=addDays(state.week,7);await refresh();render();},
  'this-week':async()=>{state.week=monday(new Date());await refresh();render();},
  'template':()=>download('/template.xlsx'),
  'import':importModal,
  'import-preview':previewImport,
  'import-publish':async(button)=>{if(!state.batch||state.batch.errors.length)return;button.disabled=true;try{const result=await api(`/imports/${state.batch.id}/publish`,{method:'POST'});$('#modal').close();await refresh();render();toast(`Đã công bố ${result.count} buổi học.`);}finally{button.disabled=false;}},
  'schedule-new':()=>scheduleModal(),
  'schedule-edit':button=>scheduleModal(button.dataset.id),
  'schedule-cancel':button=>{const row=state.schedules.find(r=>r.id===Number(button.dataset.id));openModal('Xác nhận báo nghỉ',`<p>Buổi <strong>${esc(row.subject)}</strong> của lớp ${esc(row.class_code)} lúc ${esc(row.start)} ngày ${displayDate(row.date)} sẽ được đánh dấu nghỉ. Sinh viên sẽ thấy thay đổi khi tải lại lịch.</p><form id="edit-form">${formEnd('Xác nhận báo nghỉ')}`);bindForm(()=>api(`/schedules/${row.id}/cancel`,{method:'POST'}));},
  'class-new':()=>{openModal('Thêm lớp đào tạo',`<form id="edit-form">${field('Mã lớp','code','text','','maxlength="80"')}${campusSelect()}${yearSelect(Number(state.yearFilter)||currentYear())}${formEnd('Tạo lớp')}`);bindForm(async values=>{const year=values.year?Number(values.year):null;await api('/classes',{method:'POST',body:{...values,year}});if(state.yearFilter)state.yearFilter=year?String(year):'unassigned';});},
  'class-edit':classEditModal,
  'class-delete':classDeleteModal,
  'student-template':()=>download(`/students/template.xlsx?class_id=${selectedImportClass()}`),
  'student-profile':studentProfileModal,
  'student-accounts':()=>{if(state.lastStudentImportId)return download(`/student-imports/${state.lastStudentImportId}/accounts.xlsx`);},
  'student-import':studentImportModal,
  'student-import-resume':async()=>{state.studentBatch=await api(`/student-imports/${cloud.pendingImport()}/resume`);renderStudentPreview();},
  'password-change':()=>{openModal('Đổi mật khẩu',`<form id="edit-form">${field('Mật khẩu hiện tại','old_password','password','','autocomplete="current-password"')}${field('Mật khẩu mới (ít nhất 10 ký tự)','new_password','password','','minlength="10" maxlength="200" autocomplete="new-password"')}${field('Nhập lại mật khẩu mới','confirm','password','','minlength="10" maxlength="200" autocomplete="new-password"')}${formEnd('Đổi mật khẩu')}`);$('#edit-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const values=Object.fromEntries(new FormData(e.target));if(values.new_password!==values.confirm)throw new Error('Mật khẩu nhập lại không khớp.');await api('/password',{method:'POST',body:values});$('#modal').close();state.user=null;renderLogin();toast('Đã đổi mật khẩu. Vui lòng đăng nhập lại.');}catch(err){$('#form-error').textContent=err.message;}finally{button.disabled=false;}};},
  'student-import-preview':previewStudents,
  'student-new':()=>{if(!state.classes.length)throw new Error('Hãy tạo lớp trước.');openModal('Thêm tài khoản sinh viên',`<form id="edit-form">${field('Mã sinh viên','username','text','','autocomplete="off" maxlength="100"')}${field('Họ và tên','full_name','text','','maxlength="150"')}<label>Lớp / Cơ sở<select name="class_id" required>${classOptions('Chọn lớp')}</select></label>${field('Mật khẩu ban đầu (ít nhất 10 ký tự)','password','password','','minlength="10" maxlength="200" autocomplete="new-password"')}${formEnd('Tạo tài khoản')}`);bindForm(values=>api('/students',{method:'POST',body:{...values,class_id:Number(values.class_id)}}));},
  'student-reset':button=>{const student=state.students.find(s=>s.id===Number(button.dataset.id));openModal('Cấp lại mật khẩu',`<p>${esc(student.full_name)} · ${esc(student.username)}</p><p class="form-hint">Các phiên đăng nhập cũ sẽ bị thu hồi.</p><form id="edit-form">${field('Mật khẩu mới (ít nhất 10 ký tự)','password','password','','minlength="10" maxlength="200" autocomplete="new-password"')}${formEnd('Cấp lại mật khẩu')}`);bindForm(body=>api(`/students/${student.id}/password`,{method:'POST',body}));},
  'notice-new':()=>{openModal('Soạn thông báo',`<form id="edit-form">${field('Tiêu đề','title','text','','maxlength="200"')}<label>Người nhận<select name="class_id">${classOptions('Toàn trường')}</select></label><label>Nội dung<textarea name="body" required maxlength="4000" rows="5"></textarea></label>${formEnd('Đăng thông báo')}`);bindForm(values=>api('/notices',{method:'POST',body:{...values,class_id:values.class_id?Number(values.class_id):null}}));}
};
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;try{if(button.dataset.page){if(['schedule','exams'].includes(button.dataset.page))openSchedulePage(button.dataset.page);else{state.page=button.dataset.page;render();}}else if(actions[button.dataset.action])await actions[button.dataset.action](button);}catch(err){const target=$('#import-error')||$('#form-error');if(target)target.textContent=err.message;else toast(err.message);}});
document.addEventListener('change',async e=>{if(e.target.dataset.linkFilter){state[e.target.dataset.linkFilter]=e.target.value;render();}else if(e.target.id==='student-search-field'){state.studentSearchField=e.target.value;await updateStudentFilters();}else if(e.target.id==='year-filter'){state.yearFilter=e.target.value;state.rosterClassId='';await updateStudentFilters();}else if(e.target.id==='class-filter'){state.classId=e.target.value;try{await refresh();render();}catch(err){toast(err.message);}}});
document.addEventListener('toggle',e=>{if(e.target.id==='legacy-schedule')state.legacyOpen=e.target.open;},true);
function applyStudentSearch(input){
  state.studentSearch=input.value;
  if(cloudMode){
    clearTimeout(studentSearchTimer);studentPage.offset=0;++studentQuerySequence;
    const value=state.studentSearch;
    studentSearchTimer=setTimeout(async()=>{try{if(await loadCloudStudents()){const current=$('#student-search'),focused=document.activeElement===current,start=current?.selectionStart,end=current?.selectionEnd;render();const next=$('#student-search');if(focused&&next&&state.studentSearch===value){next.focus({preventScroll:true});if(start!==null&&start!==undefined)next.setSelectionRange(start,end);}}}catch(err){toast(err.message);}},300);
    return;
  }
  const start=input.selectionStart,end=input.selectionEnd;
  render();
  const next=$('#student-search');
  if(next){next.focus({preventScroll:true});if(start!==null&&end!==null)next.setSelectionRange(start,end);}
}
document.addEventListener('input',e=>{if(e.target.id==='student-search'&&!e.isComposing)applyStudentSearch(e.target);});
document.addEventListener('compositionend',e=>{if(e.target.id==='student-search')applyStudentSearch(e.target);});
async function boot(){try{if(cloudMode){const module=await import('./cloud/cloud.js');cloud=module.createCloud(window.VCI_CONFIG);}state.demo=(await api('/meta')).demo;const result=cloudMode?await api('/me'):await fetch('/api/me').then(r=>r.ok?r.json():null);if(result){state.user=result.user;state.csrf=result.csrf;await refresh();}render();}catch(err){state.user=null;renderLogin();$('#login-error').textContent=`Không kết nối được hệ thống. ${err.message}`;}}
boot();
