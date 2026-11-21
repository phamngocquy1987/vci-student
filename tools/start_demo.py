"""Windows double-click launcher; does not change PowerShell policy."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8765'


def is_vci_running():
    try:
        with urlopen(URL + '/api/meta', timeout=1) as response:
            return json.load(response).get('name') == 'VCI Student'
    except (URLError, OSError, ValueError):
        return False


def open_when_ready():
    for _ in range(60):
        if is_vci_running():
            webbrowser.open(URL)
            return
        time.sleep(0.5)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Prepare and check without starting the server')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    os.environ['VCI_DB'] = str(ROOT / 'data' / 'demo.sqlite3')
    result = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(ROOT / 'backend' / 'requirements.lock.txt')])
    if result.returncode:
        return result.returncode
    from backend.db import connect, init_db
    from backend.manage import seed_demo
    if not Path(os.environ['VCI_DB']).exists():
        seed_demo()
    init_db()
    with connect() as db:
        if not db.execute('SELECT id FROM users LIMIT 1').fetchone():
            print('Database chưa có tài khoản. Không tự ghi đè dữ liệu đang có; vui lòng kiểm tra lại.')
            return 1
    print('\nVCI Student: ' + URL, flush=True)
    print('Tài khoản demo ban đầu: admin hoặc SV001 | Mật khẩu: VciDemo@2026', flush=True)
    if args.check:
        print('Kiểm tra khởi động đạt. Chưa mở máy chủ hoặc trình duyệt.')
        return 0
    if is_vci_running():
        print('VCI đã chạy. Đang mở lại bản thử.')
        if not args.no_browser:
            webbrowser.open(URL)
        return 0
    if not args.no_browser:
        threading.Thread(target=open_when_ready, daemon=True).start()
    print('Giữ cửa sổ này mở khi dùng ứng dụng. Dừng bằng Ctrl+C.', flush=True)
    import uvicorn
    uvicorn.run('backend.app:app', host='127.0.0.1', port=8765)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
