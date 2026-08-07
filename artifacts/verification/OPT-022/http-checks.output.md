# Local HTTP checks — sanitized command and output

Run from `payload-office-platform/` against the already-running local server:

```sh
curl -sS -o /tmp/opt022-dashboard-stats-response.json \
  -w 'dashboard-stats status=%{http_code} total=%{time_total}s\n' \
  http://localhost:3717/api/dashboard-stats
wc -c /tmp/opt022-dashboard-stats-response.json
jq -c . /tmp/opt022-dashboard-stats-response.json

curl -sS -o /tmp/opt022-health-response.json \
  -w 'health status=%{http_code} total=%{time_total}s\n' \
  http://localhost:3717/api/health
jq -c '{status,checks,env}' /tmp/opt022-health-response.json
```

Observed sanitized output:

```text
dashboard-stats status=401 total=0.028097s
50 /tmp/opt022-dashboard-stats-response.json
{"ok":false,"error":"未登录或会话已失效"}
health status=200 total=0.836643s
{"status":"ok","checks":{"payload":"ok","db":"ok"},"env":"development"}
```

These requests send no credentials. The response bodies above contain no credentials, cookies, or environment values.
