import io
import csv
import hashlib
import json
import os
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, Field

from .db import connect, init_db, password_hash, public_user, token_hash, verify_password
from .excel import (FIELDS, HEADERS, STUDENT_HEADERS, day, hour, parse_excel,
                    PROFILE_FIELDS, parse_students_excel, validate_rows, validate_students)
from .student_template import build_student_template

ROOT = Path(__file__).resolve().parents[1]
attempts = defaultdict(deque)


def now():
    return datetime.now(timezone.utc).isoformat()


def audit(db, user, action, detail):
    db.execute('INSERT INTO audit(actor,action,detail,created_at) VALUES (?,?,?,?)',
               (user['username'], action, detail, now()))


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title='VCI Student API', version='0.7.0', lifespan=lifespan)


@app.middleware('http')
async def security_headers(request, call_next):
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        origin = request.headers.get('origin')
        if origin and origin != f'{request.url.scheme}://{request.url.netloc}':
            return Response('Origin không được phép', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    if request.url.path.startswith('/api'):
        response.headers['Cache-Control'] = 'no-store'
    return response


def current_user(request: Request):
    auth = request.headers.get('authorization', '')
    bearer = auth.startswith('Bearer ')
    token = auth[7:] if bearer else request.cookies.get('vci_session', '')
    with connect() as db:
        session = db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?',
                             (token_hash(token), time.time())).fetchone()
        if not session:
            raise HTTPException(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
        if not bearer and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            if not secrets.compare_digest(request.headers.get('x-csrf-token', ''), session['csrf']):
                raise HTTPException(403, 'Thiếu mã xác thực yêu cầu')
        user = public_user(db, session['user_id'])
        if not user:
            raise HTTPException(401, 'Tài khoản không tồn tại')
        return user


def admin(user=Depends(current_user)):
    if user['role'] != 'admin':
        raise HTTPException(403, 'Chỉ cán bộ quản trị được thực hiện chức năng này')
    return user


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


@app.post('/api/login')
def login(body: Login, request: Request, response: Response):
    # Per-client cap also bounds attempts using changing usernames. Single-process MVP.
    key = request.client.host if request.client else 'unknown'
    queue = attempts[key]
    while queue and queue[0] < time.time() - 300:
        queue.popleft()
    if len(queue) >= 15:
        raise HTTPException(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút.')
    with connect() as db:
        user = db.execute('SELECT * FROM users WHERE username=?', (body.username.strip(),)).fetchone()
        if not user or not verify_password(body.password, user['password_hash']):
            queue.append(time.time())
            raise HTTPException(401, 'Sai tài khoản hoặc mật khẩu')
        token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (token_hash(token), user['id'], csrf, time.time() + 43200))
        response.set_cookie('vci_session', token, httponly=True,
                            secure=request.url.scheme == 'https', samesite='strict', max_age=43200, path='/')
        return {'token': token, 'csrf': csrf, 'user': public_user(db, user['id'])}


@app.post('/api/logout')
def logout(request: Request, response: Response, user=Depends(current_user)):
    auth = request.headers.get('authorization', '')
    token = auth[7:] if auth.startswith('Bearer ') else request.cookies.get('vci_session', '')
    with connect() as db:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(token),))
    response.delete_cookie('vci_session', path='/')
    return {'ok': True}


@app.get('/api/me')
def me(request: Request, user=Depends(current_user)):
    # Restore the CSRF token after a page refresh without persisting it in browser storage.
    token = request.cookies.get('vci_session', '')
    with connect() as db:
        row = db.execute('SELECT csrf FROM sessions WHERE token_hash=?', (token_hash(token),)).fetchone()
    return {'user': user, 'csrf': row['csrf'] if row else ''}


class PasswordChange(BaseModel):
    old_password: str = Field(max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


@app.post('/api/password')
def change_password(body: PasswordChange, user=Depends(current_user)):
    with connect() as db:
        row = db.execute('SELECT password_hash FROM users WHERE id=?', (user['id'],)).fetchone()
        if not verify_password(body.old_password, row['password_hash']):
            raise HTTPException(400, 'Mật khẩu hiện tại không đúng')
        db.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(body.new_password), user['id']))
        db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        audit(db, user, 'password', 'Đổi mật khẩu; thu hồi tất cả phiên đăng nhập')
    return {'ok': True}


@app.get('/api/meta')
def meta():
    with connect() as db:
        demo = db.execute("SELECT value FROM settings WHERE key='demo'").fetchone()
    return {'name': 'VCI Student', 'version': '0.7.0', 'demo': bool(demo and demo['value'] == '1'), 'website': 'https://vci.edu.vn'}


@app.get('/api/classes')
def classes(user=Depends(current_user)):
    with connect() as db:
        if user['role'] == 'admin':
            return [dict(r) for r in db.execute('SELECT * FROM classes ORDER BY campus,code')]
        return [dict(r) for r in db.execute('SELECT * FROM classes WHERE id=?', (user['class_id'],))]


class SchoolClass(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    campus: str = Field(min_length=1, max_length=150)
    year: int | None = Field(default=None, ge=1900, le=2200)


@app.post('/api/classes')
def create_class(body: SchoolClass, user=Depends(admin)):
    if not body.code.strip() or not body.campus.strip():
        raise HTTPException(400, 'Tên lớp và cơ sở không được để trống')
    with connect() as db:
        try:
            cursor = db.execute('INSERT INTO classes(code,campus,year) VALUES (?,?,?)', (body.code.strip(), body.campus.strip(), body.year))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Lớp đã tồn tại tại cơ sở này')
        audit(db, user, 'create_class', f'{body.code} / {body.campus} / {body.year or "Chưa phân năm"}')
        return {'id': cursor.lastrowid}


def invalidate_class_drafts(db, school_class):
    # Expire pending drafts so deleted/recreated classes cannot receive an old import.
    for table in ('imports', 'student_imports'):
        for batch in db.execute(f'SELECT id,payload FROM {table} WHERE published=0 AND created>0').fetchall():
            rows = json.loads(batch['payload'])
            if any(r.get('class_id') == school_class['id'] or
                   (r.get('class_code'), r.get('campus')) == (school_class['code'], school_class['campus']) for r in rows):
                db.execute(f'UPDATE {table} SET created=0 WHERE id=?', (batch['id'],))


@app.put('/api/classes/{class_id}')
def update_class(class_id: int, body: SchoolClass, user=Depends(admin)):
    code, campus = body.code.strip(), body.campus.strip()
    if not code or not campus:
        raise HTTPException(400, 'Tên lớp và cơ sở không được để trống')
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        before = db.execute('SELECT * FROM classes WHERE id=?', (class_id,)).fetchone()
        if not before:
            raise HTTPException(404, 'Lớp không tồn tại')
        desired_year = body.year if 'year' in body.model_fields_set else before['year']
        if (code, campus, desired_year) == (before['code'], before['campus'], before['year']):
            return {'ok': True}
        try:
            db.execute('UPDATE classes SET code=?,campus=?,year=? WHERE id=?', (code, campus, desired_year, class_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Tên lớp đã tồn tại tại cơ sở này')
        if campus != before['campus']:
            lessons = [dict(r) for r in db.execute('''SELECT s.*,c.code class_code,c.campus FROM schedules s
                JOIN classes c ON c.id=s.class_id WHERE s.class_id=?''', (class_id,))]
            errors = validate_rows(db, lessons)
            if errors:
                raise HTTPException(409, {'message': 'Không thể đổi cơ sở vì phát sinh trùng lịch', 'errors': errors})
        invalidate_class_drafts(db, before)
        audit(db, user, 'update_class', f"{before['code']} / {before['campus']} / {before['year'] or 'Chưa phân năm'} → {code} / {campus} / {desired_year or 'Chưa phân năm'}")
    return {'ok': True}


def class_impact(db, class_id):
    school_class = db.execute('SELECT * FROM classes WHERE id=?', (class_id,)).fetchone()
    if not school_class:
        raise HTTPException(404, 'Lớp không tồn tại')
    linked = {
        'students': [dict(r) for r in db.execute('SELECT id,username,full_name FROM users WHERE class_id=? ORDER BY id', (class_id,))],
        'schedules': [dict(r) for r in db.execute('SELECT * FROM schedules WHERE class_id=? ORDER BY id', (class_id,))],
        'notices': [dict(r) for r in db.execute('SELECT * FROM notices WHERE class_id=? ORDER BY id', (class_id,))],
        'timetable_links': [dict(r) for r in db.execute('SELECT * FROM timetable_links WHERE class_id=? ORDER BY id', (class_id,))],
    }
    snapshot = json.dumps({'class': dict(school_class), **linked}, ensure_ascii=False, sort_keys=True)
    return {'class': dict(school_class), 'counts': {key: len(rows) for key, rows in linked.items()},
            'revision': hashlib.sha256(snapshot.encode()).hexdigest()}


@app.get('/api/classes/{class_id}/impact')
def class_delete_impact(class_id: int, user=Depends(admin)):
    with connect() as db:
        return class_impact(db, class_id)


class ClassDelete(BaseModel):
    confirmation_code: str = Field(max_length=80)
    revision: str = Field(min_length=64, max_length=64)
    delete_students: bool = False
    delete_related: bool = False


@app.delete('/api/classes/{class_id}')
def delete_class(class_id: int, body: ClassDelete, user=Depends(admin)):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        impact = class_impact(db, class_id)
        school_class, counts = impact['class'], impact['counts']
        if body.revision != impact['revision']:
            raise HTTPException(409, 'Dữ liệu lớp đã thay đổi. Đóng hộp thoại và chọn Xóa lớp lại để kiểm tra số lượng mới.')
        if body.confirmation_code != school_class['code']:
            raise HTTPException(400, 'Tên lớp xác nhận không khớp')
        if counts['students'] and not body.delete_students:
            raise HTTPException(409, 'Phải xác nhận xóa tài khoản sinh viên thuộc lớp này')
        if (counts['schedules'] or counts['notices'] or counts['timetable_links']) and not body.delete_related:
            raise HTTPException(409, 'Phải xác nhận xóa lịch và thông báo riêng của lớp')
        invalidate_class_drafts(db, school_class)
        db.execute('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE class_id=?)', (class_id,))
        db.execute('DELETE FROM users WHERE class_id=?', (class_id,))
        db.execute('DELETE FROM schedules WHERE class_id=?', (class_id,))
        db.execute('DELETE FROM notices WHERE class_id=?', (class_id,))
        db.execute('DELETE FROM timetable_links WHERE class_id=?', (class_id,))
        db.execute('DELETE FROM classes WHERE id=?', (class_id,))
        audit(db, user, 'delete_class', f"{school_class['code']} / {school_class['campus']}: xóa {counts['students']} tài khoản, {counts['schedules']} buổi, {counts['notices']} thông báo riêng, {counts['timetable_links']} link lịch")
    return {'ok': True, 'deleted': counts}


class Student(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=10, max_length=200)
    class_id: int


@app.get('/api/students')
def students(user=Depends(admin)):
    with connect() as db:
        return [dict(r) for r in db.execute('''SELECT u.id,u.username,u.full_name,u.national_id,u.class_id,c.code class_code,c.campus,c.year class_year
            FROM users u JOIN classes c ON c.id=u.class_id WHERE role='student' ORDER BY u.username''')]


@app.post('/api/students')
def create_student(body: Student, user=Depends(admin)):
    if not body.username.strip() or not body.full_name.strip():
        raise HTTPException(400, 'Mã sinh viên và họ tên không được để trống')
    with connect() as db:
        if not db.execute('SELECT id FROM classes WHERE id=?', (body.class_id,)).fetchone():
            raise HTTPException(400, 'Lớp không tồn tại')
        try:
            cursor = db.execute('''INSERT INTO users(username,full_name,password_hash,role,class_id)
                VALUES (?,?,?,'student',?)''', (body.username.strip(), body.full_name.strip(), password_hash(body.password), body.class_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Mã sinh viên đã tồn tại')
        audit(db, user, 'create_student', body.username)
        return {'id': cursor.lastrowid}


@app.get('/api/students/template.xlsx')
def student_template(class_id: int | None = None, user=Depends(admin)):
    with connect() as db:
        school_class = db.execute('SELECT * FROM classes WHERE id=?', (class_id,)).fetchone() if class_id is not None else db.execute('SELECT * FROM classes ORDER BY id LIMIT 1').fetchone()
        if class_id is not None and school_class is None:
            raise HTTPException(404, 'Lớp không tồn tại')
    workbook = build_student_template(school_class)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': 'attachment; filename="VCI-SinhVien-Mau.xlsx"'})


@app.post('/api/student-imports/preview')
async def student_import_preview(file: UploadFile = File(), class_id: int | None = Form(default=None), user=Depends(admin)):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(400, 'Chỉ hỗ trợ file .xlsx. Hãy lưu lại file .xls thành .xlsx trước khi nhập.')
    content = await file.read(5 * 1024 * 1024 + 1)
    with connect() as db:
        target_class = db.execute('SELECT * FROM classes WHERE id=?', (class_id,)).fetchone() if class_id is not None else None
        if class_id is not None and target_class is None:
            raise HTTPException(400, 'Lớp nhận danh sách không tồn tại')
    try:
        rows, errors = parse_students_excel(content, target_class)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with connect() as db:
        errors += validate_students(db, rows)
        batch_id = secrets.token_urlsafe(20)
        db.execute('DELETE FROM student_imports WHERE created<?', (time.time() - 86400,))
        db.execute('INSERT INTO student_imports(id,owner_id,payload,errors,created) VALUES (?,?,?,?,?)',
                   (batch_id, user['id'], json.dumps(rows, ensure_ascii=False), json.dumps(errors, ensure_ascii=False), time.time()))
    return {'id': batch_id, 'rows': rows, 'errors': errors, 'count': len(rows)}


class StudentImportConfirm(BaseModel):
    password: str | None = Field(default=None, min_length=10, max_length=200)


def load_student_batch(db, batch_id, user):
    batch = db.execute('SELECT * FROM student_imports WHERE id=? AND owner_id=?', (batch_id, user['id'])).fetchone()
    if not batch or batch['created'] < time.time() - 86400:
        raise HTTPException(404, 'Bản nháp không tồn tại, quá 24 giờ hoặc lớp đã thay đổi. Hãy nhập lại file.')
    if batch['published']:
        raise HTTPException(409, 'Danh sách này đã được tạo tài khoản')
    rows = json.loads(batch['payload'])
    errors = json.loads(batch['errors']) + validate_students(db, rows)
    if errors or not rows:
        raise HTTPException(409, {'message': 'Có lỗi hoặc dữ liệu đã thay đổi. Hãy kiểm tra và nhập lại file.', 'errors': errors})
    return rows


@app.post('/api/student-imports/{batch_id}/confirm')
def student_import_confirm(batch_id: str, body: StudentImportConfirm | None = None, user=Depends(admin)):
    with connect() as db:
        rows = load_student_batch(db, batch_id, user)
    common_password = body.password if body else None
    if any(r.get('source_format') != 'school' for r in rows) and not common_password:
        raise HTTPException(400, 'Mẫu 4 cột cũ cần mật khẩu ban đầu. Với mẫu của trường, mật khẩu được lấy từ Số CCCD.')
    passwords = [r['national_id'] if r.get('source_format') == 'school' else common_password for r in rows]
    # Authentication password hashes use a separate salt per student.
    with ThreadPoolExecutor(max_workers=4) as pool:
        hashes = list(pool.map(password_hash, passwords))
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        checked_rows = load_student_batch(db, batch_id, user)
        for row, hashed in zip(checked_rows, hashes):
            db.execute('''INSERT INTO users(username,full_name,password_hash,role,class_id,
                surname,given_name,birth_date,birth_place,gender,ethnicity,national_id,note)
                VALUES (?,?,?,'student',?,?,?,?,?,?,?,?,?)''',
                (row['username'], row['full_name'], hashed, row['class_id'], *(row.get(k, '') for k in PROFILE_FIELDS)))
        db.execute('UPDATE student_imports SET published=1,payload=? WHERE id=?',
                   (json.dumps(checked_rows, ensure_ascii=False), batch_id))
        audit(db, user, 'import_students', f'Excel: tạo {len(checked_rows)} tài khoản sinh viên')
    return {'ok': True, 'count': len(checked_rows)}


@app.get('/api/students/{student_id}')
def student_profile(student_id: int, user=Depends(admin)):
    with connect() as db:
        student = db.execute('''SELECT u.id,u.username,u.full_name,u.surname,u.given_name,
            u.birth_date,u.birth_place,u.gender,u.ethnicity,u.national_id,u.note,
            c.code class_code,c.campus,c.year class_year FROM users u
            JOIN classes c ON c.id=u.class_id WHERE u.id=? AND u.role='student' ''', (student_id,)).fetchone()
        if not student:
            raise HTTPException(404, 'Không tìm thấy sinh viên')
        return dict(student)


def imported_account_rows(db, batch_id, user):
    batch = db.execute('SELECT * FROM student_imports WHERE id=? AND owner_id=?', (batch_id, user['id'])).fetchone()
    if not batch or not batch['published'] or batch['created'] < time.time() - 86400:
        raise HTTPException(404, 'Không có danh sách tài khoản đã tạo hoặc đã quá 24 giờ')
    rows = []
    for row in json.loads(batch['payload']):
        account = db.execute('''SELECT u.username,u.full_name,c.code,c.campus,c.year FROM users u
            JOIN classes c ON c.id=u.class_id WHERE u.username=? AND u.role='student' AND u.class_id=?''',
            (row['username'], row['class_id'])).fetchone()
        if account:
            rows.append([str(v) if v is not None else '' for v in account])
    return rows


@app.get('/api/student-imports/{batch_id}/accounts.csv')
def imported_accounts(batch_id: str, user=Depends(admin)):
    with connect() as db:
        rows = imported_account_rows(db, batch_id, user)
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(['Mã đăng nhập', 'Họ và tên', 'Lớp', 'Cơ sở', 'Năm quản lý'])
    for values in rows:
        writer.writerow(["'" + v if v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
    return Response(output.getvalue().encode('utf-8-sig'), media_type='text/csv; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename="VCI-TaiKhoan-VuaTao.csv"'})


@app.get('/api/student-imports/{batch_id}/accounts.xlsx')
def imported_accounts_excel(batch_id: str, user=Depends(admin)):
    with connect() as db:
        rows = imported_account_rows(db, batch_id, user)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'TaiKhoan'
    sheet.append(['Mã đăng nhập', 'Họ và tên', 'Lớp', 'Cơ sở', 'Năm quản lý'])
    for row in rows:
        sheet.append(row)
    for row in sheet.iter_rows():
        for cell in row:
            cell.data_type = 's'
            cell.number_format = '@'
            if cell.row == 1:
                cell.font = Font(bold=True, color='FFFFFF')
                cell.fill = PatternFill('solid', fgColor='163B65')
    from openpyxl.utils import get_column_letter
    for i, width in enumerate([24, 36, 24, 24, 18], 1):
        sheet.column_dimensions[get_column_letter(i)].width = width
    sheet.freeze_panes = 'A2'
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': 'attachment; filename="VCI-TaiKhoan-VuaTao.xlsx"'})


class PasswordReset(BaseModel):
    password: str = Field(min_length=10, max_length=200)


@app.post('/api/students/{student_id}/password')
def reset_password(student_id: int, body: PasswordReset, user=Depends(admin)):
    with connect() as db:
        target = db.execute("SELECT username FROM users WHERE id=? AND role='student'", (student_id,)).fetchone()
        if not target:
            raise HTTPException(404, 'Không tìm thấy sinh viên')
        db.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(body.password), student_id))
        db.execute('DELETE FROM sessions WHERE user_id=?', (student_id,))
        audit(db, user, 'reset_password', target['username'])
    return {'ok': True}


class TimetableLink(BaseModel):
    class_id: int
    academic_year: str = Field(pattern=r'^\d{4}-\d{4}$')
    semester: Literal['1', '2', 'summer']
    kind: Literal['hoc', 'thi'] = 'hoc'
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=3000)
    note: str = Field(default='', max_length=1500)
    active: bool = True
    version: int | None = Field(default=None, ge=1)


def timetable_values(body):
    start, end = map(int, body.academic_year.split('-'))
    if not (1900 <= start < 2200 and end == start + 1):
        raise HTTPException(400, 'Năm học phải gồm hai năm liên tiếp, ví dụ 2026-2027')
    values = body.model_dump(exclude={'version'})
    for key in ('title', 'url', 'note'):
        values[key] = values[key].strip()
    if not values['title']:
        raise HTTPException(400, 'Vui lòng nhập tên lịch')
    try:
        parsed = urlparse(values['url'])
        valid = (parsed.scheme == 'https' and parsed.hostname in ('drive.google.com', 'docs.google.com')
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password
                 and len(parsed.path) > 1)
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(400, 'Dùng link HTTPS từ drive.google.com hoặc docs.google.com tới file/thư mục lịch học')
    return values


def timetable_notice(db, row, hidden=False):
    term = {'1': 'Học kỳ I', '2': 'Học kỳ II', 'summer': 'Học kỳ hè'}[row['semester']]
    title = 'Cập nhật lịch học theo học kỳ' if row['kind'] == 'hoc' else 'Cập nhật lịch thi theo học kỳ'
    body = f"{row['title']} · {term} · {row['academic_year']}. "
    body += 'Nhà trường đã tạm ẩn lịch này.' if hidden else 'Mở mục Lịch học & lịch thi để xem tài liệu do nhà trường công bố.'
    db.execute('INSERT INTO notices(class_id,title,body,created_at) VALUES (?,?,?,?)',
               (row['class_id'], title, body, now()))


@app.get('/api/timetable-links')
def timetable_links(class_id: int | None = None, user=Depends(current_user)):
    query = '''SELECT t.*,c.code class_code,c.campus,c.year class_year FROM timetable_links t
        JOIN classes c ON c.id=t.class_id'''
    params = []
    if user['role'] == 'student':
        query += ' WHERE t.class_id=? AND t.active=1'
        params.append(user['class_id'])
    elif class_id is not None:
        query += ' WHERE t.class_id=?'
        params.append(class_id)
    with connect() as db:
        rows = [dict(row) for row in db.execute(query + ' ORDER BY t.academic_year DESC,t.updated_at DESC,t.id DESC', params)]
    for row in rows:
        row['active'] = bool(row['active'])
    return rows


@app.post('/api/timetable-links')
def create_timetable_link(body: TimetableLink, user=Depends(admin)):
    values = timetable_values(body)
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        school_class = db.execute('SELECT * FROM classes WHERE id=?', (body.class_id,)).fetchone()
        if not school_class:
            raise HTTPException(400, 'Lớp không tồn tại')
        try:
            cursor = db.execute('''INSERT INTO timetable_links(class_id,academic_year,semester,kind,title,url,note,active,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)''', tuple(values[k] for k in ('class_id', 'academic_year', 'semester', 'kind', 'title', 'url', 'note', 'active')) + (now(),))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Lớp đã có link cho năm học, học kỳ và loại lịch này. Hãy chọn Sửa link để cập nhật.')
        if body.active:
            timetable_notice(db, values)
        audit(db, user, 'timetable_link', f"{school_class['code']} / {school_class['campus']} / {body.academic_year} / kỳ {body.semester}: thêm {values['title']}")
        return {'id': cursor.lastrowid, 'version': 1}


@app.put('/api/timetable-links/{link_id}')
def update_timetable_link(link_id: int, body: TimetableLink, user=Depends(admin)):
    values = timetable_values(body)
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        before = db.execute('SELECT * FROM timetable_links WHERE id=?', (link_id,)).fetchone()
        if not before:
            raise HTTPException(404, 'Không tìm thấy link lịch')
        if body.version is not None and body.version != before['version']:
            raise HTTPException(409, 'Link đã được cập nhật ở nơi khác. Làm mới và mở lại để sửa.')
        if body.class_id != before['class_id']:
            raise HTTPException(400, 'Không chuyển link sang lớp khác. Hãy ẩn link cũ và thêm link cho đúng lớp.')
        if all(before[key] == value for key, value in values.items()):
            return {'id': link_id, 'version': before['version']}
        try:
            db.execute('''UPDATE timetable_links SET academic_year=?,semester=?,kind=?,title=?,url=?,note=?,active=?,
                version=version+1,updated_at=? WHERE id=?''',
                tuple(values[k] for k in ('academic_year', 'semester', 'kind', 'title', 'url', 'note', 'active')) + (now(), link_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Đã có link cho năm học, học kỳ và loại lịch này')
        if before['active'] or body.active:
            timetable_notice(db, values, hidden=not body.active)
        audit(db, user, 'timetable_link', f"Link #{link_id} / {body.academic_year} / kỳ {body.semester}: cập nhật lần {before['version'] + 1}, {'công bố' if body.active else 'ẩn'}")
        return {'id': link_id, 'version': before['version'] + 1}


@app.get('/api/schedules')
def schedules(start: date = Query(), end: date = Query(), class_id: int | None = None, user=Depends(current_user)):
    if end < start or (end - start).days > 370:
        raise HTTPException(400, 'Khoảng thời gian không hợp lệ (tối đa 370 ngày)')
    query = '''SELECT s.*,c.code class_code,c.campus FROM schedules s
        JOIN classes c ON c.id=s.class_id WHERE s.date>=? AND s.date<=?'''
    params = [start.isoformat(), end.isoformat()]
    if user['role'] == 'student':
        query += ' AND s.class_id=?'
        params.append(user['class_id'])
    elif class_id is not None:
        query += ' AND s.class_id=?'
        params.append(class_id)
    with connect() as db:
        return [dict(r) for r in db.execute(query + ' ORDER BY s.date,s.start,c.code', params)]


def publish_rows(db, rows, user, label):
    for row in rows:
        db.execute('''INSERT INTO schedules(class_id,date,start,end,subject,lecturer,room,kind,status,note,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(class_id,date,start,kind) DO UPDATE SET
            end=excluded.end,subject=excluded.subject,lecturer=excluded.lecturer,room=excluded.room,
            status=excluded.status,note=excluded.note,updated_at=excluded.updated_at''',
            tuple(row[k] for k in ['class_id', 'date', 'start', 'end', 'subject', 'lecturer', 'room', 'kind', 'status', 'note']) + (now(),))
    for class_id in {r['class_id'] for r in rows}:
        db.execute('INSERT INTO notices(class_id,title,body,created_at) VALUES (?,?,?,?)',
                   (class_id, 'Lịch học vừa được cập nhật', 'Nhà trường đã cập nhật lịch học/lịch thi. Vui lòng mở mục Lịch học để xem chi tiết.', now()))
    audit(db, user, 'publish_schedule', f'{label}: {len(rows)} buổi')


@app.post('/api/imports/preview')
async def import_preview(file: UploadFile = File(), user=Depends(admin)):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(400, 'Chỉ hỗ trợ .xlsx. Với .xls, hãy mở Excel và lưu lại thành .xlsx.')
    content = await file.read(5 * 1024 * 1024 + 1)
    try:
        rows, errors = parse_excel(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with connect() as db:
        errors += validate_rows(db, rows)
        batch_id = secrets.token_urlsafe(20)
        db.execute('DELETE FROM imports WHERE created<?', (time.time() - 86400,))
        db.execute('INSERT INTO imports(id,owner_id,payload,errors,created) VALUES (?,?,?,?,?)',
                   (batch_id, user['id'], json.dumps(rows, ensure_ascii=False), json.dumps(errors, ensure_ascii=False), time.time()))
    return {'id': batch_id, 'rows': rows, 'errors': errors, 'count': len(rows)}


@app.post('/api/imports/{batch_id}/publish')
def import_publish(batch_id: str, user=Depends(admin)):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        batch = db.execute('SELECT * FROM imports WHERE id=? AND owner_id=?', (batch_id, user['id'])).fetchone()
        if not batch or batch['created'] < time.time() - 86400:
            raise HTTPException(404, 'Bản nháp không tồn tại hoặc đã quá 24 giờ')
        if batch['published']:
            raise HTTPException(409, 'Bản nháp này đã được công bố')
        rows = json.loads(batch['payload'])
        errors = json.loads(batch['errors']) + validate_rows(db, rows)
        if errors or not rows:
            raise HTTPException(409, {'message': 'Có lỗi hoặc lịch đã thay đổi. Hãy kiểm tra và nhập lại.', 'errors': errors})
        publish_rows(db, rows, user, f'Excel {batch_id}')
        db.execute('UPDATE imports SET published=1 WHERE id=?', (batch_id,))
    return {'ok': True, 'count': len(rows)}


class Schedule(BaseModel):
    class_code: str = Field(max_length=80)
    campus: str = Field(max_length=150)
    date: str
    start: str
    end: str
    subject: str = Field(max_length=200)
    lecturer: str = Field(max_length=150)
    room: str = Field(max_length=100)
    kind: str = 'hoc'
    status: str = 'hoc'
    note: str = Field(default='', max_length=1000)


@app.post('/api/schedules')
def save_schedule(body: Schedule, user=Depends(admin)):
    row = {key: value.strip() for key, value in body.model_dump().items()}
    try:
        row['date'], row['start'], row['end'] = day(row['date']), hour(row['start']), hour(row['end'])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        errors = validate_rows(db, [row])
        if errors:
            raise HTTPException(409, {'message': 'Không thể công bố lịch', 'errors': errors})
        publish_rows(db, [row], user, 'Nhập trực tiếp')
    return {'ok': True}


@app.post('/api/schedules/{schedule_id}/cancel')
def cancel_schedule(schedule_id: int, user=Depends(admin)):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('''SELECT s.*,c.code class_code,c.campus FROM schedules s
            JOIN classes c ON c.id=s.class_id WHERE s.id=?''', (schedule_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy buổi học')
        row = dict(row)
        row['status'] = 'nghi'
        publish_rows(db, [row], user, f'Báo nghỉ #{schedule_id}')
    return {'ok': True}


@app.get('/api/notices')
def notices(user=Depends(current_user)):
    with connect() as db:
        query = '''SELECT n.*,COALESCE(c.code,'Toàn trường') class_code,COALESCE(c.campus,'') campus
            FROM notices n LEFT JOIN classes c ON c.id=n.class_id'''
        if user['role'] == 'student':
            return [dict(r) for r in db.execute(query + ' WHERE n.class_id IS NULL OR n.class_id=? ORDER BY n.id DESC LIMIT 100', (user['class_id'],))]
        return [dict(r) for r in db.execute(query + ' ORDER BY n.id DESC LIMIT 100')]


class Notice(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    class_id: int | None = None


@app.post('/api/notices')
def create_notice(body: Notice, user=Depends(admin)):
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(400, 'Tiêu đề và nội dung không được để trống')
    with connect() as db:
        if body.class_id is not None and not db.execute('SELECT id FROM classes WHERE id=?', (body.class_id,)).fetchone():
            raise HTTPException(400, 'Lớp không tồn tại')
        cursor = db.execute('INSERT INTO notices(class_id,title,body,created_at) VALUES (?,?,?,?)',
                            (body.class_id, body.title.strip(), body.body.strip(), now()))
        audit(db, user, 'notice', body.title)
        return {'id': cursor.lastrowid}


@app.get('/api/audit')
def audit_log(user=Depends(admin)):
    with connect() as db:
        return [dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')]


@app.get('/api/template.xlsx')
def excel_template(user=Depends(admin)):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'LichHoc'
    sheet.append(HEADERS)
    with connect() as db:
        target = db.execute('SELECT * FROM classes ORDER BY id LIMIT 1').fetchone()
    sheet.append([target['code'] if target else 'CNTT-K18A', target['campus'] if target else 'Hà Nội',
                  date.today().isoformat(), '07:30', '10:00', 'Môn học mẫu - hãy thay dữ liệu',
                  'Giảng viên mẫu', 'A203', 'hoc', 'hoc', 'Dòng minh họa; thay trước khi nhập'])
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='163B65')
    from openpyxl.utils import get_column_letter
    for i in range(1, len(HEADERS) + 1):
        sheet.column_dimensions[get_column_letter(i)].width = 24 if i != 11 else 55
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': 'attachment; filename="VCI-LichHoc-Mau.xlsx"'})


app.mount('/assets', StaticFiles(directory=ROOT / 'admin'), name='assets')


@app.get('/')
def index():
    return FileResponse(ROOT / 'admin' / 'index.html')
