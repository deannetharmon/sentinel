#!/usr/bin/env python3
"""SENT-001 data check: read-only pull of tastytrade market metrics.

Run from anywhere:
  python3 scripts/sentinel_data_check.py SPY IWM XLF AAPL

Asks for your client secret and refresh token (typing is hidden) unless
TT_CLIENT_SECRET and TT_REFRESH_TOKEN are already set in the environment.
Nothing is saved to disk. Requests only the 'read' scope, so the token it
mints cannot place orders. Secrets are never printed.
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.tastyworks.com"
UA = "sentinel-data-check/0.2"


def call(method, path, body=None, token=None):
    headers = {"User-Agent": UA, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}


def main():
    symbols = [s.upper() for s in sys.argv[1:]]
    if not symbols:
        sys.exit("Give at least one ticker, e.g. python3 scripts/sentinel_data_check.py SPY IWM")
    secret = os.environ.get("TT_CLIENT_SECRET") or getpass.getpass("Client secret (hidden): ").strip()
    refresh = os.environ.get("TT_REFRESH_TOKEN") or getpass.getpass("Refresh token (hidden): ").strip()
    if not secret or not refresh:
        sys.exit("Both the client secret and the refresh token are needed")
    print(f"Got client secret ({len(secret)} characters) and refresh token ({len(refresh)} characters)")
    print("Contacting tastytrade...", flush=True)

    status, tok = call("POST", "/oauth/token", {
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_secret": secret,
        "scope": "read",
    })
    access = tok.get("access_token")
    if status != 200 or not access:
        sys.exit(f"Token refresh failed: HTTP {status}")
    print("Token refresh OK (read scope only)\n")

    q = urllib.parse.quote(",".join(symbols), safe=",")
    status, out = call("GET", f"/market-metrics?symbols={q}", token=access)
    if status != 200:
        sys.exit(f"market-metrics failed: HTTP {status} {out}")

    items = out.get("data", {}).get("items", [])
    print(f"market-metrics returned {len(items)} of {len(symbols)} symbols\n")
    words = ("volatil", "rank", "percentile", "updated", "liquidity", "beta", "corr", "earn")
    for it in items:
        print(it.get("symbol"))
        for k, v in it.items():
            if k == "option-expiration-implied-volatilities":
                continue
            if any(w in k.lower() for w in words):
                print(f"  {k}: {json.dumps(v)[:200] if isinstance(v, (dict, list)) else v}")
        print()

    s0 = symbols[0]
    status, er = call("GET", f"/market-metrics/historic-corporate-events/earnings-reports/{s0}?start-date=2025-01-01", token=access)
    print(f"earnings-reports endpoint for {s0}: HTTP {status}")
    if status == 200:
        rows = er.get("data", {}).get("items", er.get("data", []))
        print(f"  rows: {len(rows) if hasattr(rows, '__len__') else 'n/a'}")
        if rows:
            print("  most recent:", json.dumps(rows[-1])[:200])


if __name__ == "__main__":
    main()
