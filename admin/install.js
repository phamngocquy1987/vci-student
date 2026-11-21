if(window.VCI_CONFIG?.mode==='supabase'){
 const open=()=>{
  const dialog=document.querySelector('#modal');
  document.querySelector('#modal-body').innerHTML=`<div class="modal-head"><h2 id="modal-title">Cài ứng dụng VCI</h2><button class="ghost" data-action="modal-close" aria-label="Đóng">✕</button></div><p><strong>Trên iPhone</strong>: mở trang này bằng Safari → Chia sẻ → Thêm vào Màn hình chính → bật Mở dưới dạng ứng dụng nếu có → Thêm.</p><p><strong>Trên máy tính Windows</strong>: mở bằng Edge hoặc Chrome, chọn biểu tượng cài ứng dụng ở thanh địa chỉ hoặc mục Cài đặt ứng dụng trong menu trình duyệt. Đăng nhập tài khoản quản trị để quản lý.</p><p class="muted">Cần Internet để đăng nhập và xem dữ liệu mới. Biểu tượng VCI sẽ xuất hiện trên thiết bị sau khi cài.</p><div class="form-footer"><button data-action="modal-close">Đã hiểu</button></div>`;
  if(!dialog.open)dialog.showModal();
 };
 document.addEventListener('click',event=>{if(event.target.closest('[data-action="install-help"]'))open();});
 const observer=new MutationObserver(()=>{
  const host=document.querySelector('.login-form')||document.querySelector('.sidebar-bottom');
  if(host&&!host.querySelector('[data-action="install-help"]')){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.action='install-help';button.textContent='Cài ứng dụng VCI';host.append(button);
  }
 });
 observer.observe(document.querySelector('#app'),{childList:true,subtree:true});
 if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname}).catch(()=>{});
}
