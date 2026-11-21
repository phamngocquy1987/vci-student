import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def db_path():
    return Path(os.environ.get('VCI_DB', str(ROOT / 'data' / 'vci.sqlite3')))


@contextmanager
def connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY, code TEXT NOT NULL, campus TEXT NOT NULL,
            UNIQUE(code,campus));
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL, password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','student')),
            class_id INTEGER REFERENCES classes(id));
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id),
            date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
            subject TEXT NOT NULL, lecturer TEXT NOT NULL, room TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('hoc','thi')),
            status TEXT NOT NULL CHECK(status IN ('hoc','nghi','hoc_bu')),
            note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
            UNIQUE(class_id,date,start,kind));
        CREATE INDEX IF NOT EXISTS schedules_date ON schedules(date);
        CREATE TABLE IF NOT EXISTS imports (
            id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            payload TEXT NOT NULL, errors TEXT NOT NULL, created REAL NOT NULL,
            published INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS student_imports (
            id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
            payload TEXT NOT NULL, errors TEXT NOT NULL, created REAL NOT NULL,
            published INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS notices (
            id INTEGER PRIMARY KEY, class_id INTEGER REFERENCES classes(id),
            title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
            detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS timetable_links (
            id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id),
            academic_year TEXT NOT NULL, semester TEXT NOT NULL CHECK(semester IN ('1','2','summer')),
            kind TEXT NOT NULL CHECK(kind IN ('hoc','thi')), title TEXT NOT NULL,
            url TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
            version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
            UNIQUE(class_id,academic_year,semester,kind));
        ''')
        # Add a nullable management year to existing databases without guessing past years.
        columns = {row['name'] for row in db.execute('PRAGMA table_info(classes)')}
        if 'year' not in columns:
            db.execute('ALTER TABLE classes ADD COLUMN year INTEGER CHECK(year BETWEEN 1900 AND 2200)')
        user_columns = {row['name'] for row in db.execute('PRAGMA table_info(users)')}
        for field in ('surname', 'given_name', 'birth_date', 'birth_place', 'gender', 'ethnicity', 'national_id', 'note'):
            if field not in user_columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {field} TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_national_id ON users(national_id) WHERE national_id<>''")


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return f'pbkdf2_sha256${salt}${digest}'


def verify_password(password, encoded):
    try:
        _, salt, expected = encoded.split('$')
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
        return hmac.compare_digest(actual, expected)
    except ValueError:
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(db, user_id):
    row = db.execute('''SELECT u.id,u.username,u.full_name,u.role,u.class_id,
        COALESCE(c.code,'') class_code,COALESCE(c.campus,'') campus,c.year class_year
        FROM users u LEFT JOIN classes c ON c.id=u.class_id WHERE u.id=?''', (user_id,)).fetchone()
    return dict(row) if row else None
