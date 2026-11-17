import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const STORAGE_KEY = "twb.engineeringProjects.v1";
const ACTIVE_KEY = `${STORAGE_KEY}.active`;
const ANALYSIS_KEY = "twb.engineeringPdfAnalyses.v1";
const FILE_DB = "twb-engineering-files-v1";
const FILE_STORE = "attachments";
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ANALYZER_VERSION = 1;
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
async function storeSourceFile(projectId, file) {
  const db = await openFileDb();
  const existing = await new Promise((resolve,reject) => {
    const tx=db.transaction(FILE_STORE,"readonly"), request=tx.objectStore(FILE_STORE).index("projectId").getAll(projectId);
    request.onsuccess=()=>resolve(request.result || []); request.onerror=()=>reject(request.error);
  });
  const old = existing.filter(item=>item.itemId==="pdf-analysis-source");
  await new Promise((resolve,reject) => {
    const tx=db.transaction(FILE_STORE,"readwrite"), store=tx.objectStore(FILE_STORE);
    old.forEach(item=>store.delete(item.id));
    store.put({id:`${projectId}:pdf-analysis-source:${Date.now()}`,projectId,itemId:"pdf-analysis-source",name:file.name,type:file.type||"application/pdf",size:file.size,lastModified:file.lastModified,createdAt:new Date().toISOString(),blob:file});
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
function setStatus(message, error=false) { const el=$("pdf-analysis-status"); el.textContent=message; el.classList.toggle("error",error); }
function renderSource(row) { return `${esc(row.text)} <span class="source-page">PDF 第 ${row.page} 頁</span>`; }
function renderAnalysis(analysis) {
  const result=$("pdf-analysis-result");
  if (!analysis) { result.hidden=true; result.innerHTML=""; setStatus("尚未分析 PDF。"); return; }
  const stages = Object.entries(phaseDefinitions).map(([id,definition]) => {
    const cited=(analysis.stages?.[id]||[]).map(row=>`<li>${renderSource(row)}</li>`).join("");
    const suggestions=definition.suggestions.map(text=>`<li class="suggestion">${esc(text)}</li>`).join("");
    return `<article class="analysis-stage"><header><h4>${esc(definition.title)}</h4><button type="button" data-analysis-phase="${esc(definition.target)}">開啟清單 →</button></header><ul>${cited||'<li class="suggestion">PDF 未辨識到明確條文，請人工查看圖說。</li>'}${suggestions}</ul></article>`;
  }).join("");
  const facts=(analysis.facts||[]).map(fact=>`<li><b>${esc(fact.label)}：</b>${esc(fact.text)} <span class="source-page">PDF 第 ${fact.page} 頁</span></li>`).join("");
  const risks=(analysis.risks||[]).map(renderSource).map(text=>`<li>${text}</li>`).join("") || "<li>未辨識到明確風險條文，仍須人工核對契約與施工規範。</li>";
  const missing=(analysis.missing||[]).map(text=>`<li>${esc(text)}</li>`).join("") || "<li>目前沒有明顯缺漏提示；仍須人工核對原圖及契約。</li>";
  result.innerHTML=`
    <div class="analysis-result-head"><div><span class="section-kicker">ANALYSIS RESULT</span><h3>${esc(analysis.projectTitle||analysis.fileName)}</h3><p>${esc(analysis.fileName)} · ${esc(new Date(analysis.analyzedAt).toLocaleString("zh-TW"))}</p></div><div class="analysis-actions"><button class="btn" id="apply-pdf-analysis" type="button">套用到目前專案</button><button class="btn secondary" id="download-pdf-analysis" type="button">下載重點摘要</button></div></div>
    <div class="analysis-metrics"><article><span>文件類型</span><strong>${esc(analysis.documentKind)}</strong></article><article><span>頁數</span><strong>${analysis.pageCount} 頁</strong></article><article><span>圖號</span><strong>${analysis.drawingIndex?.length||0} 個</strong></article><article><span>工期</span><strong>${esc(analysis.duration?.value||"待確認")}</strong></article></div>
    ${analysis.needsOcr?'<p class="analysis-warning danger"><strong>需要 OCR：</strong>這份 PDF 幾乎沒有可抽取文字，目前只能辨識頁數與檔案資訊；請提供可搜尋文字版，或之後啟用 OCR 再分析。</p>':'<p class="analysis-warning"><strong>初步自動整理：</strong>這不是設計審查或契約判讀。所有內容保留 PDF 頁碼，施工前須由工地主任／監造逐項核對原圖。</p>'}
    <ul class="analysis-facts">${facts||'<li>目前沒有可靠的文件明載重點。</li>'}</ul>
    <div class="analysis-stages">${stages}</div>
    <div class="analysis-lists"><section class="analysis-list"><h4>風險與注意事項</h4><ul>${risks}</ul></section><section class="analysis-list"><h4>待確認／缺少資料</h4><ul>${missing}</ul></section></div>`;
  result.hidden=false;
  setStatus(`已完成 ${analysis.pageCount} 頁分析；辨識 ${analysis.textCharacters.toLocaleString()} 個文字。`);
}
function analysisMarkdown(analysis) {
  const rows=[`# ${analysis.projectTitle||analysis.fileName} - PDF 重點整理`,``,`> 來源：${analysis.fileName}；分析時間：${analysis.analyzedAt}；所有內容須回原 PDF 與契約人工核對。`,``,`- 文件類型：${analysis.documentKind}`,
    `- 頁數：${analysis.pageCount}` ,`- 工期：${analysis.duration?.value||"待確認"}`,`- 設計／建築師：${analysis.designer||"待確認"}`,`- 圖號：${analysis.drawingIndex?.map(item=>item.code).join("、")||"待確認"}`,``,`## 文件明載重點`];
  for(const fact of analysis.facts||[]) rows.push(`- ${fact.label}：${fact.text}（PDF 第 ${fact.page} 頁）`);
  for(const [id,definition] of Object.entries(phaseDefinitions)) { rows.push(``,`## ${definition.title}`); for(const row of analysis.stages?.[id]||[]) rows.push(`- ${row.text}（PDF 第 ${row.page} 頁）`); rows.push(...definition.suggestions.map(text=>`- 【流程建議，待核對】${text}`)); }
  rows.push(``,`## 風險與注意事項`,...(analysis.risks||[]).map(row=>`- ${row.text}（PDF 第 ${row.page} 頁）`),``,`## 待確認／缺少資料`,...(analysis.missing||[]).map(text=>`- ${text}`));
  return rows.join("\n");
}
function download(name,content) { const url=URL.createObjectURL(new Blob([content],{type:"text/markdown;charset=utf-8"})); const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function analyzeFile(file) {
  const projectId=activeProjectId();
  if (!projectId) return setStatus("請先建立工程專案。",true);
  if (!file || (file.type!=="application/pdf" && !/\.pdf$/i.test(file.name))) return setStatus("請選擇 PDF 檔。",true);
  if (file.size>MAX_FILE_SIZE) return setStatus(`${file.name} 超過 100 MB 上限。`,true);
  setStatus(`正在讀取 ${file.name}…`);
  try {
    const loading=pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
    const pdf=await loading.promise, metadata=await pdf.getMetadata().catch(()=>({info:{}})), pages=[];
    for(let number=1;number<=pdf.numPages;number++){
      setStatus(`正在分析第 ${number}／${pdf.numPages} 頁…`);
      const page=await pdf.getPage(number), content=await page.getTextContent({includeMarkedContent:false}), lines=textLines(content.items), sequential=normalize(content.items.map(item=>item.str||"").join(" "));
      pages.push({page:number,lines,text:lines.join("\n"),sequential});
    }
    const analysis=buildAnalysis(file,pdf,metadata,pages);
    await storeSourceFile(projectId,file);
    saveAnalysis(projectId,analysis);
    renderAnalysis(analysis);
  } catch(error) {
    console.error(error);
    setStatus(`分析失敗：${error?.message||"無法讀取 PDF"}`,true);
  }
}
function bind() {
  const zone=$("pdf-drop-zone"), input=$("pdf-analysis-file"), result=$("pdf-analysis-result");
  zone.addEventListener("click",event=>{if(!event.target.closest("label"))input.click();});
  zone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();input.click();}});
  input.addEventListener("change",()=>{const [file]=input.files; if(file)analyzeFile(file); input.value="";});
  for(const eventName of ["dragenter","dragover"]) zone.addEventListener(eventName,event=>{event.preventDefault();zone.classList.add("dragging");});
  for(const eventName of ["dragleave","drop"]) zone.addEventListener(eventName,event=>{event.preventDefault();zone.classList.remove("dragging");});
  zone.addEventListener("drop",event=>{const [file]=event.dataTransfer.files;if(file)analyzeFile(file);});
  result.addEventListener("click",event=>{
    const analysis=loadAnalyses()[activeProjectId()];
    if(!analysis)return;
    if(event.target.id==="apply-pdf-analysis") window.dispatchEvent(new CustomEvent("engineering-analysis-apply",{detail:{projectId:activeProjectId(),analysis}}));
    if(event.target.id==="download-pdf-analysis") download(`PDF重點-${analysis.projectTitle||projectName()}-${new Date().toISOString().slice(0,10)}.md`,analysisMarkdown(analysis));
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
