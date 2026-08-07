# Authenticated `/admin` timing — method and sanitized result

This check used Codex's in-app Browser automation against the existing local server. It did **not** inspect cookies, storage, credentials, or login form values. A pre-existing authenticated browser session was already available; `/admin/login` redirected to `/admin`.

In the Browser tool's persistent Node session, the following read-only navigation/inspection logic was run (the Browser plugin supplies `browser`; no user data is included):

```js
const tab = await browser.tabs.new()
const startedAt = Date.now()
await tab.goto('http://localhost:3717/admin')
await tab.playwright.waitForLoadState({ state: 'load', timeoutMs: 30_000 })
const shellMs = Date.now() - startedAt
const availableLink = tab.playwright.locator(
  'a[href*="where[publicationStatus][equals]=published"]',
)
await availableLink.waitFor({ state: 'visible', timeoutMs: 30_000 })
const statsText = await availableLink.innerText({ timeoutMs: 30_000 })
const statsMs = Date.now() - startedAt
const consoleErrors = await tab.dev.logs({ levels: ['error'], limit: 100 })
```

Sanitized result captured from that invocation:

```json
{
  "url": "http://localhost:3717/admin",
  "shellMs": 604,
  "statsMs": 3254,
  "statsText": "当前可租\\n500",
  "consoleErrors": []
}
```

`shellMs` is elapsed wall-clock time from navigation start until the browser `load` event. `statsMs` is elapsed wall-clock time until the post-fetch “当前可租 500” link became visible. These are local, warm-server observations, not browser performance-timing API values, a cold-start measurement, or a production/p95 benchmark.
