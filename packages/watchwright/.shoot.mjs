import { chromium } from "playwright";
const [port, outDir, ...pages] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const variants = [
  { name: "light", mode: "light", viewport: { width: 1280, height: 860 } },
  { name: "dark", mode: "dark", viewport: { width: 1280, height: 860 } },
  { name: "phone", mode: "light", viewport: { width: 390, height: 844 } },
];
for (const spec of pages) {
  const [name, hash, action] = spec.split("|");
  for (const v of variants) {
    const ctx = await b.newContext({ viewport: v.viewport, deviceScaleFactor: v.name === "phone" ? 2 : 1 });
    await ctx.addInitScript((mode) => localStorage.setItem("watchwright.theme", JSON.stringify({ look: "movement", mode })), v.mode);
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/${hash}`);
    await p.waitForTimeout(700);
    if (action) { await p.locator(action).first().click(); await p.waitForTimeout(300); }
    await p.screenshot({ path: `${outDir}/${name}-${v.name}.png`, fullPage: true });
    await ctx.close();
  }
}
await b.close();
