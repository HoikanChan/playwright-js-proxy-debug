---
name: playwright-js-proxy-debug
description: >-
  Debug live web pages by proxying remote JS/CSS/API requests to local build
  files or a local dev server using Playwright route interception combined with
  Chrome CDP attachment (to reuse existing login sessions/cookies). Use when the
  user wants to replace online JS with local code, debug production/staging
  issues with local changes, or replace Whistle + SwitchyOmega workflows using
  Playwright.
---

# Playwright JS Proxy Debug (Route Interception + CDP)

This skill replaces the traditional **Whistle + SwitchyOmega** workflow with Playwright:
- **Network Interception (`route`)**: Intercepts remote JS/CSS/API requests and serves local files or proxies them to a local dev server (fetching from Node side to avoid HTTPS-to-HTTP Mixed Content and CORS issues).
- **CDP Attachment (`connectOverCDP`)**: Connects to an existing local Chrome instance started with `--remote-debugging-port=9222` so you can reuse existing login sessions, cookies, and intranet auth. Falls back to launching a standalone browser when CDP is not running.

## Prerequisites

Ensure `playwright` or `playwright-core` is available in the current workspace (or set `PLAYWRIGHT_MODULE_PATH`). If you already have Chrome installed locally, `playwright-core` is recommended (lightweight, no bundled browser download needed):

```bash
npm install -D playwright-core
# or full package with bundled Chromium:
npm install -D playwright
```

## Workflow

### Step 1: Decide Browser Mode (CDP vs Standalone)

- **Need existing login state / SSO / cookies (Recommended for staging/prod)**:
  1. Check if Chrome CDP is already listening on port `9222` (the script auto-detects `http://127.0.0.1:9222`).
  2. If not running, ask the user to launch Chrome with remote debugging via the helper script (or run it for them):
     ```powershell
     powershell -ExecutionPolicy Bypass -File .agents/skills/playwright-js-proxy-debug/scripts/launch-chrome-cdp.ps1
     ```
  3. Have the user log in once in that Chrome window (the profile persists across restarts).
- **Public page or no login needed**:
  - Pass `--standalone` (or let the script auto-fallback when port `9222` is not open).

### Step 2: Prepare Proxy Mapping Rules

Confirm with the user (or infer from the workspace build/dev config):
1. **Target URL**: The remote page URL to open and debug.
2. **Local Source**:
   - Local built file (e.g. `./dist/app.js`) -> use `file:<url-pattern>=<local-path>`
   - Local dev server (e.g. `http://127.0.0.1:8080`) -> use `proxy:<remote-prefix>=<local-prefix>`
   - Complex multi-rule or code injection -> create a JSON config file and pass `--config <file.json>`.

> **Tip**: If the user edited source files, make sure the local build (`npm run build`) or dev server is up to date before running the debug script.

### Step 3: Run the Debug Proxy Script

Use [debug-proxy.mjs](./scripts/debug-proxy.mjs):

```bash
# Example A: Replace a remote JS file with a local build file (auto-uses CDP if port 9222 is open)
node .agents/skills/playwright-js-proxy-debug/scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --map "file:**/assets/index.*.js=./dist/index.js" \
  --wait 3000

# Example B: Proxy remote static assets to local dev server + run diagnostic JS + take screenshot
node .agents/skills/playwright-js-proxy-debug/scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --map "proxy:https://example.com/static=http://127.0.0.1:5173/static" \
  --eval "window.__APP_VERSION__" \
  --screenshot "./debug-result.png"

# Example C: Reuse an already-open tab in CDP Chrome and reload it with proxy rules attached
node .agents/skills/playwright-js-proxy-debug/scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --reuse-tab \
  --map "file:**/app.js=./dist/app.js" \
  --keep-open

# Example D: Force standalone headless browser without CDP
node .agents/skills/playwright-js-proxy-debug/scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --standalone --headless \
  --map "file:**/app.js=./dist/app.js"
```

#### Using a JSON Config (`--config rules.json`)

For multiple rules or injecting debug snippets into remote JS without replacing the whole file:

```json
{
  "url": "https://example.com/app",
  "rules": [
    {
      "type": "file",
      "match": "**/assets/main.*.js",
      "target": "./dist/main.js"
    },
    {
      "type": "proxy",
      "match": "https://example.com/chunks/",
      "target": "http://127.0.0.1:8080/chunks/"
    },
    {
      "type": "inject",
      "match": "**/vendor.*.js",
      "prepend": "console.log('[DEBUG] vendor.js loaded');\n",
      "append": "\nconsole.log('[DEBUG] vendor.js finished');"
    }
  ]
}
```

### Step 4: Verify & Analyze Output

Check the script output to validate the debugging session:
1. **Confirm Proxy Hit**: Look for `[PROXY HIT] <remote-url> -> <local-target>`.
   - If `Proxy hits: 0`, the URL pattern did not match or the resource came from a Service Worker / different domain. Inspect the network URLs or widen the glob pattern (e.g. `**/filename*.js`).
2. **Inspect Errors**: Review `[CONSOLE ERROR]`, `[PAGE ERROR]`, and `[HTTP >=400]` entries.
3. **Iterate**: Edit local code -> rebuild (if using `file:` mode) -> re-run `debug-proxy.mjs` -> verify errors are resolved.

## Key CLI Options Reference

| Flag | Description |
| :--- | :--- |
| `--url <url>` | Target page URL to navigate to (required unless set in `--config`). |
| `--map <rule>` | Proxy rule (`file:<glob>=<path>` or `proxy:<prefix>=<localPrefix>`). Repeatable. |
| `--config <path>` | Path to JSON config with `url` and `rules` (`file`, `proxy`, `inject`). |
| `--cdp <url>` | CDP endpoint (default: `http://127.0.0.1:9222`, auto-detected). |
| `--standalone` | Skip CDP detection and launch a fresh Playwright Chromium instance. |
| `--headless` | Run standalone browser in headless mode (default: headed). |
| `--reuse-tab` | In CDP mode, attach to an existing tab matching `--url` and reload it. |
| `--storage-state <path>` | In standalone mode, load cookies/localStorage from a Playwright state JSON. |
| `--wait <ms>` | Extra wait time after load before finishing (default: `2000`). |
| `--wait-selector <css>` | Wait until a specific selector is visible. |
| `--eval <expr>` | Evaluate a JS expression in the page and print its result. |
| `--screenshot <path>` | Save a full-page screenshot to `<path>`. |
| `--keep-open` | Keep the browser/tab open and wait for Ctrl+C (useful for manual DevTools inspection). |
