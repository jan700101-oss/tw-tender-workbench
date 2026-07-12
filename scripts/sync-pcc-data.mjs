import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const cacheDir = join(root, ".cache", "pcc");
const listUrl = process.env.PCC_LIST_URL || "https://web.pcc.gov.tw/tps/tp/OpenData/showList";
const downloadUrl = process.env.PCC_DOWNLOAD_URL || "https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=";
const historyMonths = Number(process.env.PCC_HISTORY_MONTHS || 36);

await mkdir(docsDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const decodeXml = (value = "") => value
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
  .replaceAll("&amp;", "&").trim();

function field(block, name) {
  return decodeXml(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || "");
}

function periodFromFile(fileName) {
  const [, year, month, half] = fileName.match(/tender_(\d{4})(\d{2})(\d{2})\.xml/) || [];
  if (!year) return null;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    key: `${year}-${month}-${half}`,
    label: `${year}/${month}/${half === "01" ? "01–15" : `16–${lastDay}`}`,
    sort: `${year}${month}${half}`,
  };
}

const regions = [
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
  return regions.find(([, aliases]) => aliases.some((alias) => text.includes(alias)))?.[0] || "地區未明";
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "tw-tender-search/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

const listHtml = await fetchText(listUrl);
const allFiles = [...new Set([...listHtml.matchAll(/tender_\d{8}\.xml/g)].map((match) => match[0]))]
  .sort((a, b) => b.localeCompare(a));
const selectedFiles = allFiles.slice(0, Math.max(2, historyMonths * 2));
if (!selectedFiles.length) throw new Error("官方頁面沒有找到招標 XML 檔案");

const records = [];
for (const [fileIndex, fileName] of selectedFiles.entries()) {
  const cachePath = join(cacheDir, fileName);
  let xml;
  try {
    xml = await readFile(cachePath, "utf8");
  } catch {
    xml = await fetchText(downloadUrl + fileName);
    await writeFile(cachePath, xml, "utf8");
  }
  const period = periodFromFile(fileName);
  for (const match of xml.matchAll(/<TENDER>([\s\S]*?)<\/TENDER>/g)) {
    const block = match[1];
    const deadline = field(block, "TENDER_SPDT").replaceAll("/", "-");
    const agency = field(block, "TENDER_ORG_NAME");
    const caseNo = field(block, "TENDER_CASE_NO");
    const title = field(block, "TENDER_NAME");
    const method = field(block, "PROCUREMENT_TYPE");
    const category = field(block, "PROCUREMENT_ATTR");
    if (!agency || !caseNo || !title || !period) continue;
    records.push({
      id: `${period.key}:${agency}:${caseNo}:${title}`,
      title, agency, caseNo, method, category, region: inferRegion(agency, title),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : "",
      sourcePeriod: period.label,
      sourceFile: fileName,
      officialUrl: `https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic?firstSearch=true&searchType=basic&tenderType=TENDER_DECLARATION&tenderWay=TENDER_WAY_ALL_DECLARATION&dateType=isDate&tenderId=${encodeURIComponent(caseNo)}`,
    });
  }
  process.stdout.write(`\r已處理 ${fileIndex + 1}/${selectedFiles.length} 個官方檔案`);
}

const unique = [...new Map(records.map((record) => [`${record.agency}\u0000${record.caseNo}\u0000${record.title}`, record])).values()]
  .sort((a, b) => (b.sourcePeriod.localeCompare(a.sourcePeriod) || b.deadline.localeCompare(a.deadline)));
if (!unique.length) throw new Error("同步結果為空，保留舊資料");

const latestPeriod = periodFromFile(selectedFiles[0]);
const payload = {
  meta: {
    syncedAt: new Date().toISOString(),
    officialLatestPeriod: latestPeriod.label,
    historyMonths,
    source: listUrl,
    fileCount: selectedFiles.length,
    recordCount: unique.length,
    fieldNotes: { deadline: "官方 XML TENDER_SPDT（截止投標日）", sourcePeriod: "該筆資料所屬官方半月檔案期間，並非精確公告日" },
  },
  records: unique,
};
const target = join(docsDir, "tenders.json");
const temporary = `${target}.tmp`;
await writeFile(temporary, JSON.stringify(payload), "utf8");
JSON.parse(await readFile(temporary, "utf8"));
await rename(temporary, target);
console.log(`\n同步完成：${unique.length} 筆，官方最新期間 ${latestPeriod.label}`);
