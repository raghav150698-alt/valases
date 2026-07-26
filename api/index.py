try:
    from app.main import app
except Exception as exc:
    # Vercel reports only "Application startup failed" for import-time
    # failures. Keep the diagnostic free of configuration values or secrets.
    print(f"Valases application import failed: {type(exc).__name__}: {exc}", flush=True)
    raise
