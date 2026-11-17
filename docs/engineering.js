(() => {
  "use strict";
  const STORAGE_KEY = "twb.engineeringProjects.v1";
  const FILE_DB = "twb-engineering-files-v1";
  const FILE_STORE = "attachments";
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const statuses = ["未開始", "準備中", "送審中", "退補", "已核定", "已完成", "不適用"];
  const phases = [
    { id: "prepare", name: "開工前", note: "先以契約、招標文件及監造要求建立送審總表；施工計畫、品質計畫、施工圖及檢驗文件的名稱與期限須逐案核對。" },
    { id: "start", name: "開工", note: "完成開工通知、場地交付、基準進度與開工會議紀錄。開工條件及送達方式一律以契約約定為準。" },
    { id: "build", name: "施工", note: "日報、照片、自主檢查、材料試驗與查驗紀錄要同日或即時留存；退補與不合格品必須留下原因、改善及複驗證據。" },
    { id: "payment", name: "估驗變更", note: "估驗數量要能回溯到測量、圖說與現場紀錄。任何追加、減作、替代材料或工期主張，先完成書面核定再施工。" },
    { id: "finish", name: "完工", note: "完工通知不等同驗收完成。同步盤點竣工圖、結算、試運轉、保固與移交資料，避免因文件不齊延後初驗。" },
    { id: "accept", name: "竣工驗收", note: "施行細則的處理期限多屬機關／監造程序；承攬商仍須依通知到場、完成缺失改善並保存書面送達證明。" },
    { id: "warranty", name: "保固", note: "保固缺失通知、會勘、修繕前後照片與完成確認要串成一筆紀錄；到期前主動盤點未結案件與保證金返還條件。" }
  ];
  const docs = [
    ["prepare","contract","契約與招標文件控制本","建立最新版契約、圖說、標單、疑義／更正文件索引","廠商專案負責人",1],
    ["prepare","site-handover","工地／用地交付紀錄","確認界址、既有設施、現況照片及交付限制","機關／監造／廠商",1],
    ["prepare","construction-plan","施工計畫書","施工方法、程序、資源、界面與風險的核定版本","工地主任",1],
    ["prepare","quality-plan","品質計畫書","品質組織、標準、檢驗、自主檢查、不合格管制與紀錄","品管人員",1],
    ["prepare","safety-plan","職業安全衛生計畫及告知","依工程規模、風險及主管機關要求辦理","職安人員",1],
    ["prepare","environment-plan","環境維護／污染防制計畫","噪音、揚塵、廢棄物、交通與鄰損等要求","工地主任",0],
    ["prepare","baseline-schedule","預定進度表／網圖","建立契約工期基準及主要里程碑","廠商專案負責人",1],
    ["prepare","personnel","專任人員與組織報備","工地主任、品管、職安及專業人員資格與異動","廠商專案負責人",1],
    ["prepare","insurance-bond","保險與履約保證文件","核對有效期間、金額、承保範圍及續保提醒","行政／財務",1],
    ["prepare","shopdrawings-plan","施工圖與送審總表","列出施工圖、材料設備、樣品與預計送審日","工程師",1],
    ["prepare","permits","許可、申報與告示牌","建管、道路、管線、環保等依個案適用","工地主任",0],
    ["start","start-notice","開工通知／開工報告","以契約指定格式及方式正式送達並保存證明","廠商專案負責人",1],
    ["start","kickoff","開工會議紀錄","確認窗口、送審、查驗、估驗、變更與通報方式","監造／廠商",1],
    ["start","start-conditions","開工條件檢核表","場地、人員、計畫、保險、臨設及前置許可","工地主任",1],
    ["start","daily-log-init","施工日誌／監造報表啟用","確認編號、簽核、氣象、人機料與照片規則","工地主任",1],
    ["start","survey-control","測量控制點交接與複測","保存座標、高程、基準點與共同確認紀錄","測量／監造",0],
    ["build","daily-log","施工日誌","每日人機料、施作位置、數量、氣象、指示與異常","工地主任",1],
    ["build","progress-report","週／月進度報告","預定與實際進度、落後原因、趕工與下期計畫","廠商專案負責人",1],
    ["build","photo-record","施工照片與位置索引","施工前中後、隱蔽部位、比例尺、日期與位置","現場工程師",1],
    ["build","self-inspection","自主檢查表","依品質計畫逐項檢查並由權責人簽認","品管人員",1],
    ["build","inspection-request","施工查驗／停留點申請","在覆蓋或進入下一工序前取得查驗紀錄","現場工程師",1],
    ["build","material-submittal","材料設備送審","型錄、樣品、證明、批號與核定版本追蹤","工程師／採購",1],
    ["build","test-report","材料試驗與檢測報告","取樣、送驗、結果、判定及批次使用位置","品管人員",1],
    ["build","shopdrawings","施工圖／深化圖核定版","版本、核定日期及現場使用版控","工程師",1],
    ["build","rfi","施工疑義／RFI","問題、圖說位置、建議方案、回覆與影響","工程師",0],
    ["build","ncr","不合格品與矯正預防紀錄","隔離、原因、處置、改善、複驗及預防再發","品管人員",0],
    ["build","meeting","工務會議與指示回覆","決議、責任人、期限與完成證據","廠商專案負責人",1],
    ["build","safety-record","職安巡檢、教育與缺失改善","教育訓練、工具箱會議、巡檢及改善照片","職安人員",1],
    ["build","waste-record","營建廢棄物／環境紀錄","清運聯單、流向、灑水、噪音或其他管制","職安／環保人員",0],
    ["build","suspend-resume","停工、展延與復工紀錄","事件起迄、原因、通知、影響分析及核定","廠商專案負責人",0],
    ["payment","progress-payment","估驗計價文件","估驗明細、數量計算、測量、照片與發票資料","計價人員",1],
    ["payment","quantity-ledger","工程數量計算與累計表","本期、前期、累計、契約量及超量預警","計價人員",1],
    ["payment","schedule-update","進度更新與工期分析","實際進度、要徑、落後原因與展延依據","廠商專案負責人",1],
    ["payment","change-request","變更設計／契約變更提案","原因、圖說、數量、單價、工期與風險影響","工程師／計價",0],
    ["payment","change-approval","變更核定與議價紀錄","未取得書面授權前標示為待核定，避免先做後補","廠商專案負責人",0],
    ["payment","substitution","材料替代申請","等同或優於比較、價格、工期、保固與核定","工程師／採購",0],
    ["payment","claim","展延、物價調整或權利主張","依契約期限通報，保存事件與成本證據","廠商專案負責人",0],
    ["finish","completion-notice","完工通知","載明實際完工日、未盡事項及書面送達證明","廠商專案負責人",1],
    ["finish","completion-check","完工條件自評／申請確認","逐項確認契約工作、現場清理及文件齊備","工地主任",1],
    ["finish","asbuilt","竣工圖","反映實際施作、變更、管線與設備資訊並完成版控","工程師",1],
    ["finish","final-account","工程結算明細與數量總表","契約、變更、實作數量與最終金額可追溯","計價人員",1],
    ["finish","commissioning","測試、試運轉與功能驗證","保存程序、條件、數據、判定及見證簽認","工程師／設備商",0],
    ["finish","manuals","操作維護手冊與教育訓練","設備清冊、保養、備品、保固與訓練簽到","設備商／工程師",0],
    ["finish","handover","移交清冊","鑰匙、設備、備品、文件、帳號及財產資料","廠商專案負責人",0],
    ["finish","warranty-docs","保固文件與保證金準備","保固項目、期間、窗口、保證文件及起算依據","行政／財務",1],
    ["accept","precheck","初驗／驗收文件總表","依機關通知確認應備文件、份數、版本與出席人員","廠商專案負責人",1],
    ["accept","initial-record","初驗紀錄","缺失、責任、期限、改善方式及複驗需求","機關／監造／廠商",0],
    ["accept","defect-correction","缺失改善與複驗資料","逐項對照、改善前後照片、日期與確認結果","工地主任",1],
    ["accept","acceptance-record","驗收紀錄／結算驗收證明","保存正式紀錄、保留款、保固起算與待辦","機關／廠商",1],
    ["accept","final-payment","末期款與保證金轉換","請款、扣款、保留款、履保返還與保固保證","行政／財務",1],
    ["accept","closeout","工程結案卷宗索引","紙本與電子檔案版本、保存位置及交付證明","廠商專案負責人",1],
    ["warranty","warranty-ledger","保固台帳","項目、保固期限、廠商、聯絡人與未結事項","專案負責人",1],
    ["warranty","defect-notice","保固缺失通知與會勘","通知時間、缺失、責任判定、修復期限與會勘","專案負責人",0],
    ["warranty","repair-record","保固修繕紀錄","修繕前後照片、材料、人員、日期與確認結果","維修負責人",0],
    ["warranty","warranty-end","保固期滿檢查與結清","未結缺失、期滿確認、保證金返還與結案證明","行政／專案負責人",1]
  ].map(([phase,id,title,help,owner,required]) => ({phase,id,title,help,owner,required:Boolean(required)}));
  const templates = [
    ["start-notice","開工通知／報告","正式通知預定或實際開工資訊"], ["daily-log","施工日誌","快速建立當日人機料、施作與異常欄位"],
    ["material-submittal","材料設備送審單","整理規格、型錄、證明與核定追蹤"], ["inspection-request","施工查驗申請","在停留點或隱蔽作業前提出查驗"],
    ["rfi","施工疑義／RFI","把圖說疑義、建議方案與影響一次寫清楚"], ["progress-payment","估驗計價檢核表","彙整數量、證據、前期與本期資料"],
    ["change-request","變更設計提案","記錄原因、費用、工期與待核定事項"], ["completion-notice","完工通知","通知實際完工與附件清單"],
    ["precheck","竣工文件總表","盤點初驗／驗收前應備卷宗"], ["defect-correction","缺失改善回覆","逐項對照缺失與改善證據"],
    ["repair-record","保固維修紀錄","保存通知、會勘、修繕與確認結果"]
  ];

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  let projects = load();
  let activeId = localStorage.getItem(`${STORAGE_KEY}.active`) || Object.keys(projects)[0] || "";
  let activePhase = "prepare";
  let editingItem = "";
  let dbPromise;

  function load() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
  function openFileDb() {
    if (!window.indexedDB) return Promise.reject(new Error("此瀏覽器不支援本機附件資料庫"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(FILE_DB, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(FILE_STORE, {keyPath:"id"});
        store.createIndex("projectId", "projectId", {unique:false});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟附件資料庫"));
    });
    return dbPromise;
  }
  async function fileRequest(mode, action) {
    const db = await openFileDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, mode);
      const store = tx.objectStore(FILE_STORE);
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("附件操作失敗"));
    });
  }
  async function projectAttachments(projectId) { return (await fileRequest("readonly", store => store.index("projectId").getAll(projectId))) || []; }
  async function itemAttachments(projectId, itemId) { return (await projectAttachments(projectId)).filter(file => file.itemId === itemId).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")); }
  async function saveAttachment(file) { return fileRequest("readwrite", store => store.put(file)); }
  async function getAttachment(id) { return fileRequest("readonly", store => store.get(id)); }
  async function deleteAttachment(id) { return fileRequest("readwrite", store => store.delete(id)); }
  async function deleteProjectAttachments(projectId) { const files=await projectAttachments(projectId); await Promise.all(files.map(file=>deleteAttachment(file.id))); }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); localStorage.setItem(`${STORAGE_KEY}.active`, activeId); }
  function baseProject(data={}) { const id=uid(); return { id, name:data.title || "待命名工程", agency:data.agency || "", caseNo:data.caseNo || "", contractAmount:data.budget || "", plannedStart:"", actualStart:"", plannedFinish:"", actualFinish:"", owner:"", supervisor:"", notes:data.officialUrl ? `官方公告：${data.officialUrl}` : "", items:{}, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }; }
  function current() { return projects[activeId]; }
  function ensureProject(data={}) {
    if (data.title) {
      const existing = Object.values(projects).find(p => (data.caseNo && p.caseNo === data.caseNo) || (!data.caseNo && p.name === data.title));
      if (existing) { activeId = existing.id; save(); return; }
    } else if (Object.keys(projects).length) return;
    const p=baseProject(data); projects[p.id]=p; activeId=p.id; save();
  }
  function tenderData() { try { const raw=new URLSearchParams(location.search).get("tender"); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
  function populateSelect() { const select=$("project-select"); select.innerHTML=Object.values(projects).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")).map(p=>`<option value="${esc(p.id)}"${p.id===activeId?" selected":""}>${esc(p.name)}${p.caseNo?`｜${esc(p.caseNo)}`:""}</option>`).join(""); }
  function fillForm() { const p=current(); if (!p) return; const form=$("project-form"); ["name","agency","caseNo","contractAmount","plannedStart","actualStart","plannedFinish","actualFinish","owner","supervisor","notes"].forEach(k=>form.elements[k].value=p[k]||""); }
  function itemState(id) { return current()?.items?.[id] || {status:"未開始",owner:"",due:"",link:"",notes:""}; }
  function isOverdue(s) { return s.due && s.due < today() && !["已完成","不適用"].includes(s.status); }
  function phaseProgress(id) { const list=docs.filter(d=>d.phase===id); const done=list.filter(d=>["已完成","不適用"].includes(itemState(d.id).status)).length; return `${done}/${list.length}`; }
  function renderNav() { $("phase-nav").innerHTML=phases.map(p=>`<button class="phase-button ${p.id===activePhase?"active":""} ${phaseProgress(p.id).startsWith(docs.filter(d=>d.phase===p.id).length+"/")?"complete":""}" type="button" data-phase="${p.id}">${p.name}<span>${phaseProgress(p.id)}</span></button>`).join(""); $("phase-guidance").textContent=phases.find(p=>p.id===activePhase).note; }
  function statusClass(status) { if (["已完成","不適用","已核定"].includes(status)) return "done"; if (["準備中","送審中"].includes(status)) return "review"; if (status==="退補") return "problem"; return ""; }
  async function renderDocs() {
    const projectId=current()?.id, phase=activePhase, filter=$("status-filter").value;
    const files = projectId ? await projectAttachments(projectId).catch(()=>[]) : [];
    if (projectId !== current()?.id || phase !== activePhase) return;
    const counts=files.reduce((map,file)=>map.set(file.itemId,(map.get(file.itemId)||0)+1),new Map());
    const list=docs.filter(d=>d.phase===activePhase).filter(d=>{const s=itemState(d.id); return !filter || (filter==="overdue"?isOverdue(s):s.status===filter);});
    $("document-list").innerHTML=list.length?list.map(d=>{const s=itemState(d.id), count=counts.get(d.id)||0; return `<article class="document-item"><div class="document-title"><strong>${esc(d.title)}<span class="required ${d.required?"":"conditional"}">${d.required?"常用必備":"視個案"}</span></strong><p>${esc(d.help)}</p>${count?`<span class="attachment-count">附件 ${count} 份</span>`:""}</div><div class="doc-owner">責任：${esc(s.owner||d.owner)}</div><div class="doc-due ${isOverdue(s)?"overdue":""}">${s.due?`${isOverdue(s)?"已逾期 ":"期限 "}${esc(s.due)}`:"期限待設定"}<br><span class="status-pill ${statusClass(s.status)}">${esc(s.status)}</span></div><button class="btn secondary edit-item" data-id="${d.id}" type="button">更新</button></article>`;}).join(""):`<p class="work-notice">這個階段沒有符合篩選條件的項目。</p>`;
  }
  function renderSummary() { const states=docs.map(d=>itemState(d.id)); $("stat-total").textContent=states.length; $("stat-done").textContent=states.filter(s=>["已完成","不適用"].includes(s.status)).length; $("stat-open").textContent=states.filter(s=>!["已完成","不適用"].includes(s.status)).length; $("stat-overdue").textContent=states.filter(isOverdue).length; }
  function renderTemplates() { $("template-list").innerHTML=templates.map(([id,title,desc])=>`<article class="template-card"><h3>${esc(title)}</h3><p>${esc(desc)}</p><div class="template-actions"><button class="btn secondary draft" data-template="${id}" data-format="doc" type="button">Word</button><button class="btn secondary draft" data-template="${id}" data-format="md" type="button">Markdown</button><button class="btn secondary draft" data-template="${id}" data-format="print" type="button">列印／PDF</button></div></article>`).join(""); }
  function render() { populateSelect(); fillForm(); renderSummary(); renderNav(); renderDocs(); renderTemplates(); window.dispatchEvent(new CustomEvent("engineering-project-change",{detail:{id:activeId}})); }
  async function openItem(id) { const d=docs.find(x=>x.id===id), s=itemState(id); editingItem=id; $("item-phase").textContent=phases.find(p=>p.id===d.phase).name; $("item-title").textContent=d.title; $("item-help").textContent=d.help; const f=$("item-form"); f.elements.status.value=s.status; f.elements.owner.value=s.owner||d.owner; f.elements.due.value=s.due||""; f.elements.link.value=s.link||""; f.elements.notes.value=s.notes||""; $("attachment-status").textContent=""; $("item-dialog").showModal(); await renderAttachments(); }
  function saveItem() { const f=$("item-form"), p=current(); p.items[editingItem]={status:f.elements.status.value, owner:f.elements.owner.value.trim(), due:f.elements.due.value, link:f.elements.link.value.trim(), notes:f.elements.notes.value.trim(), updatedAt:new Date().toISOString()}; p.updatedAt=new Date().toISOString(); save(); render(); }
  function download(name, content, type="text/plain;charset=utf-8") { const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
  function sizeLabel(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB`; }
  async function renderAttachments() {
    if (!editingItem || !current()) return;
    try {
      const files=await itemAttachments(current().id,editingItem);
      $("attachment-list").innerHTML=files.length?files.map(file=>`<li><div><strong>${esc(file.name)}</strong><small>${esc(file.type||"未知格式")} · ${sizeLabel(file.size)} · ${esc(new Date(file.createdAt).toLocaleString("zh-TW"))}</small></div><div class="attachment-actions"><button class="download-attachment" data-file-id="${esc(file.id)}" type="button">下載</button><button class="remove-attachment" data-file-id="${esc(file.id)}" type="button">移除</button></div></li>`).join(""):`<li><small>尚未加入附件。你現有的 PDF 可直接放在對應文書項目裡。</small></li>`;
    } catch (error) { $("attachment-list").innerHTML=`<li><small>${esc(error.message)}</small></li>`; }
  }
  async function addAttachmentFiles(fileList) {
    const files=[...fileList]; if (!files.length) return;
    const tooLarge=files.find(file=>file.size>MAX_FILE_SIZE); if (tooLarge) throw new Error(`${tooLarge.name} 超過 100 MB 上限`);
    for (const file of files) await saveAttachment({id:`${current().id}:${editingItem}:${Date.now()}:${Math.random().toString(36).slice(2,7)}`,projectId:current().id,itemId:editingItem,name:file.name,type:file.type||"application/octet-stream",size:file.size,lastModified:file.lastModified,createdAt:new Date().toISOString(),blob:file});
    $("attachment-status").textContent=`已加入 ${files.length} 個附件，檔案只保存在此瀏覽器。`;
    await renderAttachments(); await renderDocs();
  }
  function draftHtml(id,title) { return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:"Microsoft JhengHei",sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.75;color:#17211e}pre{white-space:pre-wrap;font:inherit}h1{color:#12382f}@media print{body{margin:0;max-width:none}}</style></head><body><pre>${esc(draftText(id))}</pre></body></html>`; }
  function printDraft(id,title) { const win=window.open("","_blank"); if (!win) return alert("瀏覽器已阻擋列印視窗，請允許此網站開啟新視窗後重試。"); win.document.open(); win.document.write(draftHtml(id,title)); win.document.close(); win.focus(); setTimeout(()=>win.print(),200); }
  function projectValue(key,label) { const v=current()?.[key]; return v || `【待確認：${label}】`; }
  function draftText(id) { const d=docs.find(x=>x.id===id), s=itemState(id); const common=`# ${d?.title || "工程文件"}\n\n> 草稿產生：${today()}；須改用機關／契約指定格式並人工核對。\n\n- 工程名稱：${projectValue("name","工程名稱")}\n- 主辦機關：${projectValue("agency","主辦機關")}\n- 標案／契約編號：${projectValue("caseNo","契約編號")}\n- 承辦／負責人：${s.owner || current().owner || "【待確認：負責人】"}\n- 文件日期：${today()}\n\n`;
    const bodies={
      "start-notice":"## 通知內容\n\n本工程依契約約定，擬於／已於【待確認：開工日期】開工。相關開工條件與附件如下：\n\n- [ ] 施工計畫／品質計畫核定\n- [ ] 人員報備完成\n- [ ] 保險與履約保證有效\n- [ ] 場地交付／開工條件完成\n\n## 附件\n\n【待確認：附件名稱與份數】",
      "daily-log":"## 今日資訊\n\n- 天候：【待確認】\n- 施工位置／項目：【待確認】\n- 人員：【待確認】\n- 機具：【待確認】\n- 材料進場：【待確認】\n- 今日數量／累計：【待確認】\n- 監造指示與回覆：【待確認】\n- 品質／職安／異常事項：【待確認】\n- 照片編號：【待確認】",
      "material-submittal":"## 送審資料\n\n- 材料／設備名稱：【待確認】\n- 契約規格／圖說位置：【待確認】\n- 廠牌型號／批次：【待確認】\n- 使用位置與預計進場日：【待確認】\n- 型錄、樣品、試驗／證明附件：【待確認】\n- 替代或差異說明：無／【待確認】",
      "inspection-request":"## 查驗申請\n\n- 施工項目與位置：【待確認】\n- 預定查驗日期時間：【待確認】\n- 查驗／停留點依據：【待確認】\n- 自主檢查結果：【待確認】\n- 相關圖說與照片：【待確認】\n- 覆蓋或下一工序時間：【待確認】",
      "rfi":"## 疑義內容\n\n- 圖說／規範／契約位置：【待確認】\n- 現場狀況與問題：【待確認】\n- 建議處理方案：【待確認】\n- 對品質、費用、工期與安全影響：【待確認】\n- 需要回覆期限：【待確認】",
      "progress-payment":"## 本期估驗檢核\n\n- 估驗期別／截止日：【待確認】\n- 前期累計、本期、累計金額：【待確認】\n- 數量計算／測量附件：【待確認】\n- 照片與查驗紀錄：【待確認】\n- 變更／超量／扣款事項：【待確認】\n- 發票及請款附件：【待確認】",
      "change-request":"## 變更提案\n\n- 原契約內容：【待確認】\n- 變更原因與必要性：【待確認】\n- 建議方案及圖說：【待確認】\n- 數量與單價影響：【待確認】\n- 工期與要徑影響：【待確認】\n- 風險／介面／保固影響：【待確認】\n\n> 未取得書面核定前，不應把草稿視為施工授權。",
      "completion-notice":"## 完工通知\n\n本工程於【待確認：實際完工日期】完成契約工作，檢附下列資料，請依契約辦理完工確認／初驗／驗收。\n\n- [ ] 竣工圖\n- [ ] 結算明細與數量總表\n- [ ] 試驗／試運轉紀錄\n- [ ] 操作維護與保固文件\n- [ ] 移交清冊\n- [ ] 其他：【待確認】",
      "precheck":"## 竣工文件盤點\n\n- [ ] 完工通知與送達證明\n- [ ] 核定竣工圖\n- [ ] 結算明細／數量計算\n- [ ] 品質、自主檢查與試驗紀錄\n- [ ] 變更核定文件\n- [ ] 試運轉／功能測試\n- [ ] 操作維護、教育訓練與移交\n- [ ] 保固文件與保證\n- [ ] 初驗／驗收通知及出席授權",
      "defect-correction":"## 缺失改善對照\n\n| 項次 | 原缺失 | 改善方法 | 完成日 | 改善前後照片／附件 | 複驗結果 |\n|---|---|---|---|---|---|\n| 1 | 【待確認】 | 【待確認】 | 【待確認】 | 【待確認】 | 【待確認】 |",
      "repair-record":"## 保固維修紀錄\n\n- 通知／發現日期：【待確認】\n- 缺失位置與狀況：【待確認】\n- 會勘與責任判定：【待確認】\n- 修繕方式、材料及人員：【待確認】\n- 修繕日期：【待確認】\n- 改善前後照片：【待確認】\n- 使用單位／機關確認：【待確認】"
    }; return common+(bodies[id]||"## 內容\n\n【待確認】")+"\n\n## 內部紀錄\n\n"+(s.notes||"【待確認】")+"\n"; }
  function exportCsv() { const rows=[["階段","文件","必備性","預設責任","目前責任","狀態","期限","逾期","連結","備註"],...docs.map(d=>{const s=itemState(d.id);return[phases.find(p=>p.id===d.phase).name,d.title,d.required?"常用必備":"視個案",d.owner,s.owner||"",s.status,s.due||"",isOverdue(s)?"是":"否",s.link||"",s.notes||""];})]; const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\r\n"); download(`工程文書清單-${current().name}-${today()}.csv`,csv,"text/csv;charset=utf-8"); }
  function bind() {
    $("project-select").addEventListener("change",e=>{activeId=e.target.value;save();render();});
    $("new-project").addEventListener("click",()=>{const p=baseProject();projects[p.id]=p;activeId=p.id;save();render();$("project-form").elements.name.focus();});
    $("project-form").addEventListener("submit",e=>{e.preventDefault();const p=current(),f=e.target;["name","agency","caseNo","contractAmount","plannedStart","actualStart","plannedFinish","actualFinish","owner","supervisor","notes"].forEach(k=>p[k]=f.elements[k].value.trim());p.updatedAt=new Date().toISOString();save();render();$("save-status").textContent=`已於 ${new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})} 儲存`;});
    $("phase-nav").addEventListener("click",e=>{const b=e.target.closest("[data-phase]");if(!b)return;activePhase=b.dataset.phase;renderNav();renderDocs();});
    $("status-filter").addEventListener("change",renderDocs);
    $("document-list").addEventListener("click",e=>{const b=e.target.closest(".edit-item");if(b)openItem(b.dataset.id);});
    $("item-form").addEventListener("submit",e=>{e.preventDefault();if(e.submitter?.value==="save"){saveItem();$("item-dialog").close();}else $("item-dialog").close();});
    $("template-list").addEventListener("click",e=>{const b=e.target.closest(".draft");if(!b)return;const id=b.dataset.template,title=templates.find(t=>t[0]===id)[1],base=`${current().name}-${title}-${today()}`;if(b.dataset.format==="doc")download(`${base}.doc`,"\ufeff"+draftHtml(id,title),"application/msword;charset=utf-8");else if(b.dataset.format==="print")printDraft(id,title);else download(`${base}.md`,draftText(id));});
    $("export-csv").addEventListener("click",exportCsv);
    window.addEventListener("engineering-analysis-phase",e=>{const phase=e.detail?.phase;if(!phases.some(item=>item.id===phase))return;activePhase=phase;renderNav();renderDocs();$("workflow").scrollIntoView({behavior:"smooth",block:"start"});});
    window.addEventListener("engineering-analysis-apply",e=>{const detail=e.detail||{},p=current(),analysis=detail.analysis;if(!p||detail.projectId!==p.id||!analysis)return;const marker=`[PDF分析：${analysis.fileName}]`;if((!p.name||p.name==="待命名工程")&&analysis.projectTitle)p.name=analysis.projectTitle;if(analysis.duration?.value&&!p.notes.includes(marker))p.notes=`${p.notes?`${p.notes}\n`:""}${marker}\n辨識工期：${analysis.duration.value}（PDF 第 ${analysis.duration.page} 頁）\n文件類型：${analysis.documentKind}；共 ${analysis.pageCount} 頁。`;p.updatedAt=new Date().toISOString();save();render();$("save-status").textContent="PDF 重點已帶入工程名稱與專案備註；原圖仍須人工核對。";});
    $("attachment-files").addEventListener("change",async e=>{try{await addAttachmentFiles(e.target.files);}catch(err){$("attachment-status").textContent=`無法加入：${err.message}`;}finally{e.target.value="";}});
    $("attachment-list").addEventListener("click",async e=>{const b=e.target.closest("[data-file-id]");if(!b)return;const id=b.dataset.fileId;if(b.classList.contains("download-attachment")){const file=await getAttachment(id);if(file)download(file.name,file.blob,file.type);}else if(confirm("確定從此瀏覽器移除這個附件？原始檔不會被刪除。")){await deleteAttachment(id);await renderAttachments();await renderDocs();}});
    $("export-project").addEventListener("click",async()=>{const manifest=(await projectAttachments(current().id).catch(()=>[])).map(({blob,...file})=>file),documentAnalysis=window.EngineeringPdfAnalysis?.getCurrentAnalysis?.()||null;download(`工程文書專案備份-${current().name}-${today()}.json`,JSON.stringify({version:3,exportedAt:new Date().toISOString(),project:current(),documentAnalysis,attachmentManifest:manifest},null,2),"application/json")});
    $("import-project").addEventListener("change",async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(![1,2,3].includes(data.version)||!data.project?.name||typeof data.project.items!=="object")throw new Error("格式不符");const p={...data.project,id:uid(),updatedAt:new Date().toISOString()};projects[p.id]=p;activeId=p.id;window.EngineeringPdfAnalysis?.importAnalysis?.(p.id,data.documentAnalysis);save();render();alert(data.attachmentManifest?.length?`專案已匯入；備份列有 ${data.attachmentManifest.length} 個附件，但檔案本體須另外加入。`:"備份已匯入為新專案，原資料保留。");}catch(err){alert(`無法匯入：${err.message}`);}finally{e.target.value="";}});
    $("delete-project").addEventListener("click",async()=>{if(Object.keys(projects).length<=1)return alert("至少保留一個專案；可新增空白專案後再刪除。");if(!confirm(`確定刪除「${current().name}」及其本機附件？請先備份，刪除後無法復原。`))return;const removing=activeId;delete projects[activeId];activeId=Object.keys(projects)[0];window.EngineeringPdfAnalysis?.removeAnalysis?.(removing);save();await deleteProjectAttachments(removing).catch(()=>{});render();});
  }
  ensureProject(tenderData());
  bind();
  render();
})();
