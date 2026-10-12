#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const DATA=resolve(ROOT,"docs/data/open-tenders.json"), REPORT=resolve(ROOT,"docs/data/open-tenders-validation.json");
const payload=JSON.parse(readFileSync(DATA,"utf8")), records=payload.records||[];
const today=new Date(Date.now()+28800000).toISOString().slice(0,10), errors=[], keys=new Set();
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const generated = Date.parse(payload.generatedAt);
if (!/^20\d{2}-/.test(payload.generatedAt || "") || !Number.isFinite(generated) || generated > Date.now()+300000 || generated < Date.now()-86400000) errors.push("invalid or stale generatedAt");
if (!records.length) errors.push("no open tenders");
const latest = records.reduce((date,r) => r.periodStart > date ? r.periodStart : date, "");
if (!validDate(latest) || Math.abs(Date.parse(latest)-Date.parse(today)) > 7*86400000) errors.push("latest announcement outside seven-day window");
if (/\uFFFD|Ã.|Â[\u0080-\u00ff]|銝|嚙踝蕭/.test(JSON.stringify(payload))) errors.push("replacement character or suspected mojibake");
for(const [i,r] of records.entries()){
  for(const field of ["periodStart","deadline","agency","caseNo","title","method","attr","officialUrl","sourcePage"])
    if(!String(r[field]||"").trim())errors.push(`row ${i+1}: missing ${field}`);
  if(!validDate(r.deadline)||r.deadline<today)errors.push(`row ${i+1}: invalid/expired deadline ${r.deadline}`);
  if(!validDate(r.periodStart))errors.push(`row ${i+1}: invalid announcement date`);
  try { const url = new URL(r.officialUrl); if(url.origin !== "https://web.pcc.gov.tw" || url.pathname !== "/prkms/urlSelector/common/tpam" || !url.searchParams.get("pk")) throw new Error(); }
  catch { errors.push(`row ${i+1}: invalid official URL`); }
  const key=`${r.agency}|${r.caseNo}`;if(keys.has(key))errors.push(`row ${i+1}: duplicate ${key}`);keys.add(key);
}
if(records.length!==payload.count)errors.push(`count mismatch ${records.length}/${payload.count}`);
if(records.length<Math.floor((payload.officialResultCount||0)*.8))errors.push("parsed fewer than 80% of official rows");
async function fetchText(url,tries=4){let error;for(let i=0;i<tries;i++)try{
 const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36","Accept-Language":"zh-TW,zh;q=0.9"},signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw new Error(`HTTP ${res.status}`);return await res.text();
}catch(e){error=e;await new Promise(r=>setTimeout(r,1200*(i+1)));}throw error;}
const roc=iso=>{const[y,m,d]=iso.split("-");return`${Number(y)-1911}/${m}/${d}`;};
const indexes=new Set();for(let i=0;i<10&&i<records.length;i++)indexes.add(i);
for(let i=1;i<=24&&records.length;i++)indexes.add(Math.floor(i*(records.length-1)/25));
for(let i=Math.max(0,records.length-6);i<records.length;i++)indexes.add(i);
const samples=[...indexes].map(i=>records[i]), byPage=new Map();
for(const r of samples){if(!byPage.has(r.sourcePage))byPage.set(r.sourcePage,[]);byPage.get(r.sourcePage).push(r);}
let cursor=0;const pages=[...byPage.entries()],checked=[];
async function worker(){while(cursor<pages.length){const[page,items]=pages[cursor++];try{
 const url=new URL(payload.source);url.searchParams.set(payload.pageKey||"d-49738-p",String(page));const html=await fetchText(url);
 for(const r of items){const pk=new URL(r.officialUrl).searchParams.get("pk");const checks={caseNo:html.includes(r.caseNo),title:html.includes(r.title),deadline:html.includes(roc(r.deadline)),link:html.includes(pk)};
 checked.push({caseNumber:r.caseNo,sourcePage:page,...checks});if(Object.values(checks).some(v=>!v))errors.push(`official row mismatch ${r.caseNo}: ${JSON.stringify(checks)}`);}
}catch(e){errors.push(`official page unavailable ${page}: ${e.message}`);}}}
await Promise.all(Array.from({length:4},worker));
const passedRows=checked.filter(x=>x.caseNo&&x.title&&x.deadline&&x.link).length;
const report={version:2,passed:errors.length===0,validatedAt:new Date().toISOString(),today,source:payload.source,
 officialResultCount:payload.officialResultCount,recordCount:records.length,expiredCount:records.filter(r=>r.deadline<today).length,uniqueCount:keys.size,
 officialRowsRequested:samples.length,officialRowsPassed:passedRows,officialPagesChecked:pages.length,errors:errors.slice(0,100),samples:checked};
writeFileSync(`${REPORT}.tmp`,JSON.stringify(report));renameSync(`${REPORT}.tmp`,REPORT);
console.log(JSON.stringify({...report,samples:undefined},null,2));if(!report.passed)process.exit(1);
