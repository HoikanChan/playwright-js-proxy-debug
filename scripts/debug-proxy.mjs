#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const MIME_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const opts = {
    url: '',
    maps: [],
    config: '',
    cdp: 'http://127.0.0.1:9222',
    standalone: false,
    headless: false,
    reuseTab: false,
    storageState: '',
    wait: 2000,
    waitSelector: '',
    evalExpr: '',
    screenshot: '',
    keepOpen: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--url':
        opts.url = argv[++i] ?? '';
        break;
      case '--map':
        opts.maps.push(argv[++i] ?? '');
        break;
      case '--config':
        opts.config = argv[++i] ?? '';
        break;
      case '--cdp':
        opts.cdp = argv[++i] ?? opts.cdp;
        break;
      case '--standalone':
        opts.standalone = true;
        break;
      case '--headless':
        opts.headless = true;
        break;
      case '--reuse-tab':
        opts.reuseTab = true;
        break;
      case '--storage-state':
        opts.storageState = argv[++i] ?? '';
        break;
      case '--wait':
        opts.wait = Number(argv[++i] ?? 2000);
        break;
      case '--wait-selector':
        opts.waitSelector = argv[++i] ?? '';
        break;
      case '--eval':
        opts.evalExpr = argv[++i] ?? '';
        break;
      case '--screenshot':
        opts.screenshot = argv[++i] ?? '';
        break;
      case '--keep-open':
        opts.keepOpen = true;
        break;
      default:
        console.warn(`[WARN] Unknown argument ignored: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Playwright JS Proxy Debug (Route Interception + Chrome CDP)

Usage:
  node debug-proxy.mjs --url <target-url> --map "<rule>" [options]

Rule Formats (--map, repeatable):
  file:<url-glob>=<local-file>       Serve a local file for matching URLs
  proxy:<remote-prefix>=<local-url>  Forward matching prefix to local dev server

Options:
  --url <url>              Target URL to debug
  --map <rule>             Mapping rule (can be specified multiple times)
  --config <path>          JSON config file with { url, rules }
  --cdp <url>              CDP endpoint (default: http://127.0.0.1:9222)
  --standalone             Force launching a new Playwright Chromium browser
  --headless               Run standalone browser headless
  --reuse-tab              Reuse an existing CDP tab matching --url and reload it
  --storage-state <path>   Load storageState JSON in standalone mode
  --wait <ms>              Extra wait time after load (default: 2000)
  --wait-selector <css>    Wait until selector is visible
  --eval <js>              Evaluate JS expression on page and log result
  --screenshot <path>      Save full-page screenshot
  --keep-open              Keep browser/tab open until Ctrl+C
`);
}

function parseMapString(str) {
  const eqIdx = str.indexOf('=');
  if (eqIdx === -1) {
    throw new Error(`Invalid --map rule (missing '='): ${str}`);
  }
  const left = str.slice(0, eqIdx).trim();
  const target = str.slice(eqIdx + 1).trim();

  if (left.startsWith('file:')) {
    return { type: 'file', match: left.slice(5).trim(), target };
  }
  if (left.startsWith('proxy:')) {
    return { type: 'proxy', match: left.slice(6).trim(), target };
  }
  throw new Error(`Invalid --map prefix (must start with 'file:' or 'proxy:'): ${str}`);
}

function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE_PATH) {
    candidates.push(createRequire(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH, 'package.json')));
  }
  candidates.push(createRequire(path.join(process.cwd(), 'package.json')));
  candidates.push(createRequire(import.meta.url));

  for (const req of candidates) {
    for (const pkg of ['playwright', 'playwright-core']) {
      try {
        return req(pkg);
      } catch {
        // try next
      }
    }
  }

  console.error(
    '[ERROR] Cannot find "playwright" or "playwright-core". Install one in your workspace:\n' +
      '  npm install -D playwright          (bundled Chromium)\n' +
      '  npm install -D playwright-core     (uses your local Chrome)'
  );
  process.exit(1);
}

async function isCdpReachable(cdpUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function attachRules(page, rules, stats) {
  const attachedPatterns = [];

  for (const rule of rules) {
    if (rule.type === 'file') {
      const resolvedPath = path.resolve(process.cwd(), rule.target);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Local file not found for rule "${rule.match}": ${resolvedPath}`);
      }
      const contentType = rule.contentType || getMimeType(resolvedPath);
      const handler = async (route) => {
        const reqUrl = route.request().url();
        stats.proxyHits++;
        console.log(`[PROXY HIT][file] ${reqUrl} -> ${resolvedPath}`);
        await route.fulfill({
          status: 200,
          path: resolvedPath,
          contentType,
          headers: {
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        });
      };
      await page.route(rule.match, handler);
      attachedPatterns.push({ match: rule.match, handler });
    } else if (rule.type === 'proxy') {
      const prefix = rule.match;
      const matcher = (url) => url.href.startsWith(prefix);
      const handler = async (route) => {
        const reqUrl = route.request().url();
        const mappedUrl = rule.target + reqUrl.slice(prefix.length);
        stats.proxyHits++;
        console.log(`[PROXY HIT][proxy] ${reqUrl} -> ${mappedUrl}`);
        try {
          const response = await route.fetch({ url: mappedUrl });
          const headers = {
            ...response.headers(),
            'cache-control': 'no-store',
          };
          await route.fulfill({ response, headers });
        } catch (err) {
          console.error(`[PROXY ERROR] Failed to fetch ${mappedUrl}: ${err.message}`);
          await route.abort('failed');
        }
      };
      await page.route(matcher, handler);
      attachedPatterns.push({ match: matcher, handler });
    } else if (rule.type === 'inject') {
      const handler = async (route) => {
        const reqUrl = route.request().url();
        stats.proxyHits++;
        console.log(`[PROXY HIT][inject] ${reqUrl}`);
        const response = await route.fetch();
        const originalBody = await response.text();
        const newBody = `${rule.prepend || ''}${originalBody}${rule.append || ''}`;
        const headers = {
          ...response.headers(),
          'cache-control': 'no-store',
        };
        delete headers['content-length'];
        delete headers['content-encoding'];
        await route.fulfill({
          response,
          headers,
          body: newBody,
        });
      };
      await page.route(rule.match, handler);
      attachedPatterns.push({ match: rule.match, handler });
    } else {
      throw new Error(`Unsupported rule type: ${rule.type}`);
    }
  }

  return async () => {
    for (const item of attachedPatterns) {
      await page.unroute(item.match, item.handler).catch(() => {});
    }
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let rules = [];
  if (opts.config) {
    const configPath = path.resolve(process.cwd(), opts.config);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!opts.url && raw.url) opts.url = raw.url;
    if (Array.isArray(raw.rules)) rules.push(...raw.rules);
  }
  for (const mapStr of opts.maps) {
    rules.push(parseMapString(mapStr));
  }

  if (!opts.url) {
    console.error('[ERROR] --url is required (or specify "url" in --config).');
    printHelp();
    process.exit(1);
  }

  const { chromium } = loadPlaywright();

  let browser;
  let context;
  let page;
  let isCdpMode = false;
  let createdNewTab = false;

  if (!opts.standalone && (await isCdpReachable(opts.cdp))) {
    console.log(`[INFO] Connecting to existing Chrome via CDP: ${opts.cdp}`);
    browser = await chromium.connectOverCDP(opts.cdp);
    isCdpMode = true;
    context = browser.contexts()[0] || (await browser.newContext({ ignoreHTTPSErrors: true }));

    if (opts.reuseTab) {
      const existing = context.pages().find((p) => p.url().startsWith(opts.url));
      if (existing) {
        page = existing;
        console.log(`[INFO] Reusing existing tab: ${page.url()}`);
      }
    }
    if (!page) {
      page = await context.newPage();
      createdNewTab = true;
    }
  } else {
    if (!opts.standalone) {
      console.log(`[INFO] CDP not reachable at ${opts.cdp}, falling back to standalone Chromium.`);
    }
    try {
      browser = await chromium.launch({ headless: opts.headless });
    } catch (err) {
      console.log(`[INFO] Bundled Chromium unavailable, retrying with system Chrome channel...`);
      browser = await chromium.launch({ headless: opts.headless, channel: 'chrome' });
    }
    const contextOptions = { ignoreHTTPSErrors: true };
    if (opts.storageState) {
      contextOptions.storageState = path.resolve(process.cwd(), opts.storageState);
    }
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
  }

  // Disable browser cache for this page so proxied assets are always freshly intercepted
  try {
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Network.enable');
    await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (err) {
    console.warn(`[WARN] Could not disable cache via CDP: ${err.message}`);
  }

  const stats = {
    proxyHits: 0,
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpErrors: 0,
  };

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') stats.consoleErrors++;
    console.log(`[CONSOLE ${type.toUpperCase()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    stats.pageErrors++;
    console.error(`[PAGE ERROR] ${err.stack || err.message}`);
  });

  page.on('requestfailed', (req) => {
    stats.failedRequests++;
    console.error(`[REQUEST FAILED] ${req.method()} ${req.url()} (${req.failure()?.errorText})`);
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      stats.httpErrors++;
      console.warn(`[HTTP ${res.status()}] ${res.url()}`);
    }
  });

  const cleanupRoutes = await attachRules(page, rules, stats);

  console.log(`[INFO] Navigating to: ${opts.url}`);
  if (opts.reuseTab && !createdNewTab) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
  }

  if (opts.waitSelector) {
    console.log(`[INFO] Waiting for selector: ${opts.waitSelector}`);
    await page.waitForSelector(opts.waitSelector, { state: 'visible', timeout: 15000 });
  }

  if (opts.wait > 0) {
    await page.waitForTimeout(opts.wait);
  }

  if (opts.evalExpr) {
    try {
      const result = await page.evaluate((expr) => (0, eval)(expr), opts.evalExpr);
      console.log('[EVAL RESULT]', JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`[EVAL ERROR] ${err.message}`);
    }
  }

  if (opts.screenshot) {
    const shotPath = path.resolve(process.cwd(), opts.screenshot);
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`[INFO] Screenshot saved: ${shotPath}`);
  }

  console.log('\n========== DEBUG SUMMARY ==========');
  console.log(`Mode:            ${isCdpMode ? 'CDP (Existing Chrome)' : 'Standalone Chromium'}`);
  console.log(`Target URL:      ${opts.url}`);
  console.log(`Proxy Hits:      ${stats.proxyHits}`);
  console.log(`Console Errors:  ${stats.consoleErrors}`);
  console.log(`Page Errors:     ${stats.pageErrors}`);
  console.log(`Failed Requests: ${stats.failedRequests}`);
  console.log(`HTTP >=400:      ${stats.httpErrors}`);
  console.log('===================================\n');

  if (opts.keepOpen) {
    console.log('[INFO] --keep-open enabled. Press Ctrl+C to exit and detach.');
    await new Promise((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });
  }

  await cleanupRoutes();

  if (isCdpMode) {
    if (createdNewTab && !opts.keepOpen) {
      await page.close().catch(() => {});
    }
    // Disconnect from CDP without closing the user's Chrome window
    await browser.close().catch(() => {});
  } else {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[FATAL] ${err.stack || err.message}`);
  process.exit(1);
});
