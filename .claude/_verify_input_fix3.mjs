import pwPkg from 'file:///C:/Users/elwas/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright/index.js';
const { chromium } = pwPkg;
const browser = await chromium.launch({ executablePath: 'C:/Users/elwas/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#email');
const info = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement).getPropertyValue('--foreground');
  const input = document.querySelector('#email');
  const cs = getComputedStyle(input);
  return {
    rootForegroundVar: root,
    inputColor: cs.color,
    inputWebkitTextFillColor: cs.webkitTextFillColor,
    htmlClass: document.documentElement.className,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
