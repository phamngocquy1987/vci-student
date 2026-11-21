-- Run in Supabase SQL Editor AFTER creating admin@vci.edu.vn in
-- Authentication > Users. Choose the password privately in that dashboard.
-- This script contains no password or API key and does not promote students.
begin;
do $$
declare
  target_user uuid;
  existing_role text;
begin
  select id into strict target_user from auth.users
  where lower(email) = 'admin@vci.edu.vn';

  select role into existing_role from public.vci_accounts
  where auth_id = target_user;

  if existing_role is not null and existing_role <> 'admin' then
    raise exception 'Tài khoản này đã là sinh viên. Không tự đổi quyền; hãy dùng tài khoản quản trị riêng.';
  end if;

  if existing_role is null then
    insert into public.vci_accounts(auth_id, username, full_name, role, class_id)
    values(target_user, 'admin', 'Quản trị VCI', 'admin', null);
    insert into public.vci_audit(actor, action, detail)
    values('Thiết lập hệ thống', 'create_admin', 'Tạo quản trị đầu tiên bằng Supabase Dashboard');
  end if;
exception
  when no_data_found then
    raise exception 'Chưa có admin@vci.edu.vn. Hãy tạo và xác nhận tài khoản trong Authentication > Users trước.';
end $$;
commit;

select username, full_name, role from public.vci_accounts
where auth_id in (select id from auth.users where lower(email) = 'admin@vci.edu.vn');
