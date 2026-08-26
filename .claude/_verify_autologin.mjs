import pwPkg from 'file:///C:/Users/elwas/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright/index.js';
const { chromium } = pwPkg;
const browser = await chromium.launch({ executablePath: 'C:/Users/elwas/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`); });

await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000); // let auto-login + hydration settle
console.log('final URL:', page.url());
await page.screenshot({ path: '.claude/_screenshots/21-autologin-root.png' });
console.log('errors:', JSON.stringify(errors));
await browser.close();
