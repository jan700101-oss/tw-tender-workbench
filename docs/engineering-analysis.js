import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const STORAGE_KEY = "twb.engineeringProjects.v1";
const ACTIVE_KEY = `${STORAGE_KEY}.active`;
const ANALYSIS_KEY = "twb.engineeringPdfAnalyses.v1";
const FILE_DB = "twb-engineering-files-v1";
const FILE_STORE = "attachments";
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ANALYZER_VERSION = 2;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

const phaseDefinitions = {
  before: {
    title: "施工前",
    target: "prepare",
    keywords: /開工前|施工前|送審|核准|核定|樣品|型錄|計畫書|丈量|放樣|保險|告示牌|施工圖|材料.*審查|承包商資格|承攬商資格|施工期限|契約工期|完成期限/,
    suggestions: ["核對契約、最新圖說與圖號索引", "現場丈量並確認既有設施與拆除範圍", "建立材料、樣品、施工圖與計畫書送審總表", "確認開工條件、工期、保險及工地告示牌"]
  },
  during: {
    title: "施工中",
    target: "build",
    keywords: /施工中|拆除|防水|試水|給水|排水|電氣|管線|查驗|隱蔽|試驗|照片|保護|安全|修補|清運|材料|磁磚|混凝土|鋼筋|門窗|設備/,
    suggestions: ["依圖說工序保存施工前、中、後照片", "隱蔽、覆蓋及防水工序前先完成自主檢查與查驗", "材料進場核對核定樣品、證明與使用位置", "施工疑義與變更先取得書面回覆，不以口頭指示代替"]
  },
  after: {
    title: "完工／竣工",
    target: "finish",
    keywords: /竣工|完工|驗收|保固|移交|清潔|試運轉|結算|竣工圖|缺失|改善|復原/,
    suggestions: ["依實際施作更新竣工圖與數量結算", "彙整材料證明、試驗、查驗與施工照片索引", "完成功能測試、清潔、復原與移交清冊", "建立驗收缺失改善及保固追蹤資料"]
  }
};

const dwgFormatNames = {
  AC1032: "AutoCAD 2018 格式系列",
  AC1027: "AutoCAD 2013 格式系列",
  AC1024: "AutoCAD 2010 格式系列",
  AC1021: "AutoCAD 2007 格式系列"
};
const dwgRoles = [
  {id:"demolition", pattern:/拆除|DEMO/i, title:"拆除圖", stages:["before","during"], note:"施工前核對拆除範圍、保留項目、斷水斷電與保護；施工中保存拆除前中後照片。"},
  {id:"plan", pattern:/PLAN|平面|配置/i, title:"平面／配置圖", stages:["before","during"], note:"施工前完成現場丈量、放樣與尺寸疑義確認；施工中依最新核定版施作。"},
  {id:"section", pattern:/SEC|剖面|立面/i, title:"剖面／介面圖", stages:["before","during"], note:"核對高程、收邊、管線與既有設施介面，隱蔽前辦理查驗。"},
  {id:"detail", pattern:/詳圖|DETAIL/i, title:"施工詳圖／材料做法", stages:["before","during","after"], note:"施工前辦理材料與工法送審，施工中依詳圖查驗，完工時納入竣工圖與材料證明。"},
  {id:"set", pattern:/出圖|全套|圖說/i, title:"完整出圖集", stages:["before","during","after"], note:"作為圖說總冊使用；開工前確認版本與圖號，變更後同步更新竣工版。"}
];

function activeProjectId() { return localStorage.getItem(ACTIVE_KEY) || ""; }
function projectName(id = activeProjectId()) {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")[id]?.name || "待命名工程"; }
  catch { return "待命名工程"; }
}
function loadAnalyses() {
  try { const data = JSON.parse(localStorage.getItem(ANALYSIS_KEY) || "{}"); return data && typeof data === "object" ? data : {}; }
  catch { return {}; }
}
function saveAnalysis(projectId, analysis) {
  const all = loadAnalyses();
  all[projectId] = analysis;
  localStorage.setItem(ANALYSIS_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent("engineering-analysis-saved", {detail:{projectId,analysis}}));
}
function removeAnalysis(projectId) {
  const all = loadAnalyses();
  delete all[projectId];
  localStorage.setItem(ANALYSIS_KEY, JSON.stringify(all));
}
function normalize(value) {
  return String(value || "")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([，。；：、])/g, "$1")
    .trim();
}
function uniqueByText(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = normalize(row.text).replace(/[\s，。；：、（）()]/g, "").slice(0, 100);
    if (key.length < 5 || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function textLines(items) {
  const groups = [];
  for (const item of items) {
    const text = normalize(item.str);
    if (!text) continue;
    const x = Number(item.transform?.[4] || 0), y = Number(item.transform?.[5] || 0);
    let group = groups.find(row => Math.abs(row.y - y) < 2.5);
    if (!group) { group = {y, parts:[]}; groups.push(group); }
    group.parts.push({x, text});
  }
  return groups.sort((a,b) => b.y - a.y).map(row => normalize(row.parts.sort((a,b)=>a.x-b.x).map(part=>part.text).join(" "))).filter(Boolean);
}
function recordsFromPages(pages) {
  const rows = [];
  for (const page of pages) {
    for (const line of page.lines) {
      const pieces = line.split(/(?<=[。；！？])|(?:\s{2,})/).map(normalize).filter(value => value.length >= 6);
      for (const text of pieces.length ? pieces : [line]) rows.push({page:page.page, text});
    }
  }
  return uniqueByText(rows);
}
function sourceMatch(records, pattern) { return records.find(row => pattern.test(row.text)); }
function cleanProjectTitle(value) {
  return normalize(value)
    .replace(/^(?:圖名|工程名稱|施工說明及位置圖|施工說明|位置圖)+[：:]?\s*/, "")
    .replace(/(?:圖名|圖號).*$/, "")
    .slice(0, 120);
}
function extractProjectTitle(records) {
  for (const row of records) {
    const labelled = row.text.match(/工程名稱[：:]?\s*(.{4,100}?(?:工程|整建|整修))/);
    if (labelled) return cleanProjectTitle(labelled[1]);
  }
  const candidates = records.filter(row => /(?:工程|整建|整修)/.test(row.text) && !/本工程|工程名稱|工程告示牌|工程期限|工程圖/.test(row.text));
  candidates.sort((a,b) => scoreTitle(b.text) - scoreTitle(a.text));
  return cleanProjectTitle(candidates[0]?.text || "");
}
function scoreTitle(text) {
  let score = 0;
  if (/國民小學|學校|機關|活動中心|辦公|廁所|建築/.test(text)) score += 8;
  if (/整建工程|整修工程|改善工程/.test(text)) score += 7;
  if (/縣|市|鄉|鎮|區/.test(text)) score += 3;
  score -= Math.max(0, text.length - 60) / 5;
  return score;
}
function extractDesigner(records, metadata) {
  const row = sourceMatch(records, /建築師事務所|聯合建築師|設計監造/);
  const text = normalize(row?.text || "");
  const chineseOffice = text.match(/[\u3400-\u9fff]{2,24}(?:聯合)?建築師事務所/);
  if (chineseOffice) {
    const office = chineseOffice[0], repeated = office.match(/^(.+?建築師事務所)\1$/);
    return repeated ? repeated[1] : office;
  }
  return normalize(metadata?.info?.Author || text).slice(0, 100);
}
function extractDuration(records, pages) {
  for (const page of pages) {
    const match = page.sequential?.match(/(?:契約工期|施工期限|完成期限)[，,:：\s]*?(\d{1,4})\s*(日曆天|工作天|天)/);
    if (match) return {value:`${match[1]} ${match[2]}`, page:page.page, text:`${match[0]}`};
  }
  for (const row of records) {
    const match = row.text.match(/(?:契約|施工|工程)?期限.{0,30}?(\d{1,4})\s*(日曆天|工作天|天)/) || row.text.match(/(\d{1,4})\s*(日曆天|工作天)/);
    if (match) return {value:`${match[1]} ${match[2]}`, page:row.page, text:row.text};
  }
  return null;
}
function extractDrawingIndex(records) {
  const found = [];
  for (const row of records) {
    for (const match of row.text.matchAll(/\b([A-Z]{1,2}\d?[-－]\d{1,2})\b\s*([^A-Z\d]{2,35})?/g)) {
      const code = match[1].replace("－", "-");
      const title = normalize(match[2] || "").replace(/[，。；].*$/, "").slice(0, 45);
      if (!found.some(item => item.code === code)) found.push({code, title, page:row.page});
    }
  }
  return found.slice(0, 40);
}
function stageRows(records, pattern) {
  return records
    .filter(row => pattern.test(row.text))
    .filter(row => row.text.length <= 240)
    .sort((a,b) => importance(b.text) - importance(a.text))
    .slice(0, 8);
}
function importance(text) {
  return (/(?:不得|應|須|需|核准|核定|試驗|查驗|書面|保固|驗收)/.test(text) ? 8 : 0) + (text.length > 18 && text.length < 150 ? 5 : 0) - Math.max(0, text.length - 160) / 15;
}
function riskRows(records) {
  return records.filter(row => /不得|禁止|損壞|賠償|安全|疑義|不明|變更|書面通知|核准後|修復|火災|責任/.test(row.text)).sort((a,b)=>importance(b.text)-importance(a.text)).slice(0,8);
}
function keyFacts(records, duration, drawingIndex) {
  const patterns = [
    ["工程期限", /契約工期|施工期限|完成期限|工期/], ["材料送審", /材料.*(?:送審|審查|核准|樣品)/], ["施工疑義", /疑義|不明.*(?:監造|建築師|業主)/],
    ["變更程序", /變更.*(?:書面|通知|核准)/], ["現場丈量", /丈量|現場.*尺寸|核對.*尺寸/], ["施工安全", /安全|職業安全|公共危險/]
  ];
  const facts = [];
  if (duration) facts.push({label:"工程期限", page:duration.page, text:duration.value});
  for (const [label, pattern] of patterns) {
    if (label === "工程期限" && duration) continue;
    const row = sourceMatch(records, pattern);
    if (row) facts.push({label, page:row.page, text:row.text.slice(0,180)});
  }
  if (drawingIndex.length) facts.push({label:"圖說索引", page:drawingIndex[0].page, text:`辨識到 ${drawingIndex.length} 個圖號：${drawingIndex.slice(0,8).map(item=>item.code).join("、")}${drawingIndex.length>8?"…":""}`});
  return facts.slice(0,8);
}
function missingItems({projectTitle, duration, drawingIndex, records}) {
  const checks = [
    [projectTitle, "工程名稱未可靠辨識"], [duration, "工期未可靠辨識"], [drawingIndex.length, "圖號索引未可靠辨識"],
    [records.some(row=>/契約金額|工程費|預算金額/.test(row.text)), "契約金額未在此 PDF 辨識到"],
    [records.some(row=>/開工日期|預定開工/.test(row.text)), "實際／預定開工日未在此 PDF 辨識到"],
    [records.some(row=>/驗收標準|驗收方式|驗收規定/.test(row.text)), "驗收標準未在此 PDF 辨識到，須回契約及規範核對"]
  ];
  return checks.filter(([ok])=>!ok).map(([,message])=>message);
}
function buildAnalysis(file, pdf, metadata, pages) {
  const records = recordsFromPages(pages);
  const textCharacters = pages.reduce((sum,page)=>sum+page.text.length,0);
  const projectTitle = extractProjectTitle(records);
  const duration = extractDuration(records, pages);
  const drawingIndex = extractDrawingIndex(records);
  const result = {
    version: ANALYZER_VERSION,
    fileName: file.name,
    fileSize: file.size,
    analyzedAt: new Date().toISOString(),
    pageCount: pdf.numPages,
    textCharacters,
    documentKind: /AutoCAD/i.test(metadata?.info?.Creator || "") || drawingIndex.length >= 3 ? "建築／工程圖說" : "工程 PDF",
    creator: normalize(metadata?.info?.Creator || ""),
    projectTitle,
    designer: extractDesigner(records, metadata),
    duration,
    drawingIndex,
    facts: [], stages: {}, risks: riskRows(records), missing: [],
    needsOcr: textCharacters < Math.max(120, pdf.numPages * 25)
  };
  result.facts = keyFacts(records, duration, drawingIndex);
  for (const [id, definition] of Object.entries(phaseDefinitions)) result.stages[id] = stageRows(records, definition.keywords);
  result.missing = missingItems({...result, records});
  return result;
}
async function readDwgHeader(file) {
  const signature = new TextDecoder("ascii").decode(await file.slice(0,6).arrayBuffer());
  return {signature, valid:/^AC\d{4}$/.test(signature), format:dwgFormatNames[signature] || `DWG（${signature || "版本待確認"}）`};
}
function classifyDwg(name) {
  return dwgRoles.find(role=>role.pattern.test(name)) || {
    id:"drawing", title:"其他工程圖", stages:["before","during"],
    note:"施工前確認圖名、圖號、版次及用途，施工中僅使用最新核定版。"
  };
}
function deriveDwgProjectTitle(files) {
  const names=files.map(file=>file.name.replace(/\.dwg$/i,"").replace(/(?:PLAN|SEC|拆除|詳圖|出圖|平面|剖面|配置|DETAIL).*$/i,"").trim()).filter(value=>value.length>=2);
  if(!names.length)return projectName();
  return names.sort((a,b)=>b.length-a.length)[0];
}
async function buildDwgAnalysis(files) {
  const rows=[];
  for(const file of files){
    const header=await readDwgHeader(file), role=classifyDwg(file.name);
    rows.push({fileName:file.name,fileSize:file.size,lastModified:file.lastModified,signature:header.signature,valid:header.valid,format:header.format,role:role.id,roleTitle:role.title,stages:role.stages,note:role.note});
  }
  const validCount=rows.filter(row=>row.valid).length;
  const stages={before:[],during:[],after:[]};
  for(const row of rows) for(const stage of row.stages) stages[stage].push({fileName:row.fileName,text:`${row.roleTitle}：${row.note}`});
  return {
    version:ANALYZER_VERSION, sourceType:"dwg-package", fileName:rows.length===1?rows[0].fileName:`${rows.length} 份 DWG 圖說`,
    analyzedAt:new Date().toISOString(), documentKind:"DWG 工程圖說包（初步分類）", projectTitle:deriveDwgProjectTitle(files),
    files:rows, pageCount:0, textCharacters:0, drawingIndex:[], duration:null, designer:"", stages,
    facts:[
      {label:"圖說包",text:`共 ${rows.length} 份 DWG；${validCount} 份通過檔頭辨識`,fileName:rows[0]?.fileName},
      {label:"圖面分工",text:rows.map(row=>`${row.roleTitle}：${row.fileName}`).join("；"),fileName:rows[0]?.fileName},
      {label:"DWG 版本",text:[...new Set(rows.map(row=>row.format))].join("、"),fileName:rows[0]?.fileName}
    ],
    risks:rows.filter(row=>!row.valid).map(row=>({fileName:row.fileName,text:"檔頭不是可辨識的 DWG 版本，請回原始 CAD 軟體檢查。"})),
    missing:["手機／瀏覽器目前只辨識 DWG 檔頭、檔名角色與工程階段，尚未讀取圖內尺寸、文字、圖層及材料規範。","完整內容分析請同時放入建築師出圖 PDF；若只有 DWG，請在桌面版以 AutoCAD 解析後再核對。","開工前仍須人工確認圖號、版次、核定狀態及各檔案是否屬於同一工程。"],
    needsOcr:false, browserLimited:true
  };
}
function mergePdfAndDwg(pdfAnalysis,dwgAnalysis) {
  const merged={...pdfAnalysis,sourceType:"mixed-package",documentKind:"PDF／DWG 工程圖說包",files:dwgAnalysis.files,browserLimited:true};
  merged.fileName=`${pdfAnalysis.fileName} ＋ ${dwgAnalysis.files.length} 份 DWG`;
  merged.facts=[...pdfAnalysis.facts,...dwgAnalysis.facts];
  merged.missing=[...pdfAnalysis.missing,"DWG 內部圖元仍須由 AutoCAD 或原出圖 PDF 核對。"];
  for(const stage of Object.keys(phaseDefinitions)) merged.stages[stage]=[...(pdfAnalysis.stages[stage]||[]),...(dwgAnalysis.stages[stage]||[])];
  return merged;
}
function openFileDb() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(FILE_DB,1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(FILE_STORE,{keyPath:"id"});
      store.createIndex("projectId","projectId",{unique:false});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("無法開啟本機附件資料庫"));
  });
}
async function storeSourceFiles(projectId, files) {
  const db = await openFileDb();
  const existing = await new Promise((resolve,reject) => {
    const tx=db.transaction(FILE_STORE,"readonly"), request=tx.objectStore(FILE_STORE).index("projectId").getAll(projectId);
    request.onsuccess=()=>resolve(request.result || []); request.onerror=()=>reject(request.error);
  });
  const old = existing.filter(item=>item.itemId==="pdf-analysis-source" || item.itemId==="drawing-analysis-source");
  await new Promise((resolve,reject) => {
    const tx=db.transaction(FILE_STORE,"readwrite"), store=tx.objectStore(FILE_STORE);
    old.forEach(item=>store.delete(item.id));
    files.forEach((file,index)=>store.put({id:`${projectId}:drawing-analysis-source:${Date.now()}:${index}`,projectId,itemId:"drawing-analysis-source",name:file.name,type:file.type||(/\.dwg$/i.test(file.name)?"application/acad":"application/pdf"),size:file.size,lastModified:file.lastModified,createdAt:new Date().toISOString(),blob:file}));
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
async function storedSourceFiles(projectId) {
  const db=await openFileDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(FILE_STORE,"readonly"), request=tx.objectStore(FILE_STORE).index("projectId").getAll(projectId);
    request.onsuccess=()=>resolve((request.result||[]).filter(item=>item.itemId==="drawing-analysis-source"||item.itemId==="pdf-analysis-source"));
    request.onerror=()=>reject(request.error||new Error("無法讀取圖說附件"));
  });
}
async function sourcePdfForPrint(projectId) {
  const sources=await storedSourceFiles(projectId), source=sources.find(item=>/\.pdf$/i.test(item.name)||item.type==="application/pdf");
  return source||null;
}
function packageSourceLabel(row){return row?.page?`PDF 第 ${row.page} 頁`:`DWG：${row?.fileName||"待確認"}`;}
function packageHtml(analysis,project,catalog,sourcePdfUrl="") {
  const value=(key,label)=>esc(project?.[key]||`【待確認：${label}】`), date=new Date().toLocaleString("zh-TW"), phaseOrder=["開工前","開工","施工","估驗變更","完工","竣工驗收","保固"];
  const drawings=[];
  for(const item of analysis.drawingIndex||[])drawings.push(`<tr><td>${esc(item.code)}</td><td>${esc(item.title||"圖名待確認")}</td><td>PDF 第 ${item.page} 頁</td><td>版次／核定狀態待確認</td></tr>`);
  for(const item of analysis.files||[])drawings.push(`<tr><td>${esc(item.roleTitle||"DWG")}</td><td>${esc(item.fileName)}</td><td>${esc(item.format||"DWG")}</td><td>${item.valid?"檔頭已辨識；版次待確認":"檔案格式待確認"}</td></tr>`);
  const documentSections=phaseOrder.map(phase=>{
    const rows=catalog.filter(item=>item.phaseName===phase).map(item=>`<tr><td>□</td><td>${esc(item.title)}</td><td>${esc(item.state?.status||"未開始")}</td><td>${esc(item.state?.owner||item.owner||"待確認")}</td><td>${esc(item.state?.due||"待設定")}</td><td>${esc(item.required?"常用必備":"視個案")}</td></tr>`).join("");
    return `<h3>${esc(phase)}文書</h3><table><thead><tr><th>完成</th><th>文件</th><th>目前狀態</th><th>負責人</th><th>期限</th><th>適用性</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  const stageSections=Object.entries(phaseDefinitions).map(([id,definition])=>`<section><h2>${esc(definition.title)}圖說重點</h2><ul>${(analysis.stages?.[id]||[]).map(row=>`<li>${esc(row.text)} <small>${esc(packageSourceLabel(row))}</small></li>`).join("")||"<li>未辨識到明確內容，須人工查看原圖。</li>"}${definition.suggestions.map(text=>`<li>【流程建議，待核對】${esc(text)}</li>`).join("")}</ul></section>`).join("");
  const sourceFiles=[analysis.fileName,...(analysis.files||[]).map(item=>item.fileName)].filter((name,index,list)=>name&&list.indexOf(name)===index);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${value("name","工程名稱")}－工程資料包</title><style>
    @page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:"Microsoft JhengHei",Arial,sans-serif;color:#17211e;font-size:10.5pt;line-height:1.55;margin:0}h1{font-size:24pt;color:#12382f;margin:0 0 12px}h2{font-size:16pt;color:#12382f;border-bottom:2px solid #b68b38;padding-bottom:4px;margin-top:24px}h3{font-size:12pt;color:#245647;margin:18px 0 6px}.cover{min-height:250mm;display:flex;flex-direction:column;justify-content:center;text-align:center;page-break-after:always}.cover .tag{color:#9b6c17;letter-spacing:.16em}.notice{border:2px solid #bd3b32;background:#fff4f2;padding:10px 12px;margin:18px 0;text-align:left}.meta{width:100%;border-collapse:collapse;margin:14px 0}.meta th,.meta td,table th,table td{border:1px solid #9caeaa;padding:5px 7px;vertical-align:top}.meta th,table th{background:#edf4f1;text-align:left}table{width:100%;border-collapse:collapse;font-size:8.8pt;margin:6px 0 14px}ul{padding-left:20px}li{margin:3px 0}small{color:#526963}.page-break{page-break-before:always}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:30px}.signatures div{border:1px solid #777;height:85px;padding:7px}.drawing-page{page-break-before:always;height:270mm;display:flex;flex-direction:column}.drawing-page img{width:100%;height:255mm;object-fit:contain}.drawing-label{text-align:right;color:#526963;font-size:9pt}.footer-note{margin-top:18px;color:#526963;font-size:9pt}@media screen{body{max-width:900px;margin:28px auto;padding:0 24px;background:white}.drawing-page{height:auto}.drawing-page img{height:auto}html{background:#dfe8e4}}
  </style></head><body>
  <section class="cover"><div class="tag">PUBLIC WORKS DOCUMENT PACKAGE</div><h1>${value("name","工程名稱")}</h1><h2>工程圖說與文書作業資料包</h2><p>建立時間：${esc(date)}</p><p>資料來源：${sourceFiles.map(esc).join("、")||"待確認"}</p><div class="notice"><strong>初稿／待核對：</strong>本資料包由建築師資料自動整理，不是核定施工圖、設計簽證或機關正式表單。所有「待確認」欄位、尺寸、金額、期限及版次須由承辦、工地主任、建築師／監造依契約與原圖確認後才能使用。</div></section>
  <section><h2>一、工程基本資料</h2><table class="meta"><tr><th>工程名稱</th><td>${value("name","工程名稱")}</td><th>主辦機關</th><td>${value("agency","主辦機關")}</td></tr><tr><th>標案／契約編號</th><td>${value("caseNo","契約編號")}</td><th>契約金額</th><td>${value("contractAmount","契約金額")}</td></tr><tr><th>預定開工</th><td>${value("plannedStart","預定開工日")}</td><th>預定完工</th><td>${value("plannedFinish","預定完工日")}</td></tr><tr><th>負責人</th><td>${value("owner","負責人")}</td><th>監造單位</th><td>${value("supervisor","監造單位")}</td></tr><tr><th>辨識工期</th><td>${esc(analysis.duration?.value||"【待確認：契約工期】")}</td><th>設計／建築師</th><td>${esc(analysis.designer||"【待確認：設計／建築師】")}</td></tr></table></section>
  <section><h2>二、圖說目錄與出圖控制</h2>${sourcePdfUrl?`<p class="notice"><strong>原圖出圖：</strong><a href="${sourcePdfUrl}" target="_blank" rel="noopener">開啟建築師原圖 PDF，依原尺寸列印</a>。請先確認圖號、版次、紙張尺寸與核定狀態。</p>`:""}<table><thead><tr><th>圖號／類型</th><th>圖名／檔名</th><th>來源</th><th>版次控制</th></tr></thead><tbody>${drawings.join("")||'<tr><td colspan="4">【待確認：尚未辨識圖號；請依原圖建立正式圖說目錄】</td></tr>'}</tbody></table><p class="footer-note">DWG 需由 AutoCAD 依核定版次正式出圖；建築師原圖 PDF 應保留向量線條並依指定紙張比例列印，不轉成低解析圖片。</p></section>
  <section><h2>三、文件明載重點</h2><ul>${(analysis.facts||[]).map(row=>`<li><strong>${esc(row.label)}：</strong>${esc(row.text)} <small>${row.page||row.fileName?esc(packageSourceLabel(row)):""}</small></li>`).join("")||"<li>未辨識到可靠重點，須人工查看原圖。</li>"}</ul></section>
  ${stageSections}
  <section class="page-break"><h2>七、公共工程文書總表</h2><p>系統已把常用初稿標成「準備中」，不會把尚未簽認或核定的文件誤標為完成。</p>${documentSections}</section>
  <section class="page-break"><h2>八、風險、缺漏與核對</h2><h3>風險與注意事項</h3><ul>${(analysis.risks||[]).map(row=>`<li>${esc(row.text)} <small>${esc(packageSourceLabel(row))}</small></li>`).join("")||"<li>未自動辨識明確風險；仍須依契約、規範與現場條件審查。</li>"}</ul><h3>待確認／缺少資料</h3><ul>${(analysis.missing||[]).map(text=>`<li>□ ${esc(text)}</li>`).join("")||"<li>□ 人工核對原圖、契約及機關表單</li>"}</ul><div class="signatures"><div>廠商專案負責人：<br><br>日期：</div><div>工地主任／品管：<br><br>日期：</div><div>建築師／監造確認：<br><br>日期：</div></div></section>
  </body></html>`;
}
async function printFullPackage(analysis) {
  const printWindow=window.open("","_blank");
  if(!printWindow){alert("瀏覽器已阻擋列印視窗，請允許此網站開啟新視窗後再按一次。");return;}
  printWindow.document.write('<!doctype html><meta charset="utf-8"><title>建立工程資料包</title><p style="font-family:sans-serif;padding:30px">正在建立工程文書資料包，請稍候…</p>');
  window.dispatchEvent(new CustomEvent("engineering-analysis-build-package",{detail:{projectId:activeProjectId(),analysis}}));
  try{
    const project=window.EngineeringWorkbench?.getCurrentProject?.()||{}, catalog=window.EngineeringWorkbench?.getDocumentCatalog?.()||[], sourcePdf=await sourcePdfForPrint(activeProjectId());
    const sourcePdfUrl=sourcePdf?URL.createObjectURL(sourcePdf.blob):"";
    printWindow.document.open();printWindow.document.write(packageHtml(analysis,project,catalog,sourcePdfUrl));printWindow.document.close();printWindow.focus();
    if(sourcePdfUrl)setTimeout(()=>URL.revokeObjectURL(sourcePdfUrl),30*60*1000);
    setStatus(`工程資料包已建立：${catalog.length} 項文書${sourcePdf?"；原圖列印連結已放在資料包第二節":"；未附 PDF，DWG 請由 AutoCAD 正式出圖"}。`);
    setTimeout(()=>printWindow.print(),500);
  }catch(error){printWindow.close();setStatus(`建立列印資料包失敗：${error?.message||"未知錯誤"}`,true);}
}
function downloadWordPackage(analysis) {
  window.dispatchEvent(new CustomEvent("engineering-analysis-build-package",{detail:{projectId:activeProjectId(),analysis}}));
  const project=window.EngineeringWorkbench?.getCurrentProject?.()||{}, catalog=window.EngineeringWorkbench?.getDocumentCatalog?.()||[];
  download(`工程資料包-${analysis.projectTitle||project.name||"待命名工程"}-${new Date().toISOString().slice(0,10)}.doc`,`\ufeff${packageHtml(analysis,project,catalog)}`,"application/msword;charset=utf-8");
  setStatus("已建立 Word 工程資料包；原圖 PDF 頁面只在「一鍵建立並列印」時併入。");
}
function setStatus(message, error=false) { const el=$("pdf-analysis-status"); el.textContent=message; el.classList.toggle("error",error); }
function renderSource(row) { return `${esc(row.text)} <span class="source-page">${row.page?`PDF 第 ${row.page} 頁`:`DWG：${esc(row.fileName||"來源檔")}`}</span>`; }
function renderAnalysis(analysis) {
  const result=$("pdf-analysis-result");
  if (!analysis) { result.hidden=true; result.innerHTML=""; setStatus("尚未分析 PDF／DWG 圖說。"); return; }
  const stages = Object.entries(phaseDefinitions).map(([id,definition]) => {
    const cited=(analysis.stages?.[id]||[]).map(row=>`<li>${renderSource(row)}</li>`).join("");
    const suggestions=definition.suggestions.map(text=>`<li class="suggestion">${esc(text)}</li>`).join("");
    return `<article class="analysis-stage"><header><h4>${esc(definition.title)}</h4><button type="button" data-analysis-phase="${esc(definition.target)}">開啟清單 →</button></header><ul>${cited||'<li class="suggestion">圖說未辨識到明確內容，請人工查看原檔。</li>'}${suggestions}</ul></article>`;
  }).join("");
  const facts=(analysis.facts||[]).map(fact=>`<li><b>${esc(fact.label)}：</b>${esc(fact.text)} ${fact.page||fact.fileName?`<span class="source-page">${fact.page?`PDF 第 ${fact.page} 頁`:`DWG：${esc(fact.fileName)}`}</span>`:""}</li>`).join("");
  const risks=(analysis.risks||[]).map(renderSource).map(text=>`<li>${text}</li>`).join("") || "<li>未辨識到明確風險條文，仍須人工核對契約與施工規範。</li>";
  const missing=(analysis.missing||[]).map(text=>`<li>${esc(text)}</li>`).join("") || "<li>目前沒有明顯缺漏提示；仍須人工核對原圖及契約。</li>";
  result.innerHTML=`
    <div class="analysis-result-head"><div><span class="section-kicker">ANALYSIS RESULT</span><h3>${esc(analysis.projectTitle||analysis.fileName)}</h3><p>${esc(analysis.fileName)} · ${esc(new Date(analysis.analyzedAt).toLocaleString("zh-TW"))}</p></div><div class="analysis-actions"><button class="btn" id="build-print-package" type="button">一鍵建立並列印</button><button class="btn secondary" id="download-word-package" type="button">下載 Word 資料包</button><button class="btn secondary" id="download-pdf-analysis" type="button">下載重點摘要</button><button class="text-button" id="apply-pdf-analysis" type="button">只套用專案資料</button></div></div>
    <div class="analysis-metrics"><article><span>文件類型</span><strong>${esc(analysis.documentKind)}</strong></article><article><span>${analysis.files?.length?"DWG 檔案":"頁數"}</span><strong>${analysis.files?.length?`${analysis.files.length} 份`:`${analysis.pageCount} 頁`}</strong></article><article><span>圖號</span><strong>${analysis.drawingIndex?.length||0} 個</strong></article><article><span>工期</span><strong>${esc(analysis.duration?.value||"待確認")}</strong></article></div>
    ${analysis.needsOcr?'<p class="analysis-warning danger"><strong>需要 OCR：</strong>這份 PDF 幾乎沒有可抽取文字，目前只能辨識頁數與檔案資訊；請提供可搜尋文字版，或之後啟用 OCR 再分析。</p>':analysis.browserLimited?'<p class="analysis-warning danger"><strong>DWG 初步分類：</strong>瀏覽器已驗證檔案格式並依檔名分工，但沒有讀取 CAD 內部尺寸、文字與圖層。完整分析請加入出圖 PDF，或回桌面版用 AutoCAD 解析。</p>':'<p class="analysis-warning"><strong>初步自動整理：</strong>這不是設計審查或契約判讀。所有內容保留 PDF 頁碼，施工前須由工地主任／監造逐項核對原圖。</p>'}
    <ul class="analysis-facts">${facts||'<li>目前沒有可靠的文件明載重點。</li>'}</ul>
    <div class="analysis-stages">${stages}</div>
    <div class="analysis-lists"><section class="analysis-list"><h4>風險與注意事項</h4><ul>${risks}</ul></section><section class="analysis-list"><h4>待確認／缺少資料</h4><ul>${missing}</ul></section></div>`;
  result.hidden=false;
  setStatus(analysis.files?.length?`已整理 ${analysis.files.length} 份 DWG${analysis.pageCount?`，並分析 PDF ${analysis.pageCount} 頁`:""}；原始檔只存在此裝置。`:`已完成 ${analysis.pageCount} 頁分析；辨識 ${analysis.textCharacters.toLocaleString()} 個文字。`);
}
function analysisMarkdown(analysis) {
  const sourceLabel=row=>row.page?`PDF 第 ${row.page} 頁`:`DWG：${row.fileName||"來源檔"}`;
  const rows=[`# ${analysis.projectTitle||analysis.fileName} - 圖說重點整理`,``,`> 來源：${analysis.fileName}；分析時間：${analysis.analyzedAt}；所有內容須回原圖、契約與監造核定資料人工核對。`,``,`- 文件類型：${analysis.documentKind}`,
    `- PDF 頁數：${analysis.pageCount||0}`,`- DWG 檔案：${analysis.files?.length||0}`,`- 工期：${analysis.duration?.value||"待確認"}`,`- 設計／建築師：${analysis.designer||"待確認"}`,`- 圖號：${analysis.drawingIndex?.map(item=>item.code).join("、")||"待確認"}`,``,`## 文件明載／檔案辨識重點`];
  for(const fact of analysis.facts||[]) rows.push(`- ${fact.label}：${fact.text}${fact.page||fact.fileName?`（${sourceLabel(fact)}）`:""}`);
  for(const [id,definition] of Object.entries(phaseDefinitions)) { rows.push(``,`## ${definition.title}`); for(const row of analysis.stages?.[id]||[]) rows.push(`- ${row.text}（${sourceLabel(row)}）`); rows.push(...definition.suggestions.map(text=>`- 【流程建議，待核對】${text}`)); }
  rows.push(``,`## 風險與注意事項`,...(analysis.risks||[]).map(row=>`- ${row.text}（${sourceLabel(row)}）`),``,`## 待確認／缺少資料`,...(analysis.missing||[]).map(text=>`- ${text}`));
  return rows.join("\n");
}
function download(name,content,type="text/markdown;charset=utf-8") { const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function analyzePdf(file) {
  const loading=pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
  const pdf=await loading.promise, metadata=await pdf.getMetadata().catch(()=>({info:{}})), pages=[];
  for(let number=1;number<=pdf.numPages;number++){
    setStatus(`正在分析 PDF 第 ${number}／${pdf.numPages} 頁…`);
    const page=await pdf.getPage(number), content=await page.getTextContent({includeMarkedContent:false}), lines=textLines(content.items), sequential=normalize(content.items.map(item=>item.str||"").join(" "));
    pages.push({page:number,lines,text:lines.join("\n"),sequential});
  }
  return buildAnalysis(file,pdf,metadata,pages);
}
async function analyzeFiles(fileList) {
  const projectId=activeProjectId();
  if (!projectId) return setStatus("請先建立工程專案。",true);
  const files=[...fileList], pdfs=files.filter(file=>/\.pdf$/i.test(file.name)||file.type==="application/pdf"), dwgs=files.filter(file=>/\.dwg$/i.test(file.name));
  if (!files.length || files.length!==pdfs.length+dwgs.length) return setStatus("目前圖說分析只接受 PDF 與 DWG 檔。",true);
  if (pdfs.length>1) return setStatus("一次可放 1 份出圖 PDF，並可同時加入多份 DWG。",true);
  const tooLarge=files.find(file=>file.size>MAX_FILE_SIZE);
  if (tooLarge) return setStatus(`${tooLarge.name} 超過單檔 100 MB 上限。`,true);
  setStatus(`正在讀取 ${files.length} 份圖說…`);
  try {
    const pdfAnalysis=pdfs.length?await analyzePdf(pdfs[0]):null;
    const dwgAnalysis=dwgs.length?await buildDwgAnalysis(dwgs):null;
    const analysis=pdfAnalysis&&dwgAnalysis?mergePdfAndDwg(pdfAnalysis,dwgAnalysis):(pdfAnalysis||dwgAnalysis);
    await storeSourceFiles(projectId,files);
    saveAnalysis(projectId,analysis);
    renderAnalysis(analysis);
  } catch(error) {
    console.error(error);
    setStatus(`分析失敗：${error?.message||"無法讀取圖說"}`,true);
  }
}
function bind() {
  const zone=$("pdf-drop-zone"), input=$("pdf-analysis-file"), result=$("pdf-analysis-result");
  zone.addEventListener("click",event=>{if(!event.target.closest("label"))input.click();});
  zone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();input.click();}});
  input.addEventListener("change",()=>{if(input.files.length)analyzeFiles(input.files); input.value="";});
  for(const eventName of ["dragenter","dragover"]) zone.addEventListener(eventName,event=>{event.preventDefault();zone.classList.add("dragging");});
  for(const eventName of ["dragleave","drop"]) zone.addEventListener(eventName,event=>{event.preventDefault();zone.classList.remove("dragging");});
  zone.addEventListener("drop",event=>{if(event.dataTransfer.files.length)analyzeFiles(event.dataTransfer.files);});
  result.addEventListener("click",event=>{
    const analysis=loadAnalyses()[activeProjectId()];
    if(!analysis)return;
    if(event.target.id==="build-print-package")printFullPackage(analysis);
    if(event.target.id==="download-word-package")downloadWordPackage(analysis);
    if(event.target.id==="apply-pdf-analysis") window.dispatchEvent(new CustomEvent("engineering-analysis-apply",{detail:{projectId:activeProjectId(),analysis}}));
    if(event.target.id==="download-pdf-analysis") download(`圖說重點-${analysis.projectTitle||projectName()}-${new Date().toISOString().slice(0,10)}.md`,analysisMarkdown(analysis));
    const phase=event.target.closest("[data-analysis-phase]")?.dataset.analysisPhase;
    if(phase) window.dispatchEvent(new CustomEvent("engineering-analysis-phase",{detail:{phase}}));
  });
  window.addEventListener("engineering-project-change",()=>renderAnalysis(loadAnalyses()[activeProjectId()]));
  renderAnalysis(loadAnalyses()[activeProjectId()]);
}

window.EngineeringPdfAnalysis = {
  getCurrentAnalysis:()=>loadAnalyses()[activeProjectId()]||null,
  importAnalysis:(projectId,analysis)=>{if(analysis&&typeof analysis==="object")saveAnalysis(projectId,analysis);},
  removeAnalysis
};
bind();
