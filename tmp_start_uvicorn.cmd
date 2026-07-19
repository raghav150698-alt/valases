@echo off
set AUTH_MODE=supabase
set DATABASE_URL=sqlite:///./certora.db
cd /d D:\Lenovo\certora
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "127.0.0.1:8000 .*LISTENING"') do (
  echo API is already running at http://127.0.0.1:8000
  exit /b 0
)
D:\Lenovo\certora\.venv-proctoring\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> D:\Lenovo\certora\logs\assessment_ui_uvicorn.out.log 2>> D:\Lenovo\certora\logs\assessment_ui_uvicorn.err.log
