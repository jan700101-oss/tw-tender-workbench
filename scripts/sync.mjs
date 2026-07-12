#!/usr/bin/env node
/**
 * 標案工務台 — 政府電子採購網每日同步
 *
 * 資料來源:政府電子採購網「資料集下載」頁公開 XML
 *   https://web.pcc.gov.tw/tps/tp/OpenData/showList
 *
 * 欄位語意(重要):
 *   - TENDER_SPDT 是「截止投標日期」,不是公告日期。
 *   - 公告日期取自官方檔名(tender_YYYYMMDD.xml = 該日公告清單)。
 *
 * 產出(docs/data/):
 *   - index.json                同步狀態、月份清單、篩選選項、已處理檔案
 *   - tenders-YYYY-MM.json      該公告月份的標案(緊湊陣列格式)
 *
 * 失敗策略:下載或解析失敗時保留既有資料,index.json 記錄失敗狀態,
 * 程式以非零碼結束讓排程顯示紅色,但不覆蓋上一版資料。
 *
 * 用法:
 *   node scripts/sync.mjs                 # 正式同步
 *   node scripts/sync.mjs --from-dir DIR  # 離線測試:讀取 DIR 內的 *.xml
 *   node scripts/sync.mjs --discover      # 額外輸出每種檔案的原始欄位樣本
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = join(ROOT, "docs", "data");
const INDEX_PATH = join(DATA_DIR, "index.json");

const LIST_URL = "https://web.pcc.gov.tw/tps/tp/OpenData/showList";
const DOWNLOAD_BASE = "https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) tw-tender-workbench";

const WINDOW_DAYS = 92;           // 保留最近三個月公告
const FETCH_TIMEOUT_MS = 60_000;
const MAX_NEW_FILES_PER_RUN = 40; // 單次最多補抓的歷史檔數,避免第一次執行爆量

const args = process.argv.slice(2);
const fromDir = args.includes("--from-dir") ? args[args.indexOf("--from-dir") + 1] : null;
const discover = args.includes("--discover");

function log(msg) {
  console.log(`[sync] ${msg}`);
}

// ---------- 小型 XML 解析(政府公開檔為扁平結構:根 > 記錄 > 純文字欄位) ----------

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 找出檔案中重複出現、且內含子元素的「記錄元素」,回傳每筆記錄的欄位物件。
 * 不假設記錄元素名稱(tender 檔為 TENDER,其他檔案類型名稱未知)。
 */
function parseFlatXml(xml) {
  const counts = new Map();
  const openTag = /<([A-Za-z_][\w.-]*)\s*>/g;
  let m;
  while ((m = openTag.exec(xml)) !== null) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let recordTag = null;
  let best = 1;
  for (const [tag, count] of counts) {
    if (count <= best) continue;
    // 記錄元素:其區塊內還有其他標籤(欄位)
    const probe = new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}>`).exec(xml);
    if (probe && /<[A-Za-z_]/.test(probe[1])) {
      recordTag = tag;
      best = count;
    }
  }
  if (!recordTag) return { recordTag: null, records: [] };

  const records = [];
  const blockRe = new RegExp(`<${recordTag}\\s*>([\\s\\S]*?)</${recordTag}>`, "g");
  const fieldRe = /<([A-Za-z_][\w.-]*)\s*>([\s\S]*?)<\/\1>/g;
  let b;
  while ((b = blockRe.exec(xml)) !== null) {
    const rec = {};
    let f;
    fieldRe.lastIndex = 0;
    while ((f = fieldRe.exec(b[1])) !== null) {
      rec[f[1]] = decodeEntities(f[2]).trim();
    }
    if (Object.keys(rec).length > 0) records.push(rec);
  }
  return { recordTag, records };
}

// ---------- 日期處理 ----------

function isoFromFileName(fileName) {
  const m = /_(\d{4})(\d{2})(\d{2})\.xml$/.exec(fileName);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidIsoDate(iso) ? iso : null;
}

function isValidIsoDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** 接受 yyyy/MM/dd 或 yyyy-MM-dd;民國年(<1911)自動加 1911。無法解析回傳 null。 */
function normalizeDate(raw) {
  if (!raw) return null;
  const m = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})/.exec(raw.trim());
  if (!m) return null;
  let year = parseInt(m[1], 10);
  if (year < 1911) year += 1911;
  const iso = `${String(year).padStart(4, "0")}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

function todayIso() {
  // 以台北時間為準
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- 下載 ----------

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-TW" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastErr = err;
      const wait = 2000 * 2 ** i;
      log(`下載失敗(第 ${i + 1} 次):${err.message},${wait}ms 後重試`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------- 記錄正規化 ----------

/** 從原始欄位物件挑出核心欄位;未知欄位不進前台,但欄位名稱會記錄於 index.json。 */
function normalizeRecord(raw, announceDate, sourceFile, kind) {
  const title = raw.TENDER_NAME || raw.AWARD_NAME || raw.NAME || "";
  const agency = raw.TENDER_ORG_NAME || raw.ORG_NAME || raw.AGENCY || "";
  const caseNo = raw.TENDER_CASE_NO || raw.CASE_NO || "";
  const method = raw.PROCUREMENT_TYPE || raw.TENDER_WAY || "";
  const attr = raw.PROCUREMENT_ATTR || raw.ATTR || "";
  const deadline = normalizeDate(raw.TENDER_SPDT || raw.SPDT || "");
  let url = "";
  for (const v of Object.values(raw)) {
    if (typeof v === "string" && /^https?:\/\//.test(v)) { url = v; break; }
  }
  if (!title || !agency) return null; // 必要欄位缺漏,不收
  return {
    kind,                 // tender=招標
    announceDate,         // 公告日期(來自官方檔名)
    deadline,             // 截止投標日期(TENDER_SPDT),可能為 null
    agency,
    caseNo,
    title,
    method,
    attr,
    sourceFile,
    url,
  };
}

function recordKey(r) {
  return [r.kind, r.announceDate, r.agency, r.caseNo, r.title].join("|");
}

// 緊湊格式:月份檔內用陣列省空間
const COLUMNS = ["kind", "announceDate", "deadline", "agency", "caseNo", "title", "method", "attr", "sourceFile", "url"];
function toRow(r) { return COLUMNS.map((c) => r[c] ?? ""); }
function fromRow(row) {
  const r = {};
  COLUMNS.forEach((c, i) => { r[c] = row[i] === "" ? (c === "deadline" ? null : "") : row[i]; });
  return r;
}

// ---------- 既有資料載入/寫出 ----------

function loadIndex() {
  if (!existsSync(INDEX_PATH)) {
    return {
      version: 1,
      lastSuccess: null,
      lastAttempt: null,
      months: [],
      processedFiles: [],
      discoveredFiles: [],
      fieldNames: {},
      filters: { attrs: [], methods: [] },
    };
  }
  return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
}

function loadMonth(month) {
  const p = join(DATA_DIR, `tenders-${month}.json`);
  if (!existsSync(p)) return new Map();
  const rows = JSON.parse(readFileSync(p, "utf8")).rows || [];
  const map = new Map();
  for (const row of rows) {
    const r = fromRow(row);
    map.set(recordKey(r), r);
  }
  return map;
}

function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, path);
}

// ---------- 主流程 ----------

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const index = loadIndex();
  const today = todayIso();
  const cutoff = addDays(today, -WINDOW_DAYS);
  const attempt = {
    at: new Date().toISOString(),
    status: "failed",
    error: null,
    filesFetched: 0,
    recordsAdded: 0,
    recordsSkipped: 0,
  };

  try {
    // 1. 取得可下載檔案清單
    let fileNames = [];
    if (fromDir) {
      fileNames = readdirSync(fromDir).filter((f) => f.endsWith(".xml")).sort();
      log(`離線模式:讀取 ${fromDir} 內 ${fileNames.length} 個 XML`);
    } else {
      const html = await fetchWithRetry(LIST_URL);
      const found = html.match(/[A-Za-z]+_\d{8}\.xml/g) || [];
      fileNames = [...new Set(found)].sort();
      log(`資料集下載頁列出 ${fileNames.length} 個檔案`);
    }
    if (fileNames.length === 0) throw new Error("政府資料集下載頁沒有列出任何 XML 檔案");

    index.discoveredFiles = fileNames;

    // 2. 只處理招標檔;其他類型先記錄名稱,確認欄位後再擴充
    const tenderFiles = fileNames.filter((f) => /^tender_\d{8}\.xml$/.test(f));
    const processed = new Set(index.processedFiles);
    const wanted = tenderFiles
      .filter((f) => {
        const d = isoFromFileName(f);
        return d && d >= cutoff && d <= addDays(today, 1) && !processed.has(f);
      })
      .slice(-MAX_NEW_FILES_PER_RUN);
    log(`招標檔 ${tenderFiles.length} 個,其中 ${wanted.length} 個為未處理的新檔`);

    // 3. 下載並解析
    const byMonth = new Map(); // month -> Map(key -> record)
    const monthOf = (r) => r.announceDate.slice(0, 7);
    const ensureMonth = (month) => {
      if (!byMonth.has(month)) byMonth.set(month, loadMonth(month));
      return byMonth.get(month);
    };

    const fieldNames = new Set(index.fieldNames?.tender || []);
    for (const fileName of wanted) {
      const announceDate = isoFromFileName(fileName);
      const xml = fromDir
        ? readFileSync(join(fromDir, fileName), "utf8")
        : await fetchWithRetry(DOWNLOAD_BASE + encodeURIComponent(fileName));
      const { recordTag, records } = parseFlatXml(xml);
      if (records.length === 0) {
        log(`警告:${fileName} 解析不到任何記錄(記錄元素:${recordTag}),略過且不標記已處理`);
        attempt.recordsSkipped += 1;
        continue;
      }
      let added = 0;
      for (const raw of records) {
        for (const k of Object.keys(raw)) fieldNames.add(k);
        const rec = normalizeRecord(raw, announceDate, fileName, "tender");
        if (!rec) { attempt.recordsSkipped += 1; continue; }
        const bucket = ensureMonth(monthOf(rec));
        const key = recordKey(rec);
        if (!bucket.has(key)) added += 1;
        bucket.set(key, rec);
      }
      if (discover && records.length > 0) {
        log(`欄位樣本 ${fileName} <${recordTag}> ${JSON.stringify(records[0])}`);
      }
      processed.add(fileName);
      attempt.filesFetched += 1;
      attempt.recordsAdded += added;
      log(`${fileName}:${records.length} 筆,新增 ${added} 筆`);
    }

    if (discover) {
      // 其他檔案類型各抓一個樣本,只印欄位供開發判斷,不寫入資料
      const otherTypes = new Map();
      for (const f of fileNames) {
        if (/^tender_/.test(f)) continue;
        const prefix = f.replace(/_\d{8}\.xml$/, "");
        if (!otherTypes.has(prefix)) otherTypes.set(prefix, f);
      }
      for (const [prefix, f] of otherTypes) {
        try {
          const xml = fromDir ? readFileSync(join(fromDir, f), "utf8") : await fetchWithRetry(DOWNLOAD_BASE + encodeURIComponent(f));
          const { recordTag, records } = parseFlatXml(xml);
          log(`探索 ${prefix}(${f})記錄元素 <${recordTag}> 共 ${records.length} 筆`);
          if (records[0]) log(`欄位樣本 ${f} ${JSON.stringify(records[0])}`);
        } catch (err) {
          log(`探索 ${f} 失敗:${err.message}`);
        }
      }
    }

    // 4. 修剪超過保留期的舊資料 + 重算月份清單
    const allMonths = new Set(byMonth.keys());
    for (const m of index.months.map((x) => x.month)) allMonths.add(m);
    const monthsMeta = [];
    let total = 0;
    const attrs = new Set();
    const methods = new Set();
    for (const month of [...allMonths].sort()) {
      const bucket = byMonth.get(month) || loadMonth(month);
      const kept = [...bucket.values()].filter(
        (r) => r.announceDate >= cutoff || (r.deadline && r.deadline >= today)
      );
      if (kept.length === 0) continue;
      kept.sort((a, b) => (a.announceDate < b.announceDate ? 1 : -1));
      for (const r of kept) {
        if (r.attr) attrs.add(r.attr);
        if (r.method) methods.add(r.method);
      }
      writeJsonAtomic(join(DATA_DIR, `tenders-${month}.json`), {
        month,
        columns: COLUMNS,
        rows: kept.map(toRow),
      });
      monthsMeta.push({ month, count: kept.length });
      total += kept.length;
    }
    if (total === 0) throw new Error("同步後資料為空,拒絕寫入(保留上一版)");

    // 5. 寫出索引
    attempt.status = "success";
    index.lastAttempt = attempt;
    index.lastSuccess = { at: attempt.at, totalRecords: total, windowDays: WINDOW_DAYS, cutoff };
    index.months = monthsMeta;
    index.processedFiles = [...processed].filter((f) => {
      const d = isoFromFileName(f);
      return d && d >= addDays(cutoff, -31);
    }).sort();
    index.fieldNames = { tender: [...fieldNames].sort() };
    index.filters = { attrs: [...attrs].sort(), methods: [...methods].sort() };
    index.source = LIST_URL;
    index.note = "deadline 為官方 TENDER_SPDT(截止投標日);announceDate 取自官方檔名(該日公告清單)";
    writeJsonAtomic(INDEX_PATH, index);
    log(`同步成功:共 ${total} 筆,涵蓋 ${monthsMeta.length} 個月份`);
  } catch (err) {
    attempt.error = err.message;
    index.lastAttempt = attempt;
    // 只更新 lastAttempt,不動既有資料
    writeJsonAtomic(INDEX_PATH, index);
    log(`同步失敗:${err.message}(既有資料未變動)`);
    process.exitCode = 1;
  }
}

await main();
