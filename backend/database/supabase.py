import os

import httpx
from dotenv import load_dotenv
from supabase import ClientOptions, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def _create_supabase_client(key: str):
    # A single HTTP/2 connection can intermittently fail when a long-running
    # video backup and normal API requests use the shared sync client together.
    # HTTP/1.1 lets the pool use separate connections for concurrent work.
    http_client = httpx.Client(
        http2=False,
        follow_redirects=True,
        timeout=httpx.Timeout(120.0),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
    )
    options = ClientOptions(
        httpx_client=http_client,
        postgrest_client_timeout=120,
        storage_client_timeout=300,
    )
    return create_client(SUPABASE_URL, key, options=options)


def create_user_supabase_client(access_token: str):
    """Create a request-scoped client whose PostgREST calls carry the user JWT.

    A fresh client is required for every request. Mutating the authorization
    header on a process-wide client could leak one student's identity into a
    concurrent request.
    """
    client = _create_supabase_client(SUPABASE_KEY)
    client.postgrest.auth(access_token)
    return client


# Trusted server client: bypasses RLS. Keep it inside FastAPI and background
# jobs; never return this key or client to the browser.
supabase_admin = _create_supabase_client(SUPABASE_SERVICE_ROLE_KEY)
