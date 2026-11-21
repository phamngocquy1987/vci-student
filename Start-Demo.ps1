$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc moi truong Python.' }
}
& $taskPython -m pip install -r backend/requirements.lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Cai thu vien that bai.' }
$env:VCI_DB = Join-Path $PSScriptRoot 'data/demo.sqlite3'
if (-not (Test-Path -LiteralPath $env:VCI_DB)) {
    & $taskPython -m backend.manage seed-demo
    if ($LASTEXITCODE -ne 0) { throw 'Tao du lieu demo that bai.' }
}
Write-Host 'VCI Demo: http://127.0.0.1:8765'
Write-Host 'Admin: admin | Student: SV001 | Password: VciDemo@2026'
& $taskPython -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
