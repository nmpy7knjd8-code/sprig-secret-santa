import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 180, height: 180 } });
await p.setContent(`<style>body{margin:0}</style><img src="http://localhost:8787/icon.svg" width=180 height=180>`);
await p.waitForTimeout(300); await p.screenshot({ path: 'icon-180.png' }); await b.close();
