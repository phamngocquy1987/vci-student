@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"

if exist ".venv\Scripts\python.exe" goto ready
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 -m venv .venv
if errorlevel 1 goto failed
goto ready

:use_python
python -m venv .venv
if errorlevel 1 goto failed

:ready
".venv\Scripts\python.exe" tools\start_demo.py %*
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Khong khoi dong duoc VCI. Xem thong bao loi o tren.
echo Can Python 3.10 tro len va Internet khi cai thu vien lan dau.
pause
exit /b 1
