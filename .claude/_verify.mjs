import pwPkg from 'file:///C:/Users/elwas/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright/index.js';
const { chromium } = pwPkg;
import fs from 'node:fs';

const BASE = 'http://localhost:3007';
const outDir = 'D:/Timo OS/Timo-AI-OS-main/Timo-AI-OS-main/.claude/_screenshots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Users/elwas/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => errors.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`));
page.on('response', (res) => {
  if (res.status() >= 400) errors.push(`[http ${res.status()}] ${res.url()}`);
});

async function snap(name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
}

const report = { pages: {} };

// ---- 1. G-Brain (root) ----
try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.org-shell', { timeout: 15000 });
  await page.waitForSelector('.node-ceo', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500); // let measure()/edges settle
  const managerCount = await page.locator('.branch-column').count();
  const managerNames = await page.locator('.branch-column .node-manager .node-label strong').allTextContents();
  const novaSubCount = await page.locator('.branch-column').nth(managerNames.findIndex(n => n.trim() === 'NOVA')).locator('.node-sub').count().catch(() => -1);
  const svgZ = await page.locator('.org-lines').evaluate((el) => getComputedStyle(el).zIndex);
  const treeZ = await page.locator('.org-tree').evaluate((el) => getComputedStyle(el).zIndex);
  const edgeCount = await page.locator('.org-lines path').count();
  await snap('01-gbrain-root');
  report.pages.gbrain = { url: `${BASE}/`, managerCount, managerNames, novaSubCount, svgZ, treeZ, edgeCount };
} catch (e) {
  report.pages.gbrain = { error: String(e) };
  await snap('01-gbrain-root-ERROR');
}

// ---- 2. Command Deck ----
try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.dashboard-shell', { timeout: 15000 });
  await page.waitForSelector('.agent-card', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const agentCardCount = await page.locator('.agent-card').count();
  const temoLabel = await page.locator('.central-hologram p').textContent().catch(() => null);
  await snap('02-command-deck');
  report.pages.commandDeck = { url: `${BASE}/dashboard`, agentCardCount, temoLabel };
} catch (e) {
  report.pages.commandDeck = { error: String(e) };
  await snap('02-command-deck-ERROR');
}

// ---- 3. Settings > Agent Management ----
try {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('text=Settings', { timeout: 15000 });
  await page.getByRole('button', { name: /Agent Management/i }).click();
  await page.waitForSelector('text=Add Agent', { timeout: 10000 });
  await page.waitForTimeout(800);
  const agentRowCountBefore = await page.locator('.rounded-xl.border.border-border\\/40').count();
  await snap('03-settings-agents-before');

  // --- Add Agent flow ---
  await page.getByRole('button', { name: /Add Agent/i }).click();
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="e.g. nova-devops"]', 'test-verify-worker');
  await page.fill('input[placeholder="e.g. DevOps Engineer"] >> nth=0', 'Verify Test Worker');
  await page.fill('input[placeholder="e.g. DevOps Engineer"] >> nth=1', 'Verify Test Worker');
  await page.selectOption('select >> nth=0', 'worker');
  await page.waitForTimeout(200);
  await page.selectOption('select:near(:text("Reports to"))', 'nova').catch(async () => {
    // fallback: select by index if :near selector unsupported
    const selects = await page.locator('select').all();
    if (selects.length >= 2) await selects[1].selectOption('nova');
  });
  await snap('04-settings-add-form-filled');
  await page.getByRole('button', { name: /Create Agent/i }).click();
  await page.waitForTimeout(1200);
  await snap('05-settings-after-create');

  const bodyTextAfterCreate = await page.locator('body').innerText();
  const createdVisible = bodyTextAfterCreate.includes('Verify Test Worker');

  // --- Refresh and confirm persistence ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Agent Management/i }).click();
  await page.waitForTimeout(1000);
  const bodyTextAfterReload = await page.locator('body').innerText();
  const persistedAfterReload = bodyTextAfterReload.includes('Verify Test Worker');
  await snap('06-settings-after-reload');

  // --- Delete flow (cleanup) ---
  const row = page.locator('div', { hasText: 'Verify Test Worker' }).last();
  const deleteBtn = page.getByRole('button', { name: /Delete Verify Test Worker/i });
  await deleteBtn.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Confirm/i }).click();
  await page.waitForTimeout(1000);
  await snap('07-settings-after-delete');
  const bodyTextAfterDelete = await page.locator('body').innerText();
  const deletedConfirmed = !bodyTextAfterDelete.includes('Verify Test Worker');

  report.pages.settings = {
    url: `${BASE}/settings`,
    agentRowCountBefore,
    createdVisible,
    persistedAfterReload,
    deletedConfirmed,
  };
} catch (e) {
  report.pages.settings = { error: String(e) };
  await snap('settings-ERROR');
}

report.consoleErrors = errors;

fs.writeFileSync('D:/Timo OS/Timo-AI-OS-main/Timo-AI-OS-main/.claude/_verify-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
