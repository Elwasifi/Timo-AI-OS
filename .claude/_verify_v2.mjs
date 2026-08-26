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
const email = 'client.test.1@acme-test.io';
const password = 'TestPassword123!';

// ---- Login ----
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('text=TEMO AI OS', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await snap('10-after-login');
  report.steps.login = { url: page.url() };
} catch (e) {
  report.steps.login = { error: String(e) };
  await snap('login-ERROR');
}

// ---- G-Brain (root) ----
try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.org-shell', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const managerNames = await page.locator('.branch-column .node-manager .node-label strong').allTextContents();
  const svgZ = await page.locator('.org-lines').evaluate((el) => getComputedStyle(el).zIndex).catch(() => null);
  const treeZ = await page.locator('.org-tree').evaluate((el) => getComputedStyle(el).zIndex).catch(() => null);
  await snap('11-gbrain');
  report.steps.gbrain = { managerNames, svgZ, treeZ };
} catch (e) {
  report.steps.gbrain = { error: String(e) };
  await snap('gbrain-ERROR');
}

// ---- Command Deck ----
try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.dashboard-shell', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const agentCardCount = await page.locator('.agent-card').count();
  await snap('12-command-deck');
  report.steps.commandDeck = { agentCardCount };
} catch (e) {
  report.steps.commandDeck = { error: String(e) };
  await snap('command-deck-ERROR');
}

// ---- Settings: Agent Management (real CRUD test) ----
try {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('text=Settings', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Agent Management/i }).click();
  await page.waitForSelector('text=Add Agent', { timeout: 10000 });
  await page.waitForTimeout(1000);
  await snap('13-settings-agents');

  await page.getByRole('button', { name: /Add Agent/i }).click();
  await page.waitForTimeout(300);
  await page.fill('#id', 'test-verify-worker').catch(async () => {
    await page.fill('input[placeholder="e.g. nova-devops"]', 'test-verify-worker');
  });
  const textInputs = await page.locator('input[type="text"], input:not([type])').all();
  await snap('14-add-agent-form');

  // Fill by placeholder to be robust to markup
  await page.locator('input[placeholder="e.g. nova-devops"]').fill('test-verify-worker');
  await page.locator('input[placeholder="e.g. DevOps Engineer"]').nth(0).fill('Verify Test Worker');
  await page.locator('input[placeholder="e.g. DevOps Engineer"]').nth(1).fill('Verify Test Worker');
  const selects = await page.locator('select').all();
  await selects[0].selectOption('worker');
  await page.waitForTimeout(300);
  const selects2 = await page.locator('select').all();
  if (selects2.length >= 2) await selects2[1].selectOption('nova');

  await page.getByRole('button', { name: /Create Agent/i }).click();
  await page.waitForTimeout(1500);
  await snap('15-after-create-agent');
  const bodyAfterCreate = await page.locator('body').innerText();
  const created = bodyAfterCreate.includes('Verify Test Worker');

  // cleanup: delete it
  const deleteBtn = page.getByRole('button', { name: /Delete Verify Test Worker/i });
  await deleteBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Confirm/i }).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await snap('16-after-delete-agent');
  const bodyAfterDelete = await page.locator('body').innerText();
  const deleted = !bodyAfterDelete.includes('Verify Test Worker');

  report.steps.agentManagement = { created, deleted };
} catch (e) {
  report.steps.agentManagement = { error: String(e) };
  await snap('agent-mgmt-ERROR');
}

// ---- Settings: Workspace & Language ----
try {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Workspace & Language/i }).click();
  await page.waitForTimeout(800);
  await snap('17-settings-workspace');
  const bodyText = await page.locator('body').innerText();
  report.steps.workspaceSection = { rendered: bodyText.includes('Assistant / CEO display name') };
} catch (e) {
  report.steps.workspaceSection = { error: String(e) };
}

// ---- Settings: Approvals ----
try {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /^Approvals$/i }).click();
  await page.waitForTimeout(800);
  await snap('18-settings-approvals');
  const bodyText = await page.locator('body').innerText();
  report.steps.approvalsSection = { rendered: bodyText.includes('Approvals'), errors: errors.slice() };
} catch (e) {
  report.steps.approvalsSection = { error: String(e) };
}

report.consoleErrors = errors;
fs.writeFileSync('D:/Timo OS/Timo-AI-OS-main/Timo-AI-OS-main/.claude/_verify_v2_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
