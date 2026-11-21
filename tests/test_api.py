import io
import json
import time
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app import app, attempts
from backend.db import connect, password_hash
from backend.excel import HEADERS
from backend.manage import seed_demo


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('VCI_DB', str(tmp_path / 'test.sqlite3'))
    attempts.clear()
    seed_demo()
    with TestClient(app) as client:
        yield client


def login(client, username='admin'):
    result = client.post('/api/login', json={'username': username, 'password': 'VciDemo@2026'})
    assert result.status_code == 200
    return {'Authorization': 'Bearer ' + result.json()['token']}


def excel(rows, headers=HEADERS):
    wb = Workbook()
    wb.active.append(headers)
    for row in rows:
        wb.active.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def data(**overrides):
    # A future Sunday avoids seeded demo classes and creates stable tests.
    sunday = date.today() + timedelta(days=(6 - date.today().weekday()) % 7 + 28)
    row = {'class_code': 'CNTT-K18A', 'campus': 'Hà Nội', 'date': sunday.isoformat(),
           'start': '07:30', 'end': '10:00', 'subject': 'Kiểm thử', 'lecturer': 'GV Test',
           'room': 'TEST01', 'kind': 'hoc', 'status': 'hoc', 'note': ''}
    return row | overrides


def preview(client, headers, rows):
    raw = excel([[r[k] for k in ['class_code','campus','date','start','end','subject','lecturer','room','kind','status','note']] for r in rows])
    return client.post('/api/imports/preview', headers=headers, files={'file': ('test.xlsx', raw)})


def test_auth_scope_and_denied_admin(client):
    assert client.get('/api/classes').status_code == 401
    student = login(client, 'SV001')
    d = date.today()
    query = f'/api/schedules?start={d-timedelta(days=7)}&end={d+timedelta(days=30)}&class_id=2'
    result = client.get(query, headers=student)
    assert result.status_code == 200
    assert result.json() and all(r['class_id'] == 1 for r in result.json())
    assert client.get('/api/students', headers=student).status_code == 403
    assert client.post('/api/classes', headers=student, json={'code':'OTHER','campus':'Hà Nội'}).status_code == 403
    assert len(client.get('/api/classes', headers=student).json()) == 1
    with connect() as db:
        db.execute("INSERT INTO notices(class_id,title,body,created_at) VALUES (2,'Private','Hidden','2026-01-01')")
    assert all(r['title'] != 'Private' for r in client.get('/api/notices', headers=student).json())


def test_preview_publish_update_and_no_duplicate(client):
    auth = login(client)
    row = data()
    result = preview(client, auth, [row]).json()
    assert result['errors'] == []
    with connect() as db:
        assert db.execute('SELECT count(*) FROM schedules WHERE date=?', (row['date'],)).fetchone()[0] == 0
    assert client.post(f"/api/imports/{result['id']}/publish", headers=auth).status_code == 200
    assert client.post(f"/api/imports/{result['id']}/publish", headers=auth).status_code == 409
    updated = preview(client, auth, [data(room='NEWROOM')]).json()
    assert updated['errors'] == []
    assert client.post(f"/api/imports/{updated['id']}/publish", headers=auth).status_code == 200
    with connect() as db:
        saved = db.execute('SELECT * FROM schedules WHERE date=?', (row['date'],)).fetchall()
        assert len(saved) == 1 and saved[0]['room'] == 'NEWROOM'


@pytest.mark.parametrize('second', [
    {'class_code':'QTKD-K18B','lecturer':'Other'}, # same room
    {'class_code':'QTKD-K18B','room':'Other'}, # same lecturer
    {'start':'08:00','room':'Other','lecturer':'Other'}, # same class
])
def test_conflicts_are_atomic(client, second):
    auth = login(client)
    result = preview(client, auth, [data(), data(**second)]).json()
    assert result['errors']
    assert client.post(f"/api/imports/{result['id']}/publish", headers=auth).status_code == 409
    with connect() as db:
        assert db.execute('SELECT count(*) FROM schedules WHERE date=?', (data()['date'],)).fetchone()[0] == 0


def test_revalidate_stale_preview(client):
    auth = login(client)
    batch = preview(client, auth, [data()]).json()
    other = data(class_code='QTKD-K18B', lecturer='Other')
    assert client.post('/api/schedules', headers=auth, json=other).status_code == 200
    result = client.post(f"/api/imports/{batch['id']}/publish", headers=auth)
    assert result.status_code == 409
    with connect() as db:
        assert db.execute('SELECT count(*) FROM schedules WHERE date=?', (data()['date'],)).fetchone()[0] == 1


def test_cancel_releases_room_and_notifies(client):
    auth = login(client)
    row = data()
    assert client.post('/api/schedules', headers=auth, json=row).status_code == 200
    with connect() as db:
        row_id = db.execute('SELECT id FROM schedules WHERE date=?', (row['date'],)).fetchone()[0]
    assert client.post(f'/api/schedules/{row_id}/cancel', headers=auth).status_code == 200
    assert client.post('/api/schedules', headers=auth, json=data(class_code='QTKD-K18B')).status_code == 200
    with connect() as db:
        assert db.execute('SELECT status FROM schedules WHERE id=?', (row_id,)).fetchone()[0] == 'nghi'
        assert db.execute("SELECT count(*) FROM notices WHERE title='Lịch học vừa được cập nhật'").fetchone()[0] == 3


def test_excel_bad_headers_formula_dates_unknown_class(client):
    auth = login(client)
    bad = client.post('/api/imports/preview', headers=auth, files={'file':('test.xlsx',excel([],['Wrong']))})
    assert bad.status_code == 400
    for row in [data(subject='=1+1'), data(date='not-a-date'), data(class_code='Unknown'), data(end='06:00'), data(kind='unknown')]:
        result = preview(client, auth, [row])
        assert result.status_code == 200 and result.json()['errors']
    assert client.post('/api/imports/preview', headers=auth, files={'file':('old.xls',b'bad')}).status_code == 400
    assert client.post('/api/imports/preview', headers=auth, files={'file':('test.xlsx',b'not zip')}).status_code == 400


def test_cookie_csrf_origin_logout(client):
    result = client.post('/api/login', json={'username':'admin','password':'VciDemo@2026'}).json()
    body = {'code':'NEW','campus':'Hà Nội'}
    assert client.post('/api/classes', json=body).status_code == 403
    headers = {'X-CSRF-Token':result['csrf']}
    assert client.post('/api/classes', headers=headers|{'Origin':'https://evil.example'}, json=body).status_code == 403
    assert client.post('/api/classes', headers=headers, json=body).status_code == 200
    assert client.get('/api/me').json()['csrf'] == result['csrf']
    assert client.post('/api/logout', headers=headers).status_code == 200
    assert client.get('/api/me').status_code == 401


def test_password_reset_revokes_student_sessions(client):
    student = login(client, 'SV001')
    auth = login(client)
    with connect() as db:
        student_id = db.execute("SELECT id FROM users WHERE username='SV001'").fetchone()[0]
    result = client.post(f'/api/students/{student_id}/password', headers=auth, json={'password':'ChangedPassword2026!'})
    assert result.status_code == 200
    assert client.get('/api/me', headers=student).status_code == 401
    assert client.post('/api/login', json={'username':'SV001','password':'ChangedPassword2026!'}).status_code == 200


def test_template_and_expired_session(client):
    auth = login(client)
    result = client.get('/api/template.xlsx', headers=auth)
    assert result.status_code == 200 and result.content.startswith(b'PK')
    with connect() as db:
        db.execute('UPDATE sessions SET expires=?', (time.time()-1,))
    assert client.get('/api/me', headers=auth).status_code == 401


def test_import_owned_by_creator(client):
    auth = login(client)
    batch = preview(client, auth, [data()]).json()
    with connect() as db:
        db.execute("INSERT INTO users(username,full_name,password_hash,role) VALUES ('admin2','Other',?,'admin')", (password_hash('VciDemo@2026'),))
    other = login(client, 'admin2')
    assert client.post(f"/api/imports/{batch['id']}/publish", headers=other).status_code == 404


def test_student_creation_and_duplicate(client):
    auth = login(client)
    body = {'username':'SVNEW','full_name':'Test','password':'LongPassword123!','class_id':3}
    assert client.post('/api/students', headers=auth, json=body).status_code == 200
    assert client.post('/api/students', headers=auth, json=body).status_code == 409
    assert client.post('/api/students', headers=auth, json=body|{'username':'BAD','class_id':9999}).status_code == 400
    result = client.post('/api/login', json={'username':'SVNEW','password':'LongPassword123!'})
    assert result.json()['user']['campus'] == 'TP. Hồ Chí Minh'


def student_preview(client, auth, rows):
    from backend.excel import STUDENT_HEADERS
    return client.post('/api/student-imports/preview', headers=auth,
                       files={'file': ('students.xlsx', excel(rows, STUDENT_HEADERS))})


def delete_payload(client, auth, class_id):
    impact = client.get(f'/api/classes/{class_id}/impact', headers=auth).json()
    return {'confirmation_code': impact['class']['code'], 'revision': impact['revision'],
            'delete_students': True, 'delete_related': True}


def test_rename_class_preserves_students_and_schedules(client):
    auth = login(client)
    student = login(client, 'SV001')
    pending = preview(client, auth, [data()]).json()
    result = client.put('/api/classes/1', headers=auth, json={'code':'CNTT-RENAMED','campus':'Hà Nội'})
    assert result.status_code == 200
    user = client.get('/api/me', headers=student).json()['user']
    assert user['class_id'] == 1 and user['class_code'] == 'CNTT-RENAMED'
    with connect() as db:
        assert db.execute('SELECT count(*) FROM schedules WHERE class_id=1').fetchone()[0] == 9
    assert client.post(f"/api/imports/{pending['id']}/publish", headers=auth).status_code == 404
    assert client.put('/api/classes/1', headers=auth, json={'code':'QTKD-K18B','campus':'Hà Nội'}).status_code == 409
    assert client.put('/api/classes/1', headers=auth, json={'code':'  ','campus':'Hà Nội'}).status_code == 400


def test_change_campus_checks_existing_room_conflicts(client):
    auth = login(client)
    assert client.post('/api/schedules', headers=auth, json=data()).status_code == 200
    assert client.post('/api/schedules', headers=auth, json=data(campus='TP. Hồ Chí Minh',lecturer='Other')).status_code == 200
    result = client.put('/api/classes/1', headers=auth, json={'code':'CNTT-MOVE','campus':'TP. Hồ Chí Minh'})
    assert result.status_code == 409
    with connect() as db:
        assert db.execute('SELECT campus FROM classes WHERE id=1').fetchone()[0] == 'Hà Nội'


def test_delete_class_requires_explicit_confirmation_and_matching_snapshot(client):
    auth = login(client)
    payload = delete_payload(client, auth, 1)
    assert client.request('DELETE','/api/classes/1',headers=auth,json=payload|{'confirmation_code':'WRONG'}).status_code == 400
    assert client.request('DELETE','/api/classes/1',headers=auth,json=payload|{'delete_students':False}).status_code == 409
    assert client.request('DELETE','/api/classes/1',headers=auth,json=payload|{'delete_related':False}).status_code == 409
    # A new notice makes the impact snapshot stale, so deletion must stop.
    client.post('/api/notices',headers=auth,json={'class_id':1,'title':'New','body':'New'})
    assert client.request('DELETE','/api/classes/1',headers=auth,json=payload).status_code == 409
    with connect() as db:
        assert db.execute('SELECT id FROM classes WHERE id=1').fetchone()
        assert db.execute("SELECT id FROM users WHERE username='SV001'").fetchone()


def test_delete_class_removes_only_confirmed_class_data_and_revokes_sessions(client):
    auth = login(client)
    student = login(client, 'SV001')
    batch = student_preview(client, auth, [['NEW','New','CNTT-K18A','Hà Nội']]).json()
    payload = delete_payload(client,auth,1)
    result = client.request('DELETE','/api/classes/1',headers=auth,json=payload)
    assert result.status_code == 200
    assert result.json()['deleted'] == {'students':1,'schedules':9,'notices':1,'timetable_links':0}
    assert client.get('/api/me',headers=student).status_code == 401
    assert client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'NewPassword123!'}).status_code == 404
    with connect() as db:
        assert db.execute('SELECT count(*) FROM classes').fetchone()[0] == 2
        assert db.execute('SELECT count(*) FROM schedules WHERE class_id=2').fetchone()[0] == 3
        assert db.execute('SELECT count(*) FROM notices WHERE class_id IS NULL').fetchone()[0] == 1
        assert db.execute("SELECT id FROM users WHERE username='SV002'").fetchone()
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_delete_empty_class(client):
    auth = login(client)
    payload = delete_payload(client,auth,3)|{'delete_students':False,'delete_related':False}
    assert client.request('DELETE','/api/classes/3',headers=auth,json=payload).status_code == 200
    assert client.get('/api/classes/3/impact',headers=auth).status_code == 404


def test_bulk_students_preview_confirm_and_login(client):
    auth = login(client)
    batch = student_preview(client, auth, [['000123','Sinh viên A','CNTT-K18A','Hà Nội'],
                                         ['NEW456','Sinh viên B','CNTT-K18A','TP. Hồ Chí Minh']]).json()
    assert batch['count'] == 2 and batch['errors'] == []
    with connect() as db:
        assert not db.execute("SELECT id FROM users WHERE username='000123'").fetchone()
        assert 'password' not in db.execute('SELECT payload FROM student_imports WHERE id=?',(batch['id'],)).fetchone()[0]
    result = client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'FirstPassword123!'})
    assert result.status_code == 200 and result.json()['count'] == 2
    assert client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'FirstPassword123!'}).status_code == 409
    for username, expected_class in [('000123',1),('NEW456',3)]:
        user = client.post('/api/login',json={'username':username,'password':'FirstPassword123!'}).json()['user']
        assert user['class_id'] == expected_class and user['role'] == 'student'
    with connect() as db:
        hashes = [r['password_hash'] for r in db.execute("SELECT password_hash FROM users WHERE username IN ('000123','NEW456')")]
        assert len(set(hashes)) == 2


@pytest.mark.parametrize('rows', [
    [['DUP','A','CNTT-K18A','Hà Nội'],['DUP','B','CNTT-K18A','Hà Nội']],
    [['SV001','A','CNTT-K18A','Hà Nội']],
    [['admin','A','CNTT-K18A','Hà Nội']],
    [['NEW','A','Unknown','Hà Nội']],
    [['NEW','','CNTT-K18A','Hà Nội']],
    [['=1+1','A','CNTT-K18A','Hà Nội']],
])
def test_bulk_students_bad_rows_do_not_create_partial_accounts(client,rows):
    auth = login(client)
    batch = student_preview(client,auth,rows).json()
    assert batch['errors']
    assert client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'FirstPassword123!'}).status_code == 409
    with connect() as db:
        assert db.execute('SELECT count(*) FROM users').fetchone()[0] == 3


def test_bulk_students_rechecks_duplicate_after_preview(client):
    auth = login(client)
    batch = student_preview(client,auth,[['NEW','A','CNTT-K18A','Hà Nội'],['NEW2','B','CNTT-K18A','Hà Nội']]).json()
    client.post('/api/students',headers=auth,json={'username':'NEW2','full_name':'Other','class_id':1,'password':'OtherPassword123!'})
    assert client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'FirstPassword123!'}).status_code == 409
    with connect() as db:
        assert not db.execute("SELECT id FROM users WHERE username='NEW'").fetchone()


def test_bulk_students_owner_expiration_and_permissions(client):
    auth = login(client)
    batch = student_preview(client,auth,[['NEW','A','CNTT-K18A','Hà Nội']]).json()
    with connect() as db:
        db.execute("INSERT INTO users(username,full_name,password_hash,role) VALUES ('admin2','Other',?,'admin')",(password_hash('VciDemo@2026'),))
    other = login(client,'admin2')
    url = f"/api/student-imports/{batch['id']}/confirm"
    assert client.post(url,headers=other,json={'password':'FirstPassword123!'}).status_code == 404
    student = login(client,'SV001')
    assert client.put('/api/classes/1',headers=student,json={'code':'BAD','campus':'Hà Nội'}).status_code == 403
    assert client.get('/api/classes/1/impact',headers=student).status_code == 403
    assert client.request('DELETE','/api/classes/1',headers=student,json=delete_payload(client,auth,1)).status_code == 403
    assert client.get('/api/students/template.xlsx',headers=student).status_code == 403
    assert student_preview(client,student,[['NEW','A','CNTT-K18A','Hà Nội']]).status_code == 403
    assert client.post(url,headers=student,json={'password':'FirstPassword123!'}).status_code == 403
    client.put('/api/classes/1',headers=auth,json={'code':'RENAMED','campus':'Hà Nội'})
    assert client.post(url,headers=auth,json={'password':'FirstPassword123!'}).status_code == 404


def test_student_template_text_format_and_bad_file(client):
    from openpyxl import load_workbook
    auth = login(client)
    result = client.get('/api/students/template.xlsx',headers=auth)
    assert result.status_code == 200
    wb = load_workbook(io.BytesIO(result.content))
    assert wb.active['H7'].number_format == '@'
    assert wb.active['B6'].value == 'Họ đệm'
    assert wb.active['D7'].number_format == 'dd/mm/yyyy'
    wb.close()
    assert client.post('/api/student-imports/preview',headers=auth,files={'file':('students.xlsx',excel([],['Wrong']))}).status_code == 400


def test_class_management_year_persists_and_follows_students(client):
    auth=login(client)
    created=client.post('/api/classes',headers=auth,json={'code':'YEAR-CLASS','campus':'Hà Nội','year':2024})
    assert created.status_code==200
    class_id=created.json()['id']
    rows=client.get('/api/classes',headers=auth).json()
    assert next(c for c in rows if c['id']==class_id)['year']==2024
    assert client.post('/api/students',headers=auth,json={'username':'YEAR-STUDENT','full_name':'Year test','password':'YearPassword2026!','class_id':class_id}).status_code==200
    student=next(s for s in client.get('/api/students',headers=auth).json() if s['username']=='YEAR-STUDENT')
    assert student['class_year']==2024 and student['class_id']==class_id
    body={'code':'YEAR-CLASS','campus':'Hà Nội','year':2025}
    assert client.put(f'/api/classes/{class_id}',headers=auth,json=body).status_code==200
    result=client.post('/api/login',json={'username':'YEAR-STUDENT','password':'YearPassword2026!'})
    assert result.json()['user']['class_year']==2025
    # Legacy clients omitting year must preserve the assigned year.
    assert client.put(f'/api/classes/{class_id}',headers=auth,json={'code':'YEAR-RENAMED','campus':'Hà Nội'}).status_code==200
    assert next(c for c in client.get('/api/classes',headers=auth).json() if c['id']==class_id)['year']==2025
    assert client.put(f'/api/classes/{class_id}',headers=auth,json={'code':'YEAR-RENAMED','campus':'Hà Nội','year':None}).status_code==200
    assert next(c for c in client.get('/api/classes',headers=auth).json() if c['id']==class_id)['year'] is None


@pytest.mark.parametrize('year',[1899,2201,'invalid'])
def test_invalid_management_year_rejected(client,year):
    auth=login(client)
    body={'code':'BAD-YEAR','campus':'Hà Nội','year':year}
    assert client.post('/api/classes',headers=auth,json=body).status_code==422
    assert client.put('/api/classes/1',headers=auth,json=body).status_code==422


def test_migrate_legacy_database_preserves_ids_and_relations(tmp_path,monkeypatch):
    import sqlite3
    from backend.db import init_db,public_user
    database=tmp_path/'legacy.sqlite3'
    monkeypatch.setenv('VCI_DB',str(database))
    with sqlite3.connect(database) as db:
        db.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE classes(id INTEGER PRIMARY KEY,code TEXT NOT NULL,campus TEXT NOT NULL,UNIQUE(code,campus));
        CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,full_name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,class_id INTEGER REFERENCES classes(id));
        INSERT INTO classes VALUES(11,'LEGACY','Hà Nội');
        INSERT INTO users VALUES(22,'LEGACY-SV','Existing student','existing-hash','student',11);
        ''')
    init_db()
    init_db()
    with connect() as db:
        existing=dict(db.execute('SELECT * FROM classes WHERE id=11').fetchone())
        assert existing=={'id':11,'code':'LEGACY','campus':'Hà Nội','year':None}
        student=public_user(db,22)
        assert student['class_id']==11 and student['class_year'] is None
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]


def school_roster(rows, code='CNTT-K18A'):
    from backend.excel import REFERENCE_HEADERS
    wb=Workbook()
    sheet=wb.active
    sheet.merge_cells('A1:I1')
    sheet['A1']=f'DANH SÁCH LỚP {code} - NGÀNH CÔNG NGHỆ THÔNG TIN'
    for column,header in enumerate(REFERENCE_HEADERS,1):
        sheet.cell(6,column,header)
    for row_number,values in enumerate(rows,7):
        for column,value in enumerate(values,1):
            sheet.cell(row_number,column,value)
    footer=7+len(rows)
    sheet.merge_cells(start_row=footer,end_row=footer,start_column=1,end_column=9)
    sheet.cell(footer,1,f'Tổng danh sách có {len(rows)} sinh viên./.')
    result=io.BytesIO();wb.save(result)
    return result.getvalue()


def school_preview(client,auth,rows,class_id=1,code='CNTT-K18A'):
    return client.post('/api/student-imports/preview',headers=auth,
                       data={'class_id':str(class_id)} if class_id is not None else {},
                       files={'file':('DanhSach.xlsx',school_roster(rows,code))})


def test_school_roster_fields_generated_login_and_profile_saved(client):
    auth=login(client)
    raw=[[1,'Sinh viên','Minh họa',date(2008,10,24),'Đắk Lắk','Nam','Kinh','000000000101','Ghi chú thử'],
         [2,'Tên đơn không tách',None,'08/05/2008','Bắc Ninh','Nữ','Tày','000000000102','']]
    result=school_preview(client,auth,raw)
    assert result.status_code==200
    batch=result.json()
    assert batch['errors']==[] and batch['count']==2
    first,second=batch['rows']
    assert first['birth_date']=='2008-10-24' and first['national_id']=='000000000101'
    assert first['full_name']=='Sinh viên Minh họa' and first['_row']==7
    assert second['full_name']=='Tên đơn không tách' and second['given_name']==''
    assert first['username']==first['national_id']
    confirmed=client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={})
    assert confirmed.status_code==200
    with connect() as db:
        row=dict(db.execute('SELECT * FROM users WHERE username=?',(first['username'],)).fetchone())
    profile=client.get(f"/api/students/{row['id']}",headers=auth).json()
    for key in ('surname','given_name','birth_date','birth_place','gender','ethnicity','national_id','note'):
        assert profile[key]==first[key]
    assert 'password_hash' not in profile
    exported=client.get(f"/api/student-imports/{batch['id']}/accounts.csv",headers=auth)
    assert exported.status_code==200
    assert first['username'] in exported.content.decode('utf-8-sig')
    assert 'Mật khẩu' not in exported.content.decode('utf-8-sig')
    assert 'RosterPassword123!' not in exported.content.decode('utf-8-sig')
    from openpyxl import load_workbook
    exported_xlsx=client.get(f"/api/student-imports/{batch['id']}/accounts.xlsx",headers=auth)
    assert exported_xlsx.status_code==200
    export_book=load_workbook(io.BytesIO(exported_xlsx.content))
    assert export_book.active['A2'].value=='000000000101'
    assert export_book.active['A2'].number_format=='@'
    assert export_book.active['A2'].data_type=='s'
    export_book.close()
    listed=client.get('/api/students',headers=auth).json()
    assert next(s for s in listed if s['username']==first['username'])['national_id']==first['national_id']
    login_result=client.post('/api/login',json={'username':first['username'],'password':first['national_id']})
    assert login_result.status_code==200 and login_result.json()['user']['class_id']==1
    student={'Authorization':'Bearer '+login_result.json()['token']}
    assert client.get(f"/api/students/{row['id']}",headers=student).status_code==403
    assert client.get(f"/api/student-imports/{batch['id']}/accounts.xlsx",headers=student).status_code==403
    duplicate=school_preview(client,auth,raw).json()
    assert duplicate['errors']


def test_school_roster_target_required_and_heading_matches(client):
    auth=login(client)
    row=[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh','000000000101','']
    assert school_preview(client,auth,[row],class_id=None).status_code==400
    assert school_preview(client,auth,[row],class_id=2).status_code==400
    assert school_preview(client,auth,[row],class_id=9999).status_code==400


@pytest.mark.parametrize('changes',[
    {3:'32/01/2008'}, {3:'2999-01-01'}, {7:'12345678901'}, {7:''}, {1:'=1+1'}, {0:'not-number'}
])
def test_school_roster_invalid_rows_block_confirm(client,changes):
    auth=login(client)
    row=[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh','000000000101','']
    for index,value in changes.items():row[index]=value
    result=school_preview(client,auth,[row])
    assert result.status_code==200 and result.json()['errors']
    batch=result.json()
    assert client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'RosterPassword123!'}).status_code==409


def test_school_roster_duplicate_identity_blocked(client):
    auth=login(client)
    rows=[[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh','000000000101',''],
          [2,'Sinh viên','B','02/01/2008','Hà Nội','Nam','Kinh','000000000101','']]
    result=school_preview(client,auth,rows).json()
    assert len(result['errors'])==1
    assert 'CCCD' in result['errors'][0]['message']


def test_school_roster_numeric_identity_recovers_only_explicit_zero_format(client):
    from openpyxl import load_workbook
    auth=login(client)
    raw=school_roster([[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh',12345678901,'']])
    wb=load_workbook(io.BytesIO(raw));wb.active['H7'].number_format='000000000000'
    content=io.BytesIO();wb.save(content)
    result=client.post('/api/student-imports/preview',headers=auth,data={'class_id':'1'},files={'file':('Roster.xlsx',content.getvalue())}).json()
    assert result['errors']==[] and result['rows'][0]['national_id']=='012345678901'


def test_school_roster_rows_after_total_must_not_be_silently_skipped(client):
    from openpyxl import load_workbook
    auth=login(client)
    row=[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh','000000000101','']
    wb=load_workbook(io.BytesIO(school_roster([row])))
    for col,value in enumerate([2,'Sinh viên','B','02/01/2008','Hà Nội','Nam','Kinh','',''],1):
        wb.active.cell(9,col,value)
    content=io.BytesIO();wb.save(content)
    result=client.post('/api/student-imports/preview',headers=auth,data={'class_id':'1'},files={'file':('Roster.xlsx',content.getvalue())}).json()
    assert result['errors'] and 'sau dòng tổng' in result['errors'][0]['message']


def test_school_cccd_credentials_override_old_preview_and_ignore_common_password(client):
    auth=login(client)
    identities=['000000000201','000000000202']
    rows=[[1,'Sinh viên','A','01/01/2008','Hà Nội','Nam','Kinh',identities[0],''],
          [2,'Sinh viên','B','02/01/2008','Hà Nội','Nam','Kinh',identities[1],'']]
    batch=school_preview(client,auth,rows).json()
    # Simulate a preview saved by v0.4 with previously generated SV logins.
    with connect() as db:
        payload=json.loads(db.execute('SELECT payload FROM student_imports WHERE id=?',(batch['id'],)).fetchone()[0])
        for index,row in enumerate(payload):row['username']=f'SV-OLD-{index}'
        db.execute('UPDATE student_imports SET payload=? WHERE id=?',(json.dumps(payload),batch['id']))
    result=client.post(f"/api/student-imports/{batch['id']}/confirm",headers=auth,json={'password':'IgnoredCommonPassword123!'})
    assert result.status_code==200
    for identity in identities:
        assert client.post('/api/login',json={'username':identity,'password':identity}).status_code==200
        assert client.post('/api/login',json={'username':identity,'password':'IgnoredCommonPassword123!'}).status_code==401
    assert client.post('/api/login',json={'username':identities[1],'password':identities[0]}).status_code==401
    with connect() as db:
        saved=json.loads(db.execute('SELECT payload FROM student_imports WHERE id=?',(batch['id'],)).fetchone()[0])
        assert [row['username'] for row in saved]==identities
    exported=client.get(f"/api/student-imports/{batch['id']}/accounts.csv",headers=auth).content.decode('utf-8-sig')
    assert all(identity in exported for identity in identities)
    assert 'SV-OLD-' not in exported


def timetable_body(**overrides):
    return {'class_id':1,'academic_year':'2026-2027','semester':'1','kind':'hoc',
            'title':'Lịch học kỳ I','url':'https://drive.google.com/file/d/VCI_TEST_CLASS_1/view',
            'note':'Mở sheet của lớp','active':True}|overrides


def test_timetable_links_class_scope_and_admin_permissions(client):
    auth=login(client)
    assert client.get('/api/timetable-links').status_code==200 # authenticated cookie
    one=client.post('/api/timetable-links',headers=auth,json=timetable_body()).json()
    assert 'id' in one
    assert client.post('/api/timetable-links',headers=auth,json=timetable_body(class_id=2,title='Lớp khác')).status_code==200
    assert client.post('/api/timetable-links',headers=auth,json=timetable_body(semester='2',active=False)).status_code==200
    student=login(client,'SV001')
    rows=client.get('/api/timetable-links?class_id=2',headers=student).json()
    assert len(rows)==1 and rows[0]['id']==one['id'] and rows[0]['active'] is True
    assert all(r['class_id']==1 for r in rows)
    assert client.post('/api/timetable-links',headers=student,json=timetable_body()).status_code==403
    assert client.put(f"/api/timetable-links/{one['id']}",headers=student,json=timetable_body()).status_code==403
    client.cookies.clear()
    assert client.get('/api/timetable-links').status_code==401


def test_timetable_links_update_visibility_notices_and_version(client):
    auth=login(client)
    result=client.post('/api/timetable-links',headers=auth,json=timetable_body()).json()
    link_id=result['id']
    assert client.post('/api/timetable-links',headers=auth,json=timetable_body()).status_code==409
    same=client.put(f'/api/timetable-links/{link_id}',headers=auth,json=timetable_body(version=1)).json()
    assert same['version']==1
    changed=client.put(f'/api/timetable-links/{link_id}',headers=auth,json=timetable_body(version=1,url='https://docs.google.com/spreadsheets/d/VCI_TEST/edit#gid=123')).json()
    assert changed['version']==2
    assert client.put(f'/api/timetable-links/{link_id}',headers=auth,json=timetable_body(version=1)).status_code==409
    assert client.put(f'/api/timetable-links/{link_id}',headers=auth,json=timetable_body(version=2,class_id=2)).status_code==400
    hidden=client.put(f'/api/timetable-links/{link_id}',headers=auth,json=timetable_body(version=2,active=False)).json()
    assert hidden['version']==3
    student=login(client,'SV001')
    assert client.get('/api/timetable-links',headers=student).json()==[]
    with connect() as db:
        assert db.execute("SELECT count(*) FROM notices WHERE class_id=1 AND title='Cập nhật lịch học theo học kỳ'").fetchone()[0]==3


@pytest.mark.parametrize('override',[
    {'academic_year':'2026-2028'}, {'academic_year':'2026/2027'}, {'url':'javascript:alert(1)'},
    {'url':'https://drive.google.com.evil.example/file/d/TEST/view'},
    {'url':'http://drive.google.com/file/d/TEST/view'},
    {'url':'https://user:password@drive.google.com/file/d/TEST/view'},
    {'url':'https://drive.google.com/'}, {'semester':'3'}, {'class_id':9999}, {'title':'   '}
])
def test_timetable_links_invalid_values_rejected(client,override):
    auth=login(client)
    assert client.post('/api/timetable-links',headers=auth,json=timetable_body(**override)).status_code in (400,422)


def test_timetable_links_hidden_draft_and_safe_class_delete(client):
    auth=login(client)
    link=client.post('/api/timetable-links',headers=auth,json=timetable_body(class_id=3,active=False)).json()
    assert 'id' in link
    impact=client.get('/api/classes/3/impact',headers=auth).json()
    assert impact['counts']['timetable_links']==1 and impact['counts']['notices']==0
    body=delete_payload(client,auth,3)|{'delete_related':False}
    assert client.request('DELETE','/api/classes/3',headers=auth,json=body).status_code==409
    result=client.request('DELETE','/api/classes/3',headers=auth,json=body|{'delete_related':True})
    assert result.status_code==200 and result.json()['deleted']['timetable_links']==1
    with connect() as db:
        assert db.execute('SELECT count(*) FROM timetable_links').fetchone()[0]==0
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
