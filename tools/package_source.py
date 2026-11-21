import json
import plistlib
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root.parent / 'VCI-Student-Supabase-GitHub.zip'
exclude = {'.venv', 'node_modules', '__pycache__', '.pytest_cache', 'data', '.git', 'xcuserdata',
           'dist', 'dist-test', 'private-export', '.temp', '.branches', 'test-results'}
for plist in (root / 'ios' / 'Config').glob('*.plist'):
    with plist.open('rb') as stream:
        plistlib.load(stream)
json.loads((root / 'package.json').read_text(encoding='utf-8'))
count = 0
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if (not file.is_file() or any(part in exclude for part in relative.parts)
                or file.name.startswith('.env') or file.suffix in {'.pyc', '.sqlite3', '.db', '.pem', '.key'}):
            continue
        archive.write(file, str(Path(root.name) / relative))
        count += 1
print(f'Packaged {count} files; {output.stat().st_size:,} bytes: {output}')
