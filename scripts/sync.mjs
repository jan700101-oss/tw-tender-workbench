#!/usr/bin/env node
/**
 * 標案工務台 — 政府電子採購網半月檔同步
 *
 * 資料來源:政府電子採購網「資料集下載」頁公開 XML
 *   https://web.pcc.gov.tw/tps/tp/OpenData/showList
 *
 * 欄位語意(經真實資料驗證):
 *   - 官方檔名 tender_YYYYMM01.xml = 該月 1–15 日公告清單(半月檔),
 *     tender_YYYYMM02.xml = 16 日–月底。XML 內沒有精確公告日。
 *   - TENDER_SPDT 是「截止投標日期」,不是公告日期。
 *   - 此公開資料集為官方提供之部分標案(每半月約 100–340 筆),並非全部標案。
 *   - 地區為依機關名稱與案名文字「推定」,官方 XML 無地區欄位。
 *
 * 產出(docs/data/):
 *   - index.json                同步狀態、月份清單、篩選選項
 *   - tenders-YYYY-MM.json      依公告期間月份分片(緊湊陣列格式)
 *
 * 失敗策略:下載或解析失敗時保留既有資料,index.json 記錄失敗狀態,
 * 程式以非零碼結束讓排程顯示紅色,但不覆蓋上一版資料。
 *
 * 用法:
 *   node scripts/sync.mjs                 # 正式同步
 *   node scripts/sync.mjs --from-dir DIR  # 離線測試:讀取 DIR 內的 *.xml
 *   node scripts/sync.mjs --discover      # 額外輸出欄位樣本與資料集描述
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = join(ROOT, "docs", "data");
const INDEX_PATH = join(DATA_DIR, "index.json");

const LIST_URL = "https://web.pcc.gov.tw/tps/tp/OpenData/showList";
const DOWNLOAD_BASE = "https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=";
const USER_AGENT = "tw-tender-workbench/1.0";

const FETCH_TIMEOUT_MS = 60_000;
const MAX_FILES_PER_RUN = 90;      // 官方目前提供 36 個月 × 2 檔;一次可全量補齊
const REFRESH_RECENT_DAYS = 60;    // 期間結束日在此天數內的檔案每次都重抓(官方半月檔約有 6 週發布延遲,且可能增補)

// 每日完整公告來源:g0v/OpenFun 標案 API(第三方,失敗時不影響官方來源同步)
const DAILY_API_BASE = "https://pcc-api.openfun.app/api";
const DAILY_DAYS = 35;             // 回補天數
const DAILY_REFRESH_DAYS = 3;      // 最近幾天每次重抓(API 約 1 天延遲,且可能補資料)
const DAILY_REQUEST_GAP_MS = 1200; // 禮貌間隔,避免打爆免費服務

const args = process.argv.slice(2);
const fromDir = args.includes("--from-dir") ? args[args.indexOf("--from-dir") + 1] : null;
const dailyFromDir = args.includes("--daily-from-dir") ? args[args.indexOf("--daily-from-dir") + 1] : null;
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

/** 找出重複出現且內含子元素的「記錄元素」,回傳每筆記錄的欄位物件。 */
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

// ---------- 日期與期間 ----------

function isValidIsoDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** tender_YYYYMM01.xml → 1–15 日;tender_YYYYMM02.xml → 16–月底。 */
function periodFromFileName(fileName) {
  const m = /_(\d{4})(\d{2})(0[12])\.xml$/.exec(fileName);
  if (!m) return null;
  const [, y, mo, half] = m;
  const lastDay = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
  const start = half === "01" ? `${y}-${mo}-01` : `${y}-${mo}-16`;
  const end = half === "01" ? `${y}-${mo}-15` : `${y}-${mo}-${lastDay}`;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  return { start, end, month: `${y}-${mo}` };
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
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 台北時間
}

// ---------- 地區推定(官方 XML 無地區欄位,依機關名稱與案名文字比對) ----------

const REGIONS = [
  ["基隆市", ["基隆市", "基隆"]], ["臺北市", ["臺北市", "台北市", "臺北", "台北"]],
  ["新北市", ["新北市", "新北"]], ["桃園市", ["桃園市", "桃園"]],
  ["新竹市", ["新竹市"]], ["新竹縣", ["新竹縣"]], ["苗栗縣", ["苗栗縣", "苗栗"]],
  ["臺中市", ["臺中市", "台中市", "臺中", "台中"]], ["彰化縣", ["彰化縣", "彰化"]],
  ["南投縣", ["南投縣", "南投"]], ["雲林縣", ["雲林縣", "雲林"]],
  ["嘉義市", ["嘉義市"]], ["嘉義縣", ["嘉義縣"]],
  ["臺南市", ["臺南市", "台南市", "臺南", "台南"]], ["高雄市", ["高雄市", "高雄"]],
  ["屏東縣", ["屏東縣", "屏東"]], ["宜蘭縣", ["宜蘭縣", "宜蘭"]],
  ["花蓮縣", ["花蓮縣", "花蓮"]], ["臺東縣", ["臺東縣", "台東縣", "臺東", "台東"]],
  ["澎湖縣", ["澎湖縣", "澎湖"]], ["金門縣", ["金門縣", "金門"]], ["連江縣", ["連江縣", "連江"]],
];

function inferRegion(agency, title) {
  const text = `${agency} ${title}`;
  for (const [name, aliases] of REGIONS) {
    if (aliases.some((a) => text.includes(a))) return name;
  }
  return "地區未明";
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

async function fetchJsonWithRetry(url, tries = 3) {
  const text = await fetchWithRetry(url, tries);
  return JSON.parse(text);
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

function normalizeRecord(raw, period, sourceFile, kind) {
  const title = raw.TENDER_NAME || "";
  const agency = raw.TENDER_ORG_NAME || "";
  const caseNo = raw.TENDER_CASE_NO || "";
  const method = raw.PROCUREMENT_TYPE || "";
  const attr = raw.PROCUREMENT_ATTR || "";
  const deadline = normalizeDate(raw.TENDER_SPDT || "");
  if (!title || !agency || !caseNo) return null; // 必要欄位缺漏,不收
  return {
    kind,                       // tender=招標
    periodStart: period.start,  // 公告期間(半月檔)
    periodEnd: period.end,
    deadline,                   // 截止投標日期(TENDER_SPDT),可能為 null
    agency,
    caseNo,
    title,
    method,
    attr,
    region: inferRegion(agency, title), // 推定,非官方欄位
    sourceFile,
  };
}

/** 同一案(機關+案號+案名)出現在多個半月檔時,保留最新期間的版本。 */
function dedupKey(r) {
  return [r.kind, r.agency, r.caseNo, r.title].join("|");
}

/** 來源優先序:官方半月檔(2)勝過每日 API(1);同來源取較新期間。 */
function srcRank(r) {
  return r.sourceFile.startsWith("api:") ? 1 : 2;
}

function shouldReplace(prev, next) {
  if (!prev) return true;
  const pr = srcRank(prev), nr = srcRank(next);
  if (nr !== pr) return nr > pr;
  return next.periodStart >= prev.periodStart;
}

/**
 * 每日 API(listbydate)記錄 → 正規化。
 * 只收招標類公告;決標/無法決標留待後續階段。
 * 每日記錄的 periodStart=periodEnd=精確公告日;deadline 由前端詳情視窗即時取得。
 */
function normalizeDailyRecord(row) {
  const type = row?.brief?.type || "";
  if (!type.includes("招標") && !type.includes("公開取得")) return null;
  if (/無法決標|決標公告|撤銷/.test(type)) return null;
  const title = row?.brief?.title || "";
  const agency = row?.unit_name || "";
  const caseNo = row?.job_number || "";
  if (!title || !agency || !caseNo) return null;
  const dateIso = normalizeDate(String(row.date || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1/$2/$3"));
  if (!dateIso) return null;
  const category = row?.brief?.category || "";
  const attr = /^(工程類|財物類|勞務類)/.exec(category)?.[1] || "其他";
  const method = type.replace(/更正公告$/, "").replace(/公告$/, "") || type;
  return {
    kind: "tender",
    periodStart: dateIso,
    periodEnd: dateIso,
    deadline: null,
    agency,
    caseNo,
    title,
    method,
    attr,
    region: inferRegion(agency, title),
    sourceFile: `api:${dateIso.replace(/-/g, "")}`,
  };
}

const COLUMNS = ["kind", "periodStart", "periodEnd", "deadline", "agency", "caseNo", "title", "method", "attr", "region", "sourceFile"];
function toRow(r) { return COLUMNS.map((c) => r[c] ?? ""); }
function fromRow(row) {
  const r = {};
  COLUMNS.forEach((c, i) => { r[c] = row[i] === "" ? (c === "deadline" ? null : "") : row[i]; });
  return r;
}

// ---------- 既有資料載入/寫出 ----------

function loadIndex() {
  if (!existsSync(INDEX_PATH)) {
    return { version: 2, lastSuccess: null, lastAttempt: null, months: [], processedFiles: [], discoveredFiles: [], fieldNames: {}, filters: {} };
  }
  const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  if (idx.version !== 2) {
    return { version: 2, lastSuccess: null, lastAttempt: null, months: [], processedFiles: [], discoveredFiles: [], fieldNames: {}, filters: {} };
  }
  return idx;
}

function loadAllRecords(index) {
  const map = new Map();
  for (const { month } of index.months || []) {
    const p = join(DATA_DIR, `tenders-${month}.json`);
    if (!existsSync(p)) continue;
    const part = JSON.parse(readFileSync(p, "utf8"));
    for (const row of part.rows || []) {
      const r = fromRow(row);
      const key = dedupKey(r);
      if (shouldReplace(map.get(key), r)) map.set(key, r);
    }
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
  const attempt = { at: new Date().toISOString(), status: "failed", error: null, filesFetched: 0, recordsUpserted: 0, recordsSkipped: 0 };

  try {
    // 1. 取得可下載檔案清單
    let fileNames = [];
    let listHtml = "";
    if (fromDir) {
      fileNames = readdirSync(fromDir).filter((f) => f.endsWith(".xml")).sort();
      log(`離線模式:讀取 ${fromDir} 內 ${fileNames.length} 個 XML`);
    } else {
      listHtml = await fetchWithRetry(LIST_URL);
      const found = listHtml.match(/[A-Za-z]+_\d{8}\.xml/g) || [];
      fileNames = [...new Set(found)].sort();
      log(`資料集下載頁列出 ${fileNames.length} 個檔案`);
    }
    if (fileNames.length === 0) throw new Error("政府資料集下載頁沒有列出任何 XML 檔案");
    index.discoveredFiles = fileNames;

    if (discover && listHtml) {
      // 輸出第一個 XML 連結附近的頁面文字,協助確認官方資料集名稱與涵蓋範圍
      const pos = listHtml.search(/tender_\d{8}\.xml/);
      if (pos > 0) {
        const ctx = listHtml.slice(Math.max(0, pos - 1200), pos + 200)
          .replace(/<script[\s\S]*?<\/script>/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ").trim();
        log(`資料集頁面描述(截錄):${ctx.slice(-500)}`);
      }
    }

    // 2. 挑選要處理的招標半月檔
    const tenderFiles = fileNames.filter((f) => /^tender_\d{6}0[12]\.xml$/.test(f) && periodFromFileName(f));
    const processed = new Set(index.processedFiles);
    const refreshCutoff = new Date(Date.now() - REFRESH_RECENT_DAYS * 86400000).toISOString().slice(0, 10);
    const wanted = tenderFiles.filter((f) => {
      const p = periodFromFileName(f);
      if (!processed.has(f)) return true;
      return p.end >= refreshCutoff; // 近期半月檔會持續增筆,每次重抓
    }).slice(-MAX_FILES_PER_RUN);
    log(`招標半月檔 ${tenderFiles.length} 個,本次處理 ${wanted.length} 個(未處理或近 ${REFRESH_RECENT_DAYS} 天內)`);

    // 3. 下載並解析,合併進全量資料(同案保留最新期間版本)
    const all = loadAllRecords(index);
    const beforeCount = all.size;
    const fieldNames = new Set(index.fieldNames?.tender || []);
    for (const fileName of wanted) {
      const period = periodFromFileName(fileName);
      const xml = fromDir
        ? readFileSync(join(fromDir, fileName), "utf8")
        : await fetchWithRetry(DOWNLOAD_BASE + encodeURIComponent(fileName));
      const { recordTag, records } = parseFlatXml(xml);
      if (records.length === 0) {
        log(`警告:${fileName} 解析不到任何記錄(記錄元素:${recordTag}),略過且不標記已處理`);
        continue;
      }
      let upserted = 0;
      for (const raw of records) {
        for (const k of Object.keys(raw)) fieldNames.add(k);
        const rec = normalizeRecord(raw, period, fileName, "tender");
        if (!rec) { attempt.recordsSkipped += 1; continue; }
        const key = dedupKey(rec);
        if (shouldReplace(all.get(key), rec)) {
          all.set(key, rec);
          upserted += 1;
        }
      }
      if (discover) log(`欄位樣本 ${fileName} <${recordTag}> ${JSON.stringify(records[0])}`);
      processed.add(fileName);
      attempt.filesFetched += 1;
      attempt.recordsUpserted += upserted;
      log(`${fileName}:${records.length} 筆(期間 ${period.start}~${period.end})`);
    }

    if (discover && !fromDir) {
      // 其他檔案類型各抓一個樣本,只印欄位供評估,不寫入資料
      const otherTypes = new Map();
      for (const f of fileNames) {
        if (/^tender_/.test(f)) continue;
        const prefix = f.replace(/_\d{8}\.xml$/, "");
        if (!otherTypes.has(prefix)) otherTypes.set(prefix, f);
      }
      for (const [prefix, f] of otherTypes) {
        try {
          const xml = await fetchWithRetry(DOWNLOAD_BASE + encodeURIComponent(f));
          const { recordTag, records } = parseFlatXml(xml);
          log(`探索 ${prefix}(${f})記錄元素 <${recordTag}> 共 ${records.length} 筆`);
          if (records[0]) log(`欄位樣本 ${f} ${JSON.stringify(records[0])}`);
        } catch (err) {
          log(`探索 ${f} 失敗:${err.message}`);
        }
      }
    }

    // 3b. 每日完整公告(g0v/OpenFun 標案 API)——失敗只降級,不影響官方來源
    attempt.daily = { status: "skipped", dates: 0, records: 0, error: null };
    const processedDates = new Set(index.processedDates || []);
    try {
      let wantedDates = [];
      let latestIso = null;
      if (dailyFromDir) {
        wantedDates = readdirSync(dailyFromDir)
          .map((f) => /^listbydate_(\d{8})\.json$/.exec(f)?.[1])
          .filter(Boolean).sort();
        log(`離線模式:每日 API 讀取 ${dailyFromDir} 內 ${wantedDates.length} 天`);
      } else if (!fromDir) {
        const info = await fetchJsonWithRetry(`${DAILY_API_BASE}/getinfo`);
        latestIso = String(info["最新資料時間"] || "").slice(0, 10);
        if (!isValidIsoDate(latestIso)) throw new Error(`每日 API 未回報有效最新日期:${JSON.stringify(info).slice(0, 120)}`);
        const refreshFrom = new Date(`${latestIso}T00:00:00Z`);
        refreshFrom.setUTCDate(refreshFrom.getUTCDate() - DAILY_REFRESH_DAYS + 1);
        const refreshFromYmd = refreshFrom.toISOString().slice(0, 10).replace(/-/g, "");
        for (let i = 0; i < DAILY_DAYS; i++) {
          const d = new Date(`${latestIso}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - i);
          const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
          if (!processedDates.has(ymd) || ymd >= refreshFromYmd) wantedDates.push(ymd);
        }
        wantedDates.sort();
        log(`每日 API 最新資料日 ${latestIso},本次同步 ${wantedDates.length} 天`);
      }
      for (const ymd of wantedDates) {
        const payload = dailyFromDir
          ? JSON.parse(readFileSync(join(dailyFromDir, `listbydate_${ymd}.json`), "utf8"))
          : await fetchJsonWithRetry(`${DAILY_API_BASE}/listbydate?date=${ymd}`);
        const rows = payload.records || [];
        let kept = 0;
        for (const row of rows) {
          const rec = normalizeDailyRecord(row);
          if (!rec) continue;
          const key = dedupKey(rec);
          if (shouldReplace(all.get(key), rec)) {
            all.set(key, rec);
            kept += 1;
          }
        }
        processedDates.add(ymd);
        attempt.daily.dates += 1;
        attempt.daily.records += kept;
        log(`每日 ${ymd}:${rows.length} 筆公告,收錄招標類 ${kept} 筆`);
        if (!dailyFromDir) await new Promise((r) => setTimeout(r, DAILY_REQUEST_GAP_MS));
      }
      if (attempt.daily.dates > 0 || wantedDates.length === 0) attempt.daily.status = "success";
      index.processedDates = [...processedDates].sort().slice(-120);
    } catch (err) {
      attempt.daily.status = "failed";
      attempt.daily.error = err.message;
      log(`每日 API 同步失敗(不影響官方來源):${err.message}`);
    }

    if (all.size === 0) throw new Error("同步後資料為空,拒絕寫入(保留上一版)");

    // 4. 依期間月份分片寫出
    const byMonth = new Map();
    const attrs = new Set(), methods = new Set(), regionSet = new Set();
    for (const r of all.values()) {
      const month = r.periodStart.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(r);
      if (r.attr) attrs.add(r.attr);
      if (r.method) methods.add(r.method);
      if (r.region) regionSet.add(r.region);
    }
    const monthsMeta = [];
    for (const month of [...byMonth.keys()].sort()) {
      const rows = byMonth.get(month);
      rows.sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : (a.deadline || "") < (b.deadline || "") ? -1 : 1));
      writeJsonAtomic(join(DATA_DIR, `tenders-${month}.json`), { month, columns: COLUMNS, rows: rows.map(toRow) });
      monthsMeta.push({ month, count: rows.length });
    }
    // 移除已不存在月份的舊分片
    for (const { month } of index.months || []) {
      if (!byMonth.has(month)) {
        const p = join(DATA_DIR, `tenders-${month}.json`);
        if (existsSync(p)) unlinkSync(p);
      }
    }

    // 5. 寫出索引
    attempt.status = "success";
    index.lastAttempt = attempt;
    index.lastSuccess = { at: attempt.at, totalRecords: all.size, months: monthsMeta.length };
    index.months = monthsMeta;
    index.processedFiles = [...processed].filter((f) => tenderFiles.includes(f)).sort();
    index.fieldNames = { tender: [...fieldNames].sort() };
    index.filters = { attrs: [...attrs].sort(), methods: [...methods].sort(), regions: [...regionSet].sort() };
    index.source = LIST_URL;
    index.notes = {
      period: "公告期間取自官方半月檔檔名(01=1–15日,02=16–月底);每日 API 記錄為精確公告日(periodStart=periodEnd)",
      deadline: "官方 TENDER_SPDT(截止投標日);每日 API 記錄不含截止日,可由詳情視窗即時查看",
      region: "依機關名稱與案名文字推定,官方 XML 無地區欄位",
      coverage: "官方半月檔為部分標案;近 35 天招標公告另由 g0v/OpenFun 標案 API 補齊每日完整清單",
      dedup: "同一案(機關+案號+案名)出現在多來源時,官方半月檔優先於每日 API;同來源取較新",
      dailySource: DAILY_API_BASE,
    };
    writeJsonAtomic(INDEX_PATH, index);
    log(`同步成功:共 ${all.size} 筆(原 ${beforeCount} 筆),涵蓋 ${monthsMeta.length} 個月份`);
  } catch (err) {
    attempt.error = err.message;
    index.lastAttempt = attempt;
    writeJsonAtomic(INDEX_PATH, index); // 只更新狀態,不動既有資料
    log(`同步失敗:${err.message}(既有資料未變動)`);
    process.exitCode = 1;
  }
}

await main();
