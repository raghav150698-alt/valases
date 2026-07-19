$env:AUTH_MODE='supabase'
$env:DATABASE_URL='sqlite:///./certora.db'
Set-Location 'D:\Lenovo\certora'

$existingApi = netstat -ano | Select-String '\s127\.0\.0\.1:8000\s+.*LISTENING'
if ($existingApi) {
    Write-Host 'API is already running at http://127.0.0.1:8000'
    exit 0
}

& 'D:\Lenovo\certora\.venv-proctoring\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000
