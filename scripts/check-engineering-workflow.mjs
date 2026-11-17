import { readFile } from "node:fs/promises";

const [html, css, js, analysis, app, index, manifestText, pwa, serviceWorker] = await Promise.all([
  readFile("docs/engineering.html", "utf8"),
  readFile("docs/engineering.css", "utf8"),
  readFile("docs/engineering.js", "utf8"),
  readFile("docs/engineering-analysis.js", "utf8"),
  readFile("docs/app.js", "utf8"),
  readFile("docs/index.html", "utf8"),
  readFile("docs/manifest.webmanifest", "utf8"),
  readFile("docs/pwa.js", "utf8"),
  readFile("docs/sw.js", "utf8"),
]);
const manifest = JSON.parse(manifestText);

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const phaseIds = ["prepare", "start", "build", "payment", "finish", "accept", "warranty"];
const itemMatches = [...js.matchAll(/^\s*\["(prepare|start|build|payment|finish|accept|warranty)","([^"]+)",/gm)];
const itemIds = itemMatches.map((match) => match[2]);
const templateBlock = js.slice(js.indexOf("const templates = ["), js.indexOf("];", js.indexOf("const templates = [")) + 2);
const templateMatches = [...templateBlock.matchAll(/\["([^"]+)","[^"]+","[^"]+"\]/g)];

assert(itemMatches.length === 55, `文書項目應為 55，實際 ${itemMatches.length}`);
assert(new Set(itemIds).size === itemIds.length, "文書項目 ID 不可重複");
for (const phase of phaseIds) assert(itemMatches.some((match) => match[1] === phase), `缺少階段：${phase}`);
assert(templateMatches.length === 11, `草稿範本應為 11，實際 ${templateMatches.length}`);
assert(/existing = Object\.values\(projects\)\.find/.test(js), "缺少標案帶入去重邏輯");
assert(/twb\.engineeringProjects\.v1/.test(js), "缺少工程專案儲存鍵");
assert(/備份專案進度（JSON）/.test(html) && /匯入專案備份/.test(html) && /匯出清單 CSV/.test(html), "缺少備份或清單匯出入口");
assert(/pcc\.gov\.tw/.test(html) && /law\.moj\.gov\.tw/.test(html), "缺少官方依據連結");
assert(/engineering\.html\?tender=/.test(app), "案件工作台尚未串接工程文書中心");
assert((index.match(/engineering\.html/g) || []).length >= 2, "首頁缺少工程文書中心入口");
assert(/@media \(max-width: 700px\)/.test(css), "缺少手機版樣式");
assert(/indexedDB\.open/.test(js) && /attachment-files/.test(html), "缺少本機多格式附件功能");
assert(/\.xml,.tpa,.dwg,.dxf,.rvt,.ifc/.test(html), "缺少 PCCES、TPA、CAD 或 BIM 附件格式");
assert(/JSON 只供本系統備份進度，不是公共工程正式文件/.test(html), "缺少 JSON 與正式工程文件的界線說明");
assert(/application\/msword/.test(js) && /data-format="print"/.test(js), "缺少 Word 或列印 PDF 草稿輸出");
assert(/pdf-analysis-file/.test(html) && /pdf\.min\.mjs/.test(analysis), "缺少建築師 PDF 自動分析入口");
assert(/PDF／DWG 圖說包自動整理/.test(html) && /multiple hidden/.test(html), "缺少 PDF／DWG 多檔圖說包入口");
assert(/readDwgHeader/.test(analysis) && /classifyDwg/.test(analysis) && /AC1032/.test(analysis), "缺少 DWG 格式辨識與圖說分類");
assert(/手機／瀏覽器不會假裝讀懂 DWG/.test(html), "缺少 DWG 瀏覽器解析限制說明");
assert(/施工前/.test(analysis) && /施工中/.test(analysis) && /完工／竣工/.test(analysis), "PDF 分析缺少施工前中後分類");
assert(/source-page/.test(analysis) && /PDF 第/.test(analysis), "PDF 分析缺少來源頁碼");
assert(/needsOcr/.test(analysis) && /不會上傳公開網站/.test(html), "PDF 分析缺少 OCR 與隱私界線");
assert(/documentAnalysis/.test(js) && /version:3/.test(js), "專案備份未納入 PDF 分析結果");
assert(manifest.display === "standalone" && manifest.start_url === "./" && manifest.icons?.length, "PWA manifest 不完整");
assert(/serviceWorker\.register/.test(pwa) && /addAll\(SHELL\)/.test(serviceWorker), "PWA 離線殼層未完成");
assert(![html, css, js, analysis, app, index, manifestText, pwa, serviceWorker].some((value) => value.includes("�")), "檔案含 U+FFFD 亂碼");

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

const perPhase = Object.fromEntries(phaseIds.map((phase) => [phase, itemMatches.filter((match) => match[1] === phase).length]));
console.log(JSON.stringify({ passed: true, items: itemMatches.length, templates: templateMatches.length, attachments: "IndexedDB", draftFormats: ["Word", "Markdown", "Print/PDF"], pwa: true, perPhase }, null, 2));
