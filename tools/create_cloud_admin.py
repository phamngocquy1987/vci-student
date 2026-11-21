"""Create the first Supabase admin without putting server keys in files/history."""
import getpass
import json
import re
import urllib.error
import urllib.request
from pathlib import Path


def main():
    print('Tạo quản trị VCI trên Supabase. Chạy SQL migration trước khi dùng công cụ này.')
    url = input('Supabase Project URL: ').strip().rstrip('/')
    if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', url):
        raise SystemExit('Project URL không hợp lệ.')
    key = getpass.getpass('Secret key / service_role key (ẩn khi nhập): ')
    if not (key.startswith('sb_secret_') or key.startswith('eyJ')):
        raise SystemExit('Cần khóa quản trị máy chủ, không phải publishable key.')
    username = input('Tên đăng nhập quản trị mới: ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', username):
        raise SystemExit('Tên đăng nhập chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.')
    full_name = input('Họ tên cán bộ quản trị: ').strip()
    if not 1 <= len(full_name) <= 150:
        raise SystemExit('Họ tên phải từ 1 đến 150 ký tự.')
    password = getpass.getpass('Mật khẩu (ít nhất 10 ký tự): ')
    if not 10 <= len(password) <= 200 or password != getpass.getpass('Nhập lại mật khẩu: '):
        raise SystemExit('Mật khẩu không hợp lệ hoặc không khớp.')
    public_config = Path(__file__).resolve().parents[1] / 'deployment' / 'public-config.json'
    config = json.loads(public_config.read_text(encoding='utf-8')) if public_config.exists() else {}
    email = config.get('adminEmail') if username.lower() == 'admin' else None
    email = email or f'{username.lower()}@login.vci.edu.vn'
    payload = {'email': email, 'password': password,
               'email_confirm': True, 'app_metadata': {'vci': {
                   'username': username, 'full_name': full_name, 'role': 'admin'}}}
    headers = {'apikey': key, 'Content-Type': 'application/json'}
    # Modern secret keys are API keys rather than JWTs. The gateway authenticates
    # them through apikey; legacy service_role also works as bearer.
    if key.startswith('eyJ'):
        headers['Authorization'] = f'Bearer {key}'
    request = urllib.request.Request(url + '/auth/v1/admin/users',
                                     data=json.dumps(payload).encode(), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f'Không tạo được quản trị (HTTP {exc.code}). Kiểm tra SQL migration, quyền khóa và tên đăng nhập trùng. Không có dữ liệu cũ bị ghi đè.') from None
    except urllib.error.URLError:
        raise SystemExit('Không kết nối được Supabase. Kiểm tra mạng và Project URL.') from None
    print(f'Đã tạo quản trị: {username}. Mật khẩu và khóa không được ghi vào tệp.')


if __name__ == '__main__':
    main()
