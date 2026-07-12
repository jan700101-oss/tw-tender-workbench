import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const apiBase = process.env.PCC_API_BASE || "https://pcc-api.openfun.app/api";
const historyDays = Number(process.env.PCC_HISTORY_DAYS || 30);
await mkdir(docsDir, { recursive: true });

const regions = [
  ["基隆市", ["基隆市", "基隆"]], ["臺北市", ["臺北市", "台北市", "臺北", "台北"]], ["新北市", ["新北市", "新北"]],
  ["桃園市", ["桃園市", "桃園"]], ["新竹市", ["新竹市"]], ["新竹縣", ["新竹縣"]], ["苗栗縣", ["苗栗縣", "苗栗"]],
  ["臺中市", ["臺中市", "台中市", "臺中", "台中"]], ["彰化縣", ["彰化縣", "彰化"]], ["南投縣", ["南投縣", "南投"]],
  ["雲林縣", ["雲林縣", "雲林"]], ["嘉義市", ["嘉義市"]], ["嘉義縣", ["嘉義縣"]], ["臺南市", ["臺南市", "台南市", "臺南", "台南"]],
  ["高雄市", ["高雄市", "高雄"]], ["屏東縣", ["屏東縣", "屏東"]], ["宜蘭縣", ["宜蘭縣", "宜蘭"]], ["花蓮縣", ["花蓮縣", "花蓮"]],
  ["臺東縣", ["臺東縣", "台東縣", "臺東", "台東"]], ["澎湖縣", ["澎湖縣", "澎湖"]], ["金門縣", ["金門縣", "金門"]], ["連江縣", ["連江縣", "連江"]],
];
const inferRegion = (text) => regions.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || "地區未明";
const ymd = (date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
const displayDate = (value) => `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}`;

async function getJson(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { "user-agent": "tw-tender-search/2.0" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const jsonText = text.trim().startsWith("{") ? text.trim() : text.match(/(\{[\s\S]*\})\s*$/)?.[1];
    if (!jsonText) throw new Error(`回傳非 JSON：${text.slice(0, 80).replace(/\s+/g, " ")}`);
    return JSON.parse(jsonText);
  } catch (error) {
    if (attempt < 4) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 5000));
      return getJson(url, attempt + 1);
    }
    throw new Error(`${url} 同步失敗：${error.message}`);
  }
}

const info = await getJson(`${apiBase}/getinfo`);
const latestDateText = String(info["最新資料時間"] || "").slice(0, 10);
const latestDate = new Date(`${latestDateText}T00:00:00Z`);
if (Number.isNaN(latestDate.valueOf())) throw new Error("API 未提供有效的最新資料日期");
const dates = Array.from({ length: historyDays }, (_, index) => {
  const date = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate() - index));
  return ymd(date);
});

const batches = [];
for (let index = 0; index < dates.length; index += 1) {
  batches.push(await getJson(`${apiBase}/listbydate?date=${dates[index]}`));
  process.stdout.write(`\r已同步 ${index + 1}/${dates.length} 天`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
}

const records = batches.flatMap((payload) => payload.records || []).map((row) => {
  const title = row.brief?.title || "（未提供標案名稱）";
  const agency = row.unit_name || `機關代碼 ${row.unit_id || "未提供"}`;
  const categoryText = row.brief?.category || "未分類";
  const category = categoryText.match(/^(工程類|財物類|勞務類)/)?.[1] || "其他";
  const announcementDate = displayDate(row.date);
  const caseNo = row.job_number || "未提供";
  return {
    id: row.filename || `${row.date}:${row.unit_id}:${caseNo}:${title}`,
    unitId: row.unit_id || "", sourceFilename: row.filename || "",
    title, agency, caseNo, category, categoryDetail: categoryText,
    announcementType: row.brief?.type || "其他公告",
    announcementDate,
    region: inferRegion(`${agency} ${title}`),
    officialUrl: `https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic?firstSearch=true&searchType=basic&tenderType=TENDER_DECLARATION&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isDate&tenderId=${encodeURIComponent(caseNo)}`,
    apiSourceUrl: `https://pcc-api.openfun.app${row.url || ""}`,
  };
});
const unique = [...new Map(records.map((record) => [record.id, record])).values()]
  .sort((a, b) => b.announcementDate.localeCompare(a.announcementDate));
if (!unique.length) throw new Error("同步結果為空，保留舊資料");

const payload = {
  meta: {
    syncedAt: new Date().toISOString(), latestAnnouncementDate: displayDate(dates[0]), historyDays,
    recordCount: unique.length, source: `${apiBase}/`, sourceTotalRecords: info["公告數"],
    sourceOldestDate: info["最舊資料時間"], sourceLatestDate: info["最新資料時間"],
    note: "逐日收錄政府電子採購網公告；資料 API 由 openfunltd 維護。",
  },
  records: unique,
};
const target = join(docsDir, "tenders.json");
const temporary = `${target}.tmp`;
await writeFile(temporary, JSON.stringify(payload), "utf8");
JSON.parse(await readFile(temporary, "utf8"));
await rename(temporary, target);
console.log(`\n同步完成：近 ${historyDays} 天共 ${unique.length} 則公告，最新 ${payload.meta.latestAnnouncementDate}`);
