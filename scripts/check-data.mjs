import { readFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../docs/tenders.json", import.meta.url), "utf8"));
const errors = [];
if (!Array.isArray(payload.records) || !payload.records.length) errors.push("資料不得為空");
if (payload.meta.recordCount !== payload.records.length) errors.push("筆數摘要不一致");
const ids = new Set();
for (const [index, row] of payload.records.entries()) {
  for (const key of ["id", "title", "agency", "caseNo", "category", "region", "announcementType", "announcementDate", "officialUrl"]) if (!row[key]) errors.push(`第 ${index + 1} 筆缺少 ${key}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.announcementDate)) errors.push(`日期格式錯誤：${row.announcementDate}`);
  if (!row.officialUrl.startsWith("https://web.pcc.gov.tw/")) errors.push(`非官方網址：${row.officialUrl}`);
  if (ids.has(row.id)) errors.push(`重複 id：${row.id}`);
  ids.add(row.id);
}
if (errors.length) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}
console.log(`資料檢查通過：${payload.records.length} 則公告，近 ${payload.meta.historyDays} 天`);
