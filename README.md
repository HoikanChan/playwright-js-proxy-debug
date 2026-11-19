# playwright-js-proxy-debug

An Agent Skill that replaces **Whistle + SwitchyOmega** JS proxy debugging workflows using **Playwright Route Interception + Chrome CDP Attachment**.

## Features

- **Route Interception (`file:` / `proxy:` / `inject`)**:
  - Replace remote JS/CSS/API responses with local built files (`file:`).
  - Forward remote asset prefixes to a local dev server via Node-side `route.fetch()` (`proxy:`), avoiding HTTPS-to-HTTP Mixed Content and CORS issues.
  - Inject custom debug snippets before/after remote JS files without replacing the entire file (`inject`).
- **Chrome CDP Attachment (`connectOverCDP`)**:
  - Auto-detects a local Chrome instance running with `--remote-debugging-port=9222` to reuse existing login sessions, cookies, and SSO auth.
  - Automatically falls back to standalone Chromium / system Chrome when CDP is not running.
  - Safely detaches on exit without closing your Chrome window.
- **Automated Diagnostics**:
  - Disables page cache automatically so proxied assets are always freshly intercepted.
  - Captures `[PROXY HIT]`, `console`, `pageerror`, `requestfailed`, `HTTP >= 400`, optional `--eval` results, and full-page screenshots.

## Installation as an Agent Skill

Clone into your project workspace (project-scoped):

```bash
git clone https://github.com/HoikanChan/playwright-js-proxy-debug.git .agents/skills/playwright-js-proxy-debug
```

Or install globally (available across all projects):

```bash
git clone https://github.com/HoikanChan/playwright-js-proxy-debug.git ~/.gemini/config/skills/playwright-js-proxy-debug
```

Install `playwright-core` (lightweight, reuses your local Chrome) or `playwright` in your target project:

```bash
npm install -D playwright-core
```

## Quick Start

### 1. (Optional) Launch Chrome with CDP to Reuse Login State

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch-chrome-cdp.ps1
```

Log in once in the opened Chrome window; the debug profile (`%LOCALAPPDATA%\ChromeDebugProfile`) persists across restarts.

### 2. Run Proxy Debug

```bash
# Replace remote JS with a local build file
node scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --map "file:**/assets/index.*.js=./dist/index.js" \
  --keep-open

# Forward remote static assets to a local dev server
node scripts/debug-proxy.mjs \
  --url "https://example.com/app" \
  --map "proxy:https://example.com/static=http://127.0.0.1:5173/static" \
  --eval "window.__APP_VERSION__" \
  --screenshot "./debug-result.png"
```

See [SKILL.md](./SKILL.md) for full options and JSON config (`--config`) examples.
