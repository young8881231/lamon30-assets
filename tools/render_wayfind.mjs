/**
 * 尋路導覽圖 HTML → PNG（窄版重排用），同時輸出文字清單與字級稽核。
 *
 *   node render_wayfind.mjs <html> <輸出png> [寬 CSS px，預設 420] [deviceScaleFactor，預設 2]
 *
 * 一個 HTML 內若有多張圖（例如上野 ground / station 兩段），用環境變數 SECTION=<CSS 選擇器>
 * 只截那個元素：SECTION="#ground" node render_wayfind.mjs ueno_narrow.html out/ueno_wayfind_ground.png
 *
 * 另外寫出 <輸出png 去掉副檔名>.audit.json：
 *   texts   ：所有可見文字（HTML 文字節點、SVG 每個 <text> 的 textContent），給新舊比對用
 *   minFont ：實際渲染字級最小的 10 筆（CSS px；SVG 字級已乘上 viewBox 縮放）
 *   overflow：寬度溢出的元素、跑出 SVG 邊界的 <text>
 *   overlap ：同一張 SVG 內互相重疊的 <text>（垂直重疊超過較矮者 40% 才算；字框含行距，貼近的上下兩行不算）
 * 不連外網（只開 file://），不帶任何使用者識別資訊。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire("D:/Claude_Lamon30/000_Agent/tools/package.json");
const { chromium } = require("playwright-core");
const CHROME = "D:/系統檔案/Google/Chrome/Application/chrome.exe";

const [html, out, w = "420", dsf = "2"] = process.argv.slice(2);
if (!html || !out) {
  console.log("用法：node render_wayfind.mjs <html> <輸出png> [寬] [deviceScaleFactor]");
  process.exit(1);
}
const width = Number(w);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: Number(dsf) });
const page = await ctx.newPage();
await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const audit = await page.evaluate((sel) => {
  const root = sel ? document.querySelector(sel) : document.body;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const texts = [];
  const sizes = [];
  // HTML 文字節點（SVG 以外）
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t || n.parentElement.closest("svg, style, script, title")) continue;
    if (!vis(n.parentElement)) continue;
    texts.push(t);
    sizes.push({ t, px: parseFloat(getComputedStyle(n.parentElement).fontSize) });
  }
  // SVG <text>
  const overflow = [];
  const overlap = [];
  for (const svg of root.querySelectorAll("svg")) {
    const scale = svg.getScreenCTM() ? svg.getScreenCTM().a : 1;
    const sr = svg.getBoundingClientRect();
    const boxes = [];
    for (const te of svg.querySelectorAll("text")) {
      const t = te.textContent.replace(/\s+/g, " ").trim();
      if (!t) continue;
      texts.push(t);
      // tspan 有自己的 font-size 就分開算
      const spans = te.querySelectorAll("tspan");
      const els = spans.length ? [...spans] : [te];
      for (const e of els) sizes.push({ t: e.textContent.trim(), px: +(parseFloat(getComputedStyle(e).fontSize) * scale).toFixed(2) });
      const r = te.getBoundingClientRect();
      if (r.left < sr.left - 4 || r.right > sr.right + 4 || r.top < sr.top - 4 || r.bottom > sr.bottom + 4)
        overflow.push({ svgText: t, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), svg: [sr.left, sr.top, sr.right, sr.bottom].map(Math.round) });
      boxes.push({ t, r });
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 0.4 * Math.min(a.height, b.height)) overlap.push([boxes[i].t, boxes[j].t, Math.round(ix), Math.round(iy)]);
      }
  }
  // HTML 寬度溢出
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg")) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") overflow.push({ html: el.className || el.tagName, sw: el.scrollWidth, cw: el.clientWidth });
  }
  const docW = document.documentElement.scrollWidth;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > window.innerWidth + 0.5) overflow.push({ outOfPage: el.tagName + "." + (el.getAttribute("class") || ""), right: Math.round(r.right) });
  }
  sizes.sort((a, b) => a.px - b.px);
  return { docW, texts, minFont: sizes.slice(0, 10), overflow, overlap };
}, process.env.SECTION || null);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
if (process.env.SECTION) await page.locator(process.env.SECTION).screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: true });
fs.writeFileSync(out.replace(/\.png$/i, ".audit.json"), JSON.stringify(audit, null, 1), "utf-8");
await browser.close();
console.log(`OK ${out}  docW=${audit.docW}  min=${audit.minFont[0]?.px}px「${audit.minFont[0]?.t}」 overflow=${audit.overflow.length} overlap=${audit.overlap.length}`);
