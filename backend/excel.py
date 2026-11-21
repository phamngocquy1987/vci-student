import io
import re
import unicodedata
import zipfile
from datetime import date, datetime, time

from openpyxl import load_workbook

HEADERS = ['Lớp', 'Cơ sở', 'Ngày', 'Bắt đầu', 'Kết thúc', 'Môn học',
           'Giảng viên', 'Phòng', 'Loại', 'Trạng thái', 'Ghi chú']
FIELDS = ['class_code', 'campus', 'date', 'start', 'end', 'subject',
          'lecturer', 'room', 'kind', 'status', 'note']


def norm(value):
    text = str(value or '').strip().lower().replace('đ', 'd')
    return ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c))


def day(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(str(value).strip(), fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError('Ngày phải là ô ngày Excel, YYYY-MM-DD hoặc DD/MM/YYYY')


def hour(value):
    if isinstance(value, (datetime, time)):
        return value.strftime('%H:%M')
    try:
        return datetime.strptime(str(value).strip(), '%H:%M').strftime('%H:%M')
    except ValueError:
        raise ValueError('Giờ phải có dạng HH:MM, ví dụ 07:30')


def open_excel(content):
    if len(content) > 5 * 1024 * 1024:
        raise ValueError('File vượt quá 5 MB')
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(f.file_size for f in archive.infolist()) > 30 * 1024 * 1024:
                raise ValueError('Nội dung giải nén vượt quá 30 MB')
        return load_workbook(io.BytesIO(content), read_only=True, data_only=False)
    except ValueError:
        raise
    except Exception:
        raise ValueError('Không đọc được file .xlsx. Hãy dùng mẫu của hệ thống.')


def parse_excel(content):
    workbook = open_excel(content)
    rows, errors = [], []
    try:
        sheet = workbook.active
        if sheet.max_row and sheet.max_row > 5001:
            raise ValueError('Chỉ nhập tối đa 5.000 dòng mỗi lần')
        iterator = sheet.iter_rows()
        first = next(iterator, ())
        names = [norm(c.value) for c in first]
        required = [norm(h) for h in HEADERS]
        if any(names.count(h) != 1 for h in required):
            raise ValueError('Thiếu hoặc trùng cột. Hãy tải mẫu Excel và giữ nguyên tiêu đề.')
        positions = [names.index(h) for h in required]
        for number, cells in enumerate(iterator, 2):
            if number > 5001:
                raise ValueError('Chỉ nhập tối đa 5.000 dòng mỗi lần')
            if all(c.value is None for c in cells):
                continue
            try:
                picked = [cells[p] for p in positions]
                if any(c.data_type == 'f' for c in picked):
                    raise ValueError('Không chấp nhận công thức; hãy dán dưới dạng giá trị')
                values = {key: c.value for key, c in zip(FIELDS, picked)}
                values['date'] = day(values['date'])
                values['start'], values['end'] = hour(values['start']), hour(values['end'])
                values['kind'] = {'hoc': 'hoc', 'thi': 'thi'}.get(norm(values['kind']), '')
                values['status'] = {'hoc': 'hoc', 'nghi': 'nghi', 'hoc bu': 'hoc_bu', 'hoc_bu': 'hoc_bu'}.get(norm(values['status']), '')
                for key in ('class_code', 'campus', 'subject', 'lecturer', 'room', 'note'):
                    values[key] = str(values[key] or '').strip()
                values['_row'] = number
                rows.append(values)
            except (ValueError, IndexError) as exc:
                errors.append({'row': number, 'message': str(exc)})
        if not rows and not errors:
            errors.append({'row': 2, 'message': 'File không có lịch học'})
        return rows, errors
    finally:
        workbook.close()


STUDENT_HEADERS = ['Mã sinh viên', 'Họ và tên', 'Lớp', 'Cơ sở']
STUDENT_FIELDS = ['username', 'full_name', 'class_code', 'campus']


REFERENCE_HEADERS = ['TT', 'Họ đệm', 'Tên', 'Ngày sinh', 'Nơi sinh', 'Giới tính', 'Dân tộc', 'Số CCCD', 'Ghi chú']
PROFILE_FIELDS = ['surname', 'given_name', 'birth_date', 'birth_place', 'gender', 'ethnicity', 'national_id', 'note']


def parse_reference_students(workbook, target_class):
    sheet = workbook.active
    headers = [norm(h) for h in REFERENCE_HEADERS]
    header_row = None
    positions = None
    for number, cells in enumerate(sheet.iter_rows(min_row=1, max_row=30, max_col=64), 1):
        names = [norm(c.value) for c in cells]
        if all(h in names for h in headers):
            if any(names.count(h) != 1 for h in headers):
                raise ValueError('Bảng có cột bị trùng. Hãy giữ đúng một cột cho mỗi tiêu đề.')
            header_row, positions = number, [names.index(h) for h in headers]
            break
    if header_row is None:
        return None
    if target_class is None:
        raise ValueError('Hãy chọn lớp nhận danh sách trước khi nhập mẫu của trường.')
    if sheet.max_row and sheet.max_row > header_row + 5001:
        raise ValueError('Chỉ nhập tối đa 5.000 sinh viên mỗi lần')
    # A named class in the document heading must agree with the administrator's selection.
    for cells in sheet.iter_rows(min_row=1, max_row=header_row - 1, max_col=64):
        for cell in cells:
            title = norm(cell.value)
            match = re.search(r'danh sach lop\s+(.+?)(?:\s*-\s*nganh\b|$)', title)
            if match and match.group(1).strip() not in ('', '...', '…', '[ma lop]'):
                if match.group(1).strip() != norm(target_class['code']):
                    raise ValueError('Tên lớp trong tiêu đề file khác lớp đang chọn. Hãy kiểm tra lại lớp nhận danh sách.')
    rows, errors = [], []
    summary_found = False
    for number, cells in enumerate(sheet.iter_rows(min_row=header_row + 1, max_col=64), header_row + 1):
        picked = [cells[p] for p in positions]
        if all(c.value is None or str(c.value).strip() == '' for c in picked):
            continue
        texts = [norm(c.value) for c in picked[:3]]
        if any(t.startswith(('tong danh sach', 'tong so sinh vien')) for t in texts):
            summary_found = True
            continue
        if summary_found:
            if str(picked[0].value or '').strip().isdigit() and (picked[1].value or picked[2].value):
                errors.append({'row': number, 'message': 'Có sinh viên nằm sau dòng tổng. Hãy chuyển dòng tổng xuống cuối danh sách rồi nhập lại.'})
            continue
        try:
            if any(c.data_type == 'f' for c in picked):
                raise ValueError('Không chấp nhận công thức; hãy dán dưới dạng giá trị')
            raw_index = str(picked[0].value or '').strip()
            if not raw_index.isdigit() or int(raw_index) < 1:
                raise ValueError('TT phải là số thứ tự nguyên dương')
            values = {key: str(c.value if c.value is not None else '').strip()
                      for key, c in zip(PROFILE_FIELDS, picked[1:])}
            birth = picked[3].value
            values['birth_date'] = day(birth) if birth is not None and str(birth).strip() else ''
            if values['birth_date'] and values['birth_date'] > date.today().isoformat():
                raise ValueError('Ngày sinh không được ở tương lai')
            identity = picked[7]
            if isinstance(identity.value, (int, float)) and not isinstance(identity.value, bool):
                if not float(identity.value).is_integer():
                    raise ValueError('Số CCCD không được chứa phần thập phân')
                values['national_id'] = str(int(identity.value))
                if re.fullmatch('0{12}', identity.number_format or ''):
                    values['national_id'] = values['national_id'].zfill(12)
            if not re.fullmatch(r'[0-9]{12}', values['national_id']):
                raise ValueError('Số CCCD bắt buộc có 12 chữ số để tạo mã đăng nhập và mật khẩu ban đầu. Nhập dạng văn bản để giữ số 0 đầu.')
            values.update({'username': values['national_id'],
                           'full_name': ' '.join(v for v in [values['surname'], values['given_name']] if v),
                           'class_code': target_class['code'], 'campus': target_class['campus'],
                           '_row': number, 'source_index': int(raw_index), 'source_format': 'school'})
            rows.append(values)
            if len(rows) > 5000:
                raise ValueError('Chỉ nhập tối đa 5.000 sinh viên mỗi lần')
        except ValueError as exc:
            errors.append({'row': number, 'message': str(exc)})
    if not rows and not errors:
        errors.append({'row': header_row + 1, 'message': 'File không có sinh viên'})
    return rows, errors


def parse_students_excel(content, target_class=None):
    workbook = open_excel(content)
    rows, errors = [], []
    try:
        sheet = workbook.active
        if sheet is None:
            raise ValueError('File không có bảng dữ liệu')
        reference = parse_reference_students(workbook, target_class)
        if reference is not None:
            return reference
        if sheet.max_row and sheet.max_row > 5001:
            raise ValueError('Chỉ nhập tối đa 5.000 sinh viên mỗi lần')
        iterator = sheet.iter_rows()
        names = [norm(c.value) for c in next(iterator, ())]
        required = [norm(h) for h in STUDENT_HEADERS]
        if any(names.count(h) != 1 for h in required):
            raise ValueError('Thiếu hoặc trùng cột. Các cột cần có: ' + ', '.join(STUDENT_HEADERS))
        positions = [names.index(h) for h in required]
        for number, cells in enumerate(iterator, 2):
            if number > 5001:
                raise ValueError('Chỉ nhập tối đa 5.000 sinh viên mỗi lần')
            if all(c.value is None for c in cells):
                continue
            try:
                selected = [cells[p] for p in positions]
                if any(c.data_type == 'f' for c in selected):
                    raise ValueError('Không chấp nhận công thức; hãy dán dưới dạng giá trị')
                row = {key: str(c.value if c.value is not None else '').strip()
                       for key, c in zip(STUDENT_FIELDS, selected)}
                row['_row'] = number
                if target_class and (row['class_code'], row['campus']) != (target_class['code'], target_class['campus']):
                    raise ValueError('Lớp/cơ sở trong file khác lớp đang chọn')
                rows.append(row)
            except (ValueError, IndexError) as exc:
                errors.append({'row': number, 'message': str(exc)})
        if not rows and not errors:
            errors.append({'row': 2, 'message': 'File không có sinh viên'})
        return rows, errors
    finally:
        workbook.close()


def validate_students(db, rows):
    errors, seen = [], set()
    classes = {(c['code'], c['campus']): c['id'] for c in db.execute('SELECT * FROM classes')}
    existing = {u['username'] for u in db.execute('SELECT username FROM users')}
    identities = {u['national_id'] for u in db.execute("SELECT national_id FROM users WHERE national_id<>''")}
    seen_ids, seen_people = set(), set()
    stored_people = {(r['class_id'], norm(r['full_name']), r['birth_date']) for r in db.execute("SELECT class_id,full_name,birth_date FROM users WHERE birth_date<>''")}
    for row in rows:
        number = row.get('_row', 0)
        row.pop('class_id', None)
        is_school = row.get('source_format') == 'school'
        identity = row.get('national_id', '')
        if is_school:
            # Apply the current rule to older pending previews as well as new uploads.
            row['username'] = identity
            if not re.fullmatch(r'[0-9]{12}', identity):
                errors.append({'row': number, 'message': 'Số CCCD bắt buộc có 12 chữ số để tạo tài khoản'})
        for key, title, limit in [('username', 'Mã sinh viên', 100), ('full_name', 'Họ và tên', 150),
                                  ('class_code', 'Lớp', 80), ('campus', 'Cơ sở', 150)]:
            value = row.get(key, '')
            if not value or len(value) > limit:
                errors.append({'row': number, 'message': f'{title} không được trống và không quá {limit} ký tự'})
        username = row.get('username', '')
        if username in seen and not (is_school and identity in seen_ids):
            errors.append({'row': number, 'message': f'Mã sinh viên {username} bị lặp trong file'})
        elif username in existing and not (is_school and identity in identities):
            errors.append({'row': number, 'message': f'Tài khoản {username} đã tồn tại; không ghi đè tài khoản cũ'})
        seen.add(username)
        class_id = classes.get((row.get('class_code'), row.get('campus')))
        if class_id is None:
            errors.append({'row': number, 'message': 'Lớp/cơ sở chưa tồn tại. Hãy tạo lớp hoặc sửa lại file.'})
        else:
            row['class_id'] = class_id
        identity = row.get('national_id', '')
        if identity:
            if identity in identities or identity in seen_ids:
                errors.append({'row': number, 'message': 'Số CCCD bị trùng trong file hoặc đã có trong hệ thống'})
            seen_ids.add(identity)
        elif row.get('source_format') == 'school' and row.get('birth_date'):
            person = (class_id, norm(row['full_name']), row['birth_date'])
            if person in stored_people or person in seen_people:
                errors.append({'row': number, 'message': 'Trùng họ tên, ngày sinh và lớp; hãy kiểm tra lại sinh viên chưa có CCCD'})
            seen_people.add(person)
        for key in PROFILE_FIELDS:
            if len(row.get(key, '')) > (1000 if key == 'note' else 200):
                errors.append({'row': number, 'message': 'Thông tin hồ sơ vượt độ dài cho phép'})
    return errors


def slot(row):
    return row['class_id'], row['date'], row['start'], row['kind']


def validate_rows(db, rows):
    errors = []
    classes = {(c['code'], c['campus']): c['id'] for c in db.execute('SELECT * FROM classes')}
    for row in rows:
        row.pop('class_id', None)
        number = row.get('_row', 0)
        class_id = classes.get((row['class_code'], row['campus']))
        if class_id is None:
            errors.append({'row': number, 'message': 'Lớp/cơ sở chưa tồn tại. Tạo lớp trước khi nhập lịch.'})
        else:
            row['class_id'] = class_id
        if not all(row.get(k) for k in ('subject', 'lecturer', 'room', 'class_code', 'campus')):
            errors.append({'row': number, 'message': 'Thiếu môn học, giảng viên, phòng, lớp hoặc cơ sở'})
        if any(len(str(row.get(k, ''))) > limit for k, limit in [('subject', 200), ('lecturer', 150), ('room', 100), ('note', 1000), ('class_code', 80), ('campus', 150)]):
            errors.append({'row': number, 'message': 'Nội dung ô vượt quá độ dài cho phép'})
        if row['start'] >= row['end']:
            errors.append({'row': number, 'message': 'Giờ kết thúc phải sau giờ bắt đầu'})
        if row['kind'] not in ('hoc', 'thi') or row['status'] not in ('hoc', 'nghi', 'hoc_bu'):
            errors.append({'row': number, 'message': 'Loại: hoc/thi; trạng thái: hoc/nghi/hoc_bu'})
    if errors:
        return errors
    keys = [slot(r) for r in rows]
    if len(set(keys)) != len(keys):
        errors.append({'row': 0, 'message': 'File có hai lịch cùng lớp, ngày, giờ bắt đầu và loại'})
        return errors
    # Replace exact slots before checking conflicts, so a file can move/swap rooms atomically.
    incoming_keys = set(keys)
    dates = {r['date'] for r in rows}
    existing = [dict(r) for r in db.execute('''SELECT s.*,c.campus,c.code class_code
        FROM schedules s JOIN classes c ON c.id=s.class_id''')
        if r['date'] in dates and slot(r) not in incoming_keys]
    checked = existing[:]
    for row in rows:
        if row['status'] == 'nghi':
            checked.append(row)
            continue
        for other in checked:
            if other['status'] == 'nghi' or row['date'] != other['date']:
                continue
            if row['start'] >= other['end'] or other['start'] >= row['end']:
                continue
            reason = None
            if row['class_id'] == other['class_id']:
                reason = 'lớp'
            elif norm(row['lecturer']) == norm(other['lecturer']):
                reason = 'giảng viên'
            elif row['campus'] == other['campus'] and norm(row['room']) == norm(other['room']):
                reason = 'phòng học'
            if reason:
                errors.append({'row': row.get('_row', 0), 'message': f"Trùng {reason} với {other['class_code']} ngày {row['date']} ({other['start']}–{other['end']})"})
                break
        checked.append(row)
    return errors
