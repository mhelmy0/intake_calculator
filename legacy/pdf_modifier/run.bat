@echo off
cd /d "%~dp0"

if not exist venv (
    echo Setting up virtual environment...
    python -m venv venv
)

echo Checking dependencies...
venv\Scripts\python.exe -m pip install -r requirements.txt --quiet

echo Starting PDF Toolkit server...
start /B "" venv\Scripts\python.exe app.py > server.log 2>&1

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:5050

echo.
echo PDF Toolkit is running at http://127.0.0.1:5050
echo Keep this window open - closing it stops the server. Log: server.log
echo.
pause >nul
