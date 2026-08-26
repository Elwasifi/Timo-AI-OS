import pwPkg from 'file:///C:/Users/elwas/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright/index.js';
const { chromium } = pwPkg;
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const outDir = 'D:/Timo OS/Timo-AI-OS-main/Timo-AI-OS-main/.claude/_screenshots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Users/elwas/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('response', (res) => { if (res.status() >= 500) errors.push(`[http ${res.status()}] ${res.url()}`); });

async function snap(name) { await page.screenshot({ path: `${outDir}/${name}.png` }); }

const report = { steps: {} };
const testEmail = `owner.test.${Date.now()}@gmail.com`;
const testPassword = 'TestPassword123!';

// ---- 1. Signup (first user -> internal tenant owner) ----
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('text=TEMO AI OS', { timeout: 15000 });
  await page.waitForTimeout(1500); // let React hydrate before interacting
  await snap('01-login-page');

  await page.getByRole('button', { name: /Create one/i }).click();
  await page.waitForSelector('#company', { timeout: 5000 });
  await page.fill('#company', 'Test Owner Co');
  await page.fill('#email', testEmail);
  await page.fill('#password', testPassword);
  await snap('02-signup-filled');
  await page.getByRole('button', { name: /Create workspace/i }).click();
  await page.waitForTimeout(2000);
  await snap('03-after-signup');

  const bodyText = await page.locator('body').innerText();
  report.steps.signup = {
    email: testEmail,
    confirmationRequiredNoticeShown: bodyText.includes('Check your email'),
    errorShown: bodyText.match(/error|failed/i)?.[0] ?? null,
  };
} catch (e) {
  report.steps.signup = { error: String(e) };
  await snap('signup-ERROR');
}

report.consoleErrors = errors;
fs.writeFileSync('D:/Timo OS/Timo-AI-OS-main/Timo-AI-OS-main/.claude/_verify_v1_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
