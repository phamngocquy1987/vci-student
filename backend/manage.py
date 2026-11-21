"""Explicit local demo seeding, admin creation, and consistent SQLite backups."""
import argparse
import getpass
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

from .app import now
from .db import connect, init_db, password_hash


def seed_demo():
    init_db()
    with connect() as db:
        if db.execute('SELECT count(*) FROM users').fetchone()[0]:
            raise SystemExit('Dữ liệu đã tồn tại. Không ghi đè. Dùng VCI_DB trỏ đến database mới để thử demo.')
        db.execute("INSERT INTO settings VALUES ('demo','1')")
        for code, campus in [('CNTT-K18A', 'Hà Nội'), ('QTKD-K18B', 'Hà Nội'), ('CNTT-K18A', 'TP. Hồ Chí Minh')]:
            db.execute('INSERT INTO classes(code,campus) VALUES (?,?)', (code, campus))
        hashed = password_hash('VciDemo@2026')
        db.execute("INSERT INTO users(username,full_name,password_hash,role) VALUES ('admin','Quản trị thử nghiệm',?,'admin')", (hashed,))
        db.execute("INSERT INTO users(username,full_name,password_hash,role,class_id) VALUES ('SV001','Sinh viên minh họa',?,'student',1)", (hashed,))
        db.execute("INSERT INTO users(username,full_name,password_hash,role,class_id) VALUES ('SV002','Sinh viên lớp khác',?,'student',2)", (hashed,))
        monday = date.today() - timedelta(days=date.today().weekday())
        subjects = [('Lập trình cơ bản', 'GV minh họa A', 'A203'), ('Tiếng Anh chuyên ngành', 'GV minh họa B', 'B105'), ('Cơ sở dữ liệu', 'GV minh họa C', 'LAB 02')]
        for week in range(3):
            for offset, subject in zip([0, 2, 4], subjects):
                db.execute('''INSERT INTO schedules(class_id,date,start,end,subject,lecturer,room,kind,status,note,updated_at)
                    VALUES (1,?,'07:30','10:00',?,?,?,'hoc','hoc','Dữ liệu minh họa',?)''',
                           ((monday + timedelta(days=week * 7 + offset)).isoformat(), *subject, now()))
            db.execute('''INSERT INTO schedules(class_id,date,start,end,subject,lecturer,room,kind,status,note,updated_at)
                VALUES (2,?,'13:00','15:30','Quản trị học','GV minh họa D','C301','hoc','hoc','Dữ liệu minh họa',?)''',
                       ((monday + timedelta(days=week * 7 + 1)).isoformat(), now()))
        db.execute('''INSERT INTO notices(title,body,created_at) VALUES (?,?,?)''',
                   ('Chào mừng đến với VCI Student', 'Đây là bản thử nghiệm. Các lớp, lịch và tài khoản đều là dữ liệu minh họa; chưa kết nối hệ thống chính thức của trường.', now()))
        db.execute('''INSERT INTO notices(class_id,title,body,created_at) VALUES (1,?,?,?)''',
                   ('Theo dõi lịch học của lớp', 'Chọn tuần để xem lịch. Các thay đổi do cán bộ công bố sẽ xuất hiện khi làm mới dữ liệu.', now()))
    print('Đã tạo dữ liệu DEMO. Admin: admin | Sinh viên: SV001, SV002 | Mật khẩu: VciDemo@2026')


def create_admin(username, full_name):
    password = getpass.getpass('Mật khẩu mới (ít nhất 12 ký tự): ')
    if len(password) < 12 or getpass.getpass('Nhập lại mật khẩu: ') != password:
        raise SystemExit('Mật khẩu không khớp hoặc quá ngắn.')
    init_db()
    with connect() as db:
        if db.execute("SELECT value FROM settings WHERE key='demo'").fetchone():
            raise SystemExit('Không tạo quản trị chính thức trong database demo. Đặt VCI_DB đến database mới.')
        try:
            db.execute("INSERT INTO users(username,full_name,password_hash,role) VALUES (?,?,?,'admin')", (username, full_name, password_hash(password)))
        except sqlite3.IntegrityError:
            raise SystemExit('Tên tài khoản đã tồn tại.')
    print('Đã tạo tài khoản quản trị. Không có tài khoản/mật khẩu mặc định.')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('seed-demo')
    admin = sub.add_parser('create-admin')
    admin.add_argument('--username', required=True)
    admin.add_argument('--name', default='Quản trị viên')
    backup = sub.add_parser('backup')
    backup.add_argument('destination')
    args = parser.parse_args()
    if args.command == 'seed-demo':
        seed_demo()
    elif args.command == 'create-admin':
        create_admin(args.username, args.name)
    else:
        output = Path(args.destination)
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            raise SystemExit('File đích đã tồn tại. Hãy chọn tên sao lưu khác.')
        with connect() as source, sqlite3.connect(output) as target:
            source.backup(target)
        print(f'Đã sao lưu: {output}')


if __name__ == '__main__':
    main()
