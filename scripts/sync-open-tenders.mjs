#!/usr/bin/env node
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "docs/data/open-tenders.json");
const ORIGIN = "https://web.pcc.gov.tw";
const SEARCH = `${ORIGIN}/prkms/tender/common/basic/readTenderBasic`;
const regions=["臺北市","新北市","桃園市","臺中市","臺南市","高雄市","基隆市","新竹市","嘉義市","新竹縣","苗栗縣","彰化縣","南投縣","雲林縣","嘉義縣","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"];

const taipeiToday = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
const toRoc = (iso) => {
  const [y,m,d] = iso.split("-");
  return `${Number(y)-1911}/${m}/${d}`;
};
const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
};
const rocDate = (raw) => {
  const m = /(\d{3})\/(\d{1,2})\/(\d{1,2})/.exec(raw || "");
  return m ? `${Number(m[1])+1911}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}` : null;
};
const decode = (s) => s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
async function fetchHtml(url, tries=5) {
  let error;
  for (let i=0;i<tries;i++) try {
    const res = await fetch(url, { headers:{"User-Agent":"tw-tender-workbench/2.0","Accept-Language":"zh-TW"}, signal:AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch(e) { error=e; await new Promise(r=>setTimeout(r,2000*(i+1))); }
  throw error;
}
function parseTitle(cell) {
  const m = /pageCode2Img\(("(?:\\.|[^"\\])*")\)/.exec(cell);
  if (m) try { return JSON.parse(m[1]); } catch {}
  return text(cell).replace(/^\S+\s+\(更正公告\)\s*/,"").trim();
}
function parseRows(html) {
  const rows=[];
  for (const match of html.matchAll(/<tr class="tb_b[23]">([\s\S]*?)<\/tr>/g)) {
    const cells=[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
    if (cells.length < 10) continue;
    const caseNo=text(cells[2]).replace(/\s*\(更正公告\)[\s\S]*$/,"").split(" ")[0];
    const title=parseTitle(cells[2]);
    const announce=rocDate(text(cells[6]));
    const deadline=rocDate(text(cells[7]));
    const href=/href="([^"]*\/prkms\/urlSelector\/common\/tpam\?pk=[^"]+)"/.exec(cells[2])?.[1] || "";
    if (!caseNo || !title || !announce || !deadline || deadline < taipeiToday) continue;
    const agency=text(cells[1]);
    rows.push({ kind:"tender", periodStart:announce, periodEnd:announce, deadline, agency, caseNo, title,
      method:text(cells[4]), attr:text(cells[5]), region:regions.find(r=>`${agency} ${title}`.includes(r)) || "地區未明", sourceFile:"政府採購網等標期內查詢",
      officialUrl:href ? new URL(decode(href),ORIGIN).href : "", budget:text(cells[8]) });
  }
  return rows;
}

const params=new URLSearchParams({ firstSearch:"true", searchType:"basic", tenderType:"TENDER_DECLARATION",
  tenderWay:"TENDER_WAY_ALL_DECLARATION", dateType:"isSpdt", tenderStartDate:toRoc(addDays(taipeiToday,-60)), tenderEndDate:toRoc(taipeiToday), pageSize:"100" });
const firstUrl=`${SEARCH}?${params}`;
const first=await fetchHtml(firstUrl);
const total=Number(/共有<span class="red">\s*([\d,]+)\s*<\/span>筆資料/.exec(first)?.[1]?.replaceAll(",","") || 0);
const pageKey=/[?&](d-\d+-p)=2/.exec(first)?.[1];
const perPage=50;
const pages=Math.max(1,Math.ceil(total/perPage));
const records=parseRows(first);
console.log(`Official open-period result: ${total} records, ${pages} pages`);
for(let page=2;page<=pages;page++) {
  const p=new URLSearchParams(params); p.set(pageKey || "d-49738-p",String(page));
  const html=await fetchHtml(`${SEARCH}?${p}`);
  records.push(...parseRows(html));
  if(page%10===0 || page===pages) console.log(`Fetched page ${page}/${pages}`);
  await new Promise(r=>setTimeout(r,300));
}
const unique=[...new Map(records.map(r=>[`${r.agency}|${r.caseNo}`,r])).values()]
  .sort((a,b)=>a.deadline.localeCompare(b.deadline)||b.periodStart.localeCompare(a.periodStart));
const payload={version:2,generatedAt:new Date().toISOString(),officialResultCount:total,count:unique.length,records:unique,source:firstUrl};
mkdirSync(dirname(OUT),{recursive:true}); writeFileSync(`${OUT}.tmp`,JSON.stringify(payload)); renameSync(`${OUT}.tmp`,OUT);
console.log(`Saved ${unique.length} currently open tenders.`);
