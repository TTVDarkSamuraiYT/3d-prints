# Windows home bridge

This is currently a **read-only queue monitor**. It checks Supabase for queued jobs but does not download files or send printer-control commands. Keep physical print submission disabled until the Bambu integration method is verified for your exact firmware and Cloud mode.

## Install

1. Install Python 3.11 or newer on the Windows PC that stays at home.
2. Open PowerShell in this folder and run:

```powershell
py -3 -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

3. Put your Supabase project URL and **service-role key** into the local `.env` file. This key is privileged. Never commit it to GitHub or put it in the website's JavaScript.
4. Run the read-only monitor:

```powershell
python monitor.py
```

It will print how many jobs are queued every 10 seconds. It will not start, pause, or stop a printer.

## Before live printing

Verify the official Bambu integration SDK with Bambu Lab for your A1 mini firmware and Cloud mode. Then add private file download, atomic job claiming, duplicate-job protection, printer-busy checks, per-printer routing, error handling and confirmed status updates. Test a small known-good file on one printer before enabling the second. Do not expose the Windows PC or printer ports to the public internet.
