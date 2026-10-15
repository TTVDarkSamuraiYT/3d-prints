import os
import time
from supabase import create_client

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not url or not key:
    raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as Windows environment variables.")
client = create_client(url, key)
while True:
    try:
        response = client.table("print_jobs").select("id,status,created_at").eq("status", "queued").order("created_at").execute()
        print(f"Queued jobs: {len(response.data or [])}")
    except Exception as exc:
        print(f"Queue poll failed: {exc}")
    time.sleep(max(5, int(os.environ.get("POLL_SECONDS", "10"))))
