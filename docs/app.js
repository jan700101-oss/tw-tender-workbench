/* 標案工務台 — 前端搜尋
 * 資料由 scripts/sync.mjs 產出於 docs/data/:
 *   index.json           同步狀態、月份清單、篩選選項
 *   tenders-YYYY-MM.json 依公告期間月份分片(緊湊陣列格式)
 * 月份檔依查詢範圍延遲載入;所有欄位語意見 index.json 的 notes。
 */
(() => {
  "use strict";

  const PAGE_SIZE = 100;
  const FAV_KEY = "twb.favorites.v2";
  const SEARCH_KEY = "twb.savedSearches.v2";
  const WORK_KEY = "twb.work.v1";
  const BID_STATUS_KEY = "twb.bidStatus.v1";
  const stages = ["評估中", "準備投標", "已送件", "履約中", "驗收保固", "不投標"];
  const taskLabels = ["核對官方公告與更正", "下載投標須知、契約與圖說", "確認資格、證照與實績", "確認現勘與提問期限", "確認押標金與資金", "完成估價與標價清單", "確認用印、封裝、送件時間", "開工、材料送審與施工紀錄", "竣工、驗收與保固文件"];
  const specialistTerms = /工程|營造|土木|建築|室內裝修|裝修工程|施工|施作|補修|修繕|維修|維護|汰換|加固|改善工作|油槽|邊坡|孔蓋|機電|水電|電器承裝|消防|空調|電梯|昇降|鍋爐|瓦斯|天然氣|管線|監造|技師|建築師|測量|測繪|地質|鑽探|結構|耐震|職業安全|安裝服務|設備安裝|檢修|專業服務|調查|研究|諮詢|顧問|檢驗|檢測|稽核|查核|鑑定|認證|醫療器材|醫療設備|血壓|血氧|手術|護理|照護|社工|托育|藥品|藥劑|疫苗|試劑|抗體|放射|保全|警衛|旅行|旅遊|戶外教育|校外教學|考察|參訪|體驗營|廢棄物|清運|病媒|農藥|獸醫|拖吊|槍|彈藥|火藥|砲|爆裂物/;

  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $("sync-banner"),
    headerStatus: $("header-data-status"),
    statOpen: $("stat-open"),
    statToday: $("stat-today"),
    statUrgent: $("stat-urgent"),
    statEngineering: $("stat-engineering"),
    statGeneralAll: $("stat-general-all"),
    statGeneralGoods: $("stat-general-goods"),
    statGeneralServices: $("stat-general-services"),
    deadlineToday: $("stat-deadline-today"),
    deadlineTomorrow: $("stat-deadline-tomorrow"),
    urgentSummary: $("urgent-summary-count"),
    q: $("q"),
    profile: $("f-profile"),
    attr: $("f-attr"),
    qualification: $("f-qualification"),
    method: $("f-method"),
    region: $("f-region"),
    regionIncludeUnknown: $("f-region-unknown"),
    agency: $("f-agency"),
    caseNumber: $("f-case-number"),
    range: $("f-range"),
    customDates: $("custom-dates"),
    start: $("f-start"),
    end: $("f-end"),
    announcementDay: $("f-announcement-day"),
    sort: $("f-sort"),
    budget: $("f-budget"),
    deadline: $("f-deadline"),
    retender: $("f-retender"),
    open: $("f-open"),
    saveSearch: $("btn-save-search"),
    clear: $("btn-clear"),
    savedChips: $("saved-chips"),
    tabAll: $("tab-all"),
    tabFav: $("tab-fav"),
    favCount: $("fav-count"),
    resultsHeading: $("results-heading"),
    count: $("result-count"),
    results: $("results"),
    detailDialog: $("detail-dialog"),
    detailContent: $("detail-content"),
    more: $("btn-more"),
    empty: $("empty-state"),
    footerSync: $("footer-sync"),
  };

  let meta = null;
  let openMeta = null;
  let validation = null;
  const monthCache = new Map(); // "YYYY-MM" -> records[]
  let currentTab = "all";
  let shown = 0;
  let filtered = [];
  let openTenders = [];
  let loadToken = 0;

  // ---------- 儲存(localStorage) ----------
  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { alert("瀏覽器無法保存資料，請立即匯出備份；關閉頁面後可能遺失變更。"); return false; }
  }
  let favorites = loadJson(FAV_KEY, {});        // key -> record
  let savedSearches = loadJson(SEARCH_KEY, []); // [{name, state}]
  let work = loadJson(WORK_KEY, {});
  let bidStatuses = loadJson(BID_STATUS_KEY, {}); // key -> {status, checkedAt}
  if (!favorites || typeof favorites !== "object" || Array.isArray(favorites)) favorites = {};
  if (!Array.isArray(savedSearches)) savedSearches = [];
  if (!work || typeof work !== "object" || Array.isArray(work)) work = {};
  if (!bidStatuses || typeof bidStatuses !== "object" || Array.isArray(bidStatuses)) bidStatuses = {};

  function recordKey(r) {
    return [r.kind, r.agency, r.caseNo].join("|");
  }
  favorites = Object.fromEntries(Object.values(favorites).filter(r => r && r.caseNo && r.agency).map(r => [recordKey(r), r]));

  // ---------- 資料載入 ----------
  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return res.json();
  }

  function fromRow(columns, row) {
    const r = {};
    columns.forEach((c, i) => { r[c] = row[i] === "" ? (c === "deadline" ? null : "") : row[i]; });
    return r;
  }

  async function loadMonth(month) {
    if (monthCache.has(month)) return monthCache.get(month);
    try {
      const part = await fetchJson(`data/tenders-${month}.json`);
      const records = (part.rows || []).map((row) => fromRow(part.columns, row));
      monthCache.set(month, records);
      return records;
    } catch (error) {
      throw new Error(`歷史月份 ${month} 載入失敗，請重試。${error.message}`);
    }
  }

  /** 依目前期間條件決定需要的月份 */
  function monthsForState(s) {
    const available = (meta.months || []).map((m) => m.month).sort().reverse(); // 新→舊
    if (s.range === "custom") {
      const from = (s.start || "0000-01").slice(0, 7);
      const to = (s.end || "9999-12").slice(0, 7);
      return available.filter((m) => m >= from && m <= to);
    }
    if (s.range === "all") return available;
    const n = parseInt(s.range, 10); // 月數
    return available.slice(0, n);
  }

  // ---------- 同步狀態 ----------
  function fmtTime(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  }

  const numberFormat = new Intl.NumberFormat("zh-TW");

  function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function budgetNumber(value) {
    const digits = String(value || "").replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }

  function formatBudget(value) {
    const amount = budgetNumber(value);
    return amount ? `NT$ ${numberFormat.format(amount)}` : "未提供";
  }
  function matchesBudget(r, filter) {
    if (!filter) return true;
    const amount=budgetNumber(r.budget);
    if (filter==="missing") return amount===0;
    if (filter.includes(":")) {
      if (!amount) return false;
      const [minRaw,maxRaw]=filter.split(":");
      const min=Number(minRaw)||0, max=Number(maxRaw)||0;
      return (!min||amount>min) && (!max||amount<=max);
    }
    return amount>0 && amount<=Number(filter);
  }

  function qualificationGroup(r) {
    const text = `${r.title || ""} ${r.method || ""}`;
    if (r.attr === "工程類" || specialistTerms.test(text)) return "specialist";
    if (r.attr === "財物類") return "general-goods";
    if (r.attr === "勞務類") return "general-services";
    return "specialist";
  }

  function isGeneralBusinessCandidate(r) {
    return qualificationGroup(r).startsWith("general-");
  }

  const myRegions = new Set(["彰化縣", "臺中市", "南投縣", "雲林縣"]);
  const interiorTerms = /室內|裝修|整修|修繕|改造|空間改善|廁所|辦公空間|教學環境|活動中心|防水|地坪|牆面|天花板|門窗|隔間|油漆|塗裝|校舍|教室/;
  const excludedCivilTerms = /道路|路面|野溪|護岸|排水|下水道|橋梁|邊坡|擋土|水利|河川|農路|災害復建/;

  function isMyOpportunity(r) {
    const title = r.title || "";
    if (!myRegions.has(r.region)) return false;
    if (!interiorTerms.test(title)) return false;
    if (excludedCivilTerms.test(title) && !/室內|裝修|整修|廁所|辦公|教室|校舍|圖書館/.test(title)) return false;
    return r.attr === "工程類" || r.attr === "勞務類" || /設計|監造/.test(title);
  }

  function chineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (digits[value]) return digits[value];
    if (value.startsWith("十")) return 10 + (digits[value.slice(1)] || 0);
    if (value.endsWith("十")) return (digits[value[0]] || 0) * 10;
    if (value.includes("十")) return (digits[value[0]] || 0) * 10 + (digits[value.slice(2)] || 0);
    return 0;
  }

  function retenderInfo(r) {
    const cached = bidStatuses[recordKey(r)]?.status || "";
    const official = cached.match(/第\s*0*([0-9]+)\s*次/) || cached.match(/第\s*([一二三四五六七八九十]+)\s*次/);
    if (official) return { round: chineseNumber(official[1]), source: "official", label: cached };
    const title = r.title || "";
    const explicit = title.match(/第\s*0*([0-9]+)\s*次\s*(?:公開)?招標/) || title.match(/第\s*([一二三四五六七八九十]+)\s*次\s*(?:公開)?招標/);
    if (explicit) return { round: chineseNumber(explicit[1]), source: "title", label: `案名顯示第 ${chineseNumber(explicit[1])} 次招標` };
    const suffix = title.match(/[（(](?:第)?\s*([一二三四五六七八九十0-9]+)\s*次[）)]\s*$/);
    if (suffix) return { round: chineseNumber(suffix[1]), source: "title", label: `案名顯示第 ${chineseNumber(suffix[1])} 次` };
    if (/(?:重新|重行)招標/.test(title)) return { round: 2, source: "title", label: "案名顯示重新招標" };
    return { round: 0, source: "none", label: "" };
  }

  const quickBudgetBands=[
    {label:"50 萬以下",min:0,max:500000},
    {label:"50～100 萬",min:500000,max:1000000},
    {label:"100～250 萬",min:1000000,max:2500000},
    {label:"250～500 萬",min:2500000,max:5000000},
    {label:"500～1,000 萬",min:5000000,max:10000000},
    {label:"1,000～5,000 萬",min:10000000,max:50000000},
    {label:"5,000 萬～1 億",min:50000000,max:100000000},
    {label:"1 億～10 億",min:100000000,max:1000000000},
    {label:"10 億以上",min:1000000000,max:0}
  ];
  const quickKeywords=["整修","防水","廁所","教室","校舍","辦公室","屋頂","室內裝修"];
  function renderQuickNavChips(id,items,type) {
    const target=$(id); if(!target)return;
    target.textContent="";
    for(const item of items) {
      const button=document.createElement("button");
      button.type="button";button.className="quick-nav-chip";
      button.dataset.navType=type;button.dataset.navValue=item.value;
      button.setAttribute("aria-pressed","false");
      const label=document.createElement("span");label.textContent=item.label;
      const count=document.createElement("small");count.textContent=numberFormat.format(item.count||0);
      button.append(label,count);target.appendChild(button);
    }
  }
  function renderQuickNavigation() {
    const regions=[...new Set(openTenders.map(r=>r.region).filter(Boolean))];
    const preferred=["彰化縣","臺中市","南投縣","雲林縣"];
    const regionItems=[{label:"全台地區",value:"",count:openTenders.length},
      ...preferred.filter(value=>regions.includes(value)).map(value=>({label:value,value,count:openTenders.filter(r=>r.region===value).length})),
      ...regions.filter(value=>!preferred.includes(value)).sort((a,b)=>a.localeCompare(b,"zh-Hant")).map(value=>({label:value,value,count:openTenders.filter(r=>r.region===value).length}))];
    renderQuickNavChips("quick-nav-region",regionItems,"region");
    const budgetItems=quickBudgetBands.map(band=>{
      const filter=band.max?String(band.min)+":"+String(band.max):String(band.min)+":";
      return {label:band.label,value:filter,count:openTenders.filter(r=>matchesBudget(r,filter)).length};
    });
    budgetItems.push({label:"未提供金額",value:"missing",count:openTenders.filter(r=>!budgetNumber(r.budget)).length});
    renderQuickNavChips("quick-nav-budget",budgetItems,"budget");
    const dateCounts=new Map();
    for(const row of openTenders)if(row.periodStart)dateCounts.set(row.periodStart,(dateCounts.get(row.periodStart)||0)+1);
    const dateItems=[...dateCounts.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8).map(([value,count])=>({value,label:new Date(value+"T00:00:00").toLocaleDateString("zh-TW",{month:"2-digit",day:"2-digit"}),count}));
    renderQuickNavChips("quick-nav-date",dateItems,"date");
    const keywordRows=openTenders;
    const keywordItems=quickKeywords.map(value=>({value,label:value,count:keywordRows.filter(r=>(r.title||"").includes(value)).length})).filter(item=>item.count>0).sort((a,b)=>b.count-a.count).slice(0,8);
    renderQuickNavChips("quick-nav-keyword",keywordItems,"keyword");
    const categoryCounts=new Map();
    for(const row of openTenders)if(row.attr)categoryCounts.set(row.attr,(categoryCounts.get(row.attr)||0)+1);
    renderQuickNavChips("quick-nav-category",[...categoryCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([value,count])=>({value,label:value,count})),"category");
    const agencyRows=openTenders,agencyCounts=new Map();
    for(const row of agencyRows)if(row.agency)agencyCounts.set(row.agency,(agencyCounts.get(row.agency)||0)+1);
    const agencyItems=[...agencyCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"zh-Hant")).slice(0,8).map(([value,count])=>({value,label:value,count}));
    renderQuickNavChips("quick-nav-agency",agencyItems,"agency");
  }
  function applyQuickNavigation(type,value) {
    const next={profile:"",attr:"",qualification:"",method:"",region:"",agency:"",range:"3",start:"",end:"",sort:"deadline-asc",budget:"",deadlineWindow:"",retender:"",openOnly:true};
    if(type==="region")next.region=value;
    else if(type==="budget")next.budget=value;
    else if(type==="date"){next.announcementDay=value;next.deadlineWindow="";}
    else if(type==="keyword")next.q=value;
    else if(type==="category")next.attr=value;
    else if(type==="agency")next.agency=value;
    document.querySelectorAll(".quick-nav-group").forEach(group=>group.open=false);
    setFilterState(next);
    switchTab("all");
    $("results-heading").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function renderStats() {
    const today = todayIso();
    const current = openTenders.filter((r) => r.deadline >= today);
    const todayRows = current.filter((r) => r.deadline === today);
    const tomorrowRows = current.filter((r) => r.deadline === addDays(today, 1));
    els.statOpen.textContent = numberFormat.format(current.length);
    els.statToday.textContent = numberFormat.format(current.filter((r) => r.periodStart === today).length);
    els.statUrgent.textContent = numberFormat.format(current.filter((r) => r.deadline <= addDays(today, 4)).length);
    els.deadlineToday.textContent = numberFormat.format(todayRows.length);
    els.deadlineTomorrow.textContent = numberFormat.format(tomorrowRows.length);
    els.urgentSummary.textContent = `${numberFormat.format(todayRows.length + tomorrowRows.length)} 件`;
    els.statEngineering.textContent = numberFormat.format(current.filter((r) => r.attr === "工程類").length);
    els.statGeneralGoods.textContent = numberFormat.format(current.filter((r) => qualificationGroup(r) === "general-goods").length);
    els.statGeneralServices.textContent = numberFormat.format(current.filter((r) => qualificationGroup(r) === "general-services").length);
    els.statGeneralAll.textContent = numberFormat.format(current.filter(isGeneralBusinessCandidate).length);
    renderDeadlineGroups(current, today);
  }

  function renderDeadlineGroups(current, today) {
    const groups = [
      { window: "0-4", title: "5 天內截止提醒", test: r => r.deadline <= addDays(today, 4), note: "包含今天截止；請先核對官方送件時間" },
      { window: "5-plus", title: "剩 5 天以上", test: r => r.deadline >= addDays(today, 5), note: "目前仍未截止，依截止日排序" },
    ];
    $("deadline-groups").innerHTML = groups.map(g => {
      const allRows = current.filter(g.test).sort((a,b) => a.deadline.localeCompare(b.deadline));
      const rows = allRows.slice(0,3);
      return `<article class="deadline-group"><button type="button" class="deadline-group-select" data-window="${g.window}" data-profile=""><span>${g.title}</span><strong>${numberFormat.format(allRows.length)} 件</strong><small>${g.note} · 查看清單 →</small></button><ul>${rows.map(r => `<li><a href="${escapeHtml(officialSearchUrl(r))}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a><small>${escapeHtml(r.agency)} · ${escapeHtml(r.region || "地區未明")}</small><span class="deadline-days ${deadlineInfo(r,today).cls}">${escapeHtml(deadlineInfo(r,today).label)}</span></li>`).join("") || "<li>目前沒有符合的案件</li>"}</ul></article>`;
    }).join("");
    $("deadline-groups").querySelectorAll("[data-window]").forEach(button => {
      button.addEventListener("click", () => {
        setFilterState({ profile: "", deadlineWindow: button.dataset.window, openOnly: true, sort: "deadline-asc" });
        switchTab("all");
        $("results-heading").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderSyncStatus() {
    if (openMeta) {
      els.headerStatus.textContent = `更新 ${fmtTime(openMeta.generatedAt)}`;
      els.footerSync.textContent = `可投標案源更新：${fmtTime(openMeta.generatedAt)}（台北時間） · 官方清單 ${numberFormat.format(openMeta.officialResultCount || 0)} 筆 · 本站有效 ${numberFormat.format(openMeta.count || 0)} 筆 · 筆數差 ${numberFormat.format(Math.abs((openMeta.officialResultCount || 0) - (openMeta.count || 0)))} · 官方抽驗 ${validation?.officialRowsPassed || 0}/${validation?.officialRowsRequested || 0}`;
      const staleHours = (Date.now() - new Date(openMeta.generatedAt).getTime()) / 3600000;
      const histAttempt = meta && meta.lastAttempt;
      const histFailed = histAttempt && histAttempt.status !== "success";
      if (!validation?.passed) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = "目前資料尚未通過官方公告驗證，請勿作為投標依據。";
      } else if (openMeta.officialResultCount !== openMeta.count) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = `官方查詢 ${numberFormat.format(openMeta.officialResultCount || 0)} 筆，本站有效 ${numberFormat.format(openMeta.count || 0)} 筆，差 ${numberFormat.format(Math.abs((openMeta.officialResultCount || 0) - (openMeta.count || 0)))} 筆；同步完整性未確認，請以官方清單為準。`;
      else if (staleHours > 48) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner danger";
        els.banner.textContent = "可投標案源超過 48 小時未更新，資料可能過期，請先以政府電子採購網公告為準。";
      } else if (staleHours > 24) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = "可投標案源超過 24 小時未更新，請留意資料時間並核對政府電子採購網。";
      } else if (histFailed) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = `⚠ 歷史資料最近一次同步失敗(${fmtTime(histAttempt.at)}):${histAttempt.error || "未知錯誤"}。可投標案源不受影響,歷史檢視顯示上一版資料。`;
      } else {
        els.banner.hidden = true;
      }
      return;
    }
    const ok = meta.lastSuccess;
    const attempt = meta.lastAttempt;
    const failed = attempt && attempt.status !== "success";
    let staleDays = null;
    if (ok) staleDays = Math.floor((Date.now() - new Date(ok.at).getTime()) / 86400000);

    if (ok) {
      els.headerStatus.textContent = `更新 ${fmtTime(ok.at)}`;
      els.footerSync.textContent =
        `最後成功同步:${fmtTime(ok.at)}(台北時間) · 共 ${ok.totalRecords} 筆 · 涵蓋 ${meta.months.length} 個月份`;
    }
    if (failed) {
      els.banner.hidden = false;
      els.banner.className = "sync-banner warn";
      els.banner.textContent = `⚠ 最近一次同步失敗(${fmtTime(attempt.at)}):${attempt.error || "未知錯誤"}。目前顯示上一版資料。`;
    } else if (staleDays !== null && staleDays >= 2) {
      els.banner.hidden = false;
      els.banner.className = "sync-banner warn";
      els.banner.textContent = `⚠ 資料已 ${staleDays} 天未更新,最後成功同步:${fmtTime(ok.at)}。`;
    } else if (attempt && attempt.daily && attempt.daily.status === "failed") {
      els.banner.hidden = false;
      els.banner.className = "sync-banner warn";
      els.banner.textContent = `⚠ 每日完整公告來源同步失敗(${attempt.daily.error || "未知錯誤"}),近期公告可能不完整;官方半月檔資料不受影響。`;
    } else {
      els.banner.hidden = true;
    }
  }

  // ---------- 篩選 ----------
  function todayIso() {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
  }

  function getFilterState() {
    return {
      q: els.q.value.trim(),
      profile: els.profile.value,
      attr: els.attr.value,
      qualification: els.qualification.value,
      method: els.method.value,
      region: els.region.value,
      regionIncludeUnknown: els.regionIncludeUnknown.checked,
      agency: els.agency.value.trim(),
      caseNumber: els.caseNumber.value.trim(),
      range: els.range.value,
      start: els.start.value,
      end: els.end.value,
      announcementDay: els.announcementDay.value,
      sort: els.sort.value,
      budget: els.budget.value,
      deadlineWindow: els.deadline.value,
      retender: els.retender.value,
      openOnly: els.open.checked,
    };
  }

  function setFilterState(s) {
    els.q.value = s.q || "";
    els.profile.value = s.profile ?? "";
    els.attr.value = s.attr || "";
    els.qualification.value = s.qualification || "";
    els.method.value = s.method || "";
    els.region.value = s.region || "";
    els.regionIncludeUnknown.checked = s.regionIncludeUnknown !== false;
    els.agency.value = s.agency || "";
    els.caseNumber.value = s.caseNumber || "";
    els.range.value = s.range || "3";
    els.start.value = s.start || "";
    els.end.value = s.end || "";
    els.announcementDay.value = s.announcementDay || "";
    els.sort.value = s.sort || "deadline-asc";
    els.budget.value = s.budget || "";
    els.deadline.value = s.deadlineWindow ?? "";
    els.retender.value = s.retender || "";
    els.open.checked = s.openOnly !== false;
    els.customDates.hidden = els.range.value !== "custom";
    updateQuickCategoryState();
    updateQuickNavigationState();
  }

  function updateQuickCategoryState() {
    document.querySelectorAll(".quick-category").forEach((button) => {
      const active = !els.profile.value && !els.qualification.value && button.dataset.attr === els.attr.value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateQuickNavigationState() {
    if (!els.announcementDay) return;
    const state=getFilterState();
    document.querySelectorAll(".quick-nav-chip").forEach(button=>{
      const type=button.dataset.navType,value=button.dataset.navValue;
      const active=type==="region"?state.region===value&&!!value:
        type==="budget"?state.budget===value:
        type==="date"?state.announcementDay===value:
        type==="keyword"?state.q===value:
        type==="category"?state.attr===value:
        type==="agency"?state.agency===value:false;
      button.setAttribute("aria-pressed",String(active));
    });
  }

  async function applyFilters() {
    updateQuickNavigationState();
    const token = ++loadToken;
    let s = getFilterState();
    if (s.caseNumber) {
      els.profile.value = "";
      els.range.value = "all";
      els.start.value = "";
      els.end.value = "";
      els.customDates.hidden = true;
      els.deadline.value = "";
      els.open.checked = false;
      s = getFilterState();
    }
    const caseNeedle = String(s.caseNumber || "").toUpperCase().replace(/[\s\-‐‑‒–—]/g, "");
    const today = todayIso();
    if (s.deadlineWindow === "0-0") els.resultsHeading.textContent = "今天截止案件（僅供核對）";
    else if (s.deadlineWindow === "0-4") els.resultsHeading.textContent = "5 天內截止提醒";
    else if (s.deadlineWindow === "5-plus") els.resultsHeading.textContent = "5 天以上可準備案件";
    else if (s.deadlineWindow === "1-1") els.resultsHeading.textContent = "明天截止案件（剩 1 天）";
    else if (s.retender) els.resultsHeading.textContent = s.retender === "3-plus" ? "第 3 次以上招標觀察" : "重招觀察案件";
    else if (s.profile === "my") els.resultsHeading.textContent = "我的案源（目前未截止）";
    else if (s.deadlineWindow === "14-plus") els.resultsHeading.textContent = "來得及準備的標案";
    else els.resultsHeading.textContent = "標案搜尋結果";

    let source;
    if (currentTab === "fav") {
      source = Object.values(favorites);
    } else if (s.openOnly) {
      source = openTenders;
    } else {
      const hasCurrentMatch = Boolean(caseNeedle) && openTenders.some((r) =>
        String(r.caseNo || "").toUpperCase().replace(/[\s\-‐‑‒–—]/g, "").includes(caseNeedle));
      if (hasCurrentMatch) {
        source = openTenders;
      } else {
        const months = monthsForState(s);
        const missing = months.filter((m) => !monthCache.has(m));
        if (missing.length) {
          els.count.textContent = "載入資料中…";
          try { await Promise.all(missing.map(loadMonth)); }
          catch (error) { if (token === loadToken) { els.results.textContent = ""; els.count.textContent = ""; showEmpty(error.message); } return; }
          if (token !== loadToken) return; // 已有更新的查詢
        }
        source = [];
        for (const m of months) source.push(...(monthCache.get(m) || []));
      }
    }

    if (s.caseNumber && currentTab !== "fav") {
      const combined = new Map(source.map((r) => [`${r.agency}|${r.caseNo}`, r]));
      for (const r of openTenders) combined.set(`${r.agency}|${r.caseNo}`, r);
      source = [...combined.values()];
    }

    const terms = s.q.split(/\s+/).filter(Boolean);
    const include = terms.filter((t) => !t.startsWith("-")).map((t) => t.toLowerCase());
    const exclude = terms.filter((t) => t.startsWith("-") && t.length > 1).map((t) => t.slice(1).toLowerCase());
    const agencyQ = s.agency.toLowerCase();
    const minDate = s.range === "custom" ? (s.start || null) : null;
    const maxDate = s.range === "custom" ? (s.end || null) : null;
    if (minDate && maxDate && minDate > maxDate) { els.results.textContent = ""; els.count.textContent = ""; showEmpty("開始日期不能晚於結束日期。"); return; }

    filtered = source.filter((r) => {
      if (s.deadlineWindow) {
        if (!r.deadline || r.deadline < today) return false;
        const [rawMin, rawMax] = s.deadlineWindow.split("-");
        const minDays = Number(rawMin);
        const maxDays = rawMax === "plus" || s.deadlineWindow === "2-months" ? null : Number(rawMax);
        if (s.deadlineWindow === "5-plus" && r.deadline < addDays(today, 5)) return false;
        if (s.deadlineWindow === "2-months" && r.deadline > twoMonthsAfter(today)) return false;
        if (r.deadline < addDays(today, minDays)) return false;
        if (maxDays !== null && r.deadline > addDays(today, maxDays)) return false;
      }
      if (s.profile === "my" && !isMyOpportunity(r)) return false;
      const reoffer = retenderInfo(r);
      if (s.retender === "2-plus" && reoffer.round < 2) return false;
      if (s.retender === "3-plus" && reoffer.round < 3) return false;
      if (s.attr && r.attr !== s.attr) return false;
      const group = qualificationGroup(r);
      if (s.qualification === "general" && !isGeneralBusinessCandidate(r)) return false;
      if (s.qualification && s.qualification !== "general" && group !== s.qualification) return false;
      if (s.budget && !matchesBudget(r, s.budget)) return false;
      if (s.method && r.method !== s.method) return false;
      if (s.region && r.region !== s.region && !(s.regionIncludeUnknown && r.region === "地區未明")) return false;
      if (agencyQ && !r.agency.toLowerCase().includes(agencyQ)) return false;
      if (s.caseNumber) {
        const caseValue = String(r.caseNo || "").toUpperCase().replace(/[\s\-‐‑‒–—]/g, "");
        if (!caseNeedle || !caseValue.includes(caseNeedle)) return false;
      }
      if (s.announcementDay && r.periodStart !== s.announcementDay) return false;
      if (minDate && r.periodEnd < minDate) return false;
      if (maxDate && r.periodStart > maxDate) return false;
      if (s.openOnly && currentTab !== "fav") { // 收藏分頁永遠顯示全部收藏
        if (!(r.deadline && r.deadline >= today)) return false;
      }
      if (include.length || exclude.length) {
        const hay = `${r.title} ${r.caseNo} ${r.agency}`.toLowerCase();
        for (const t of include) if (!hay.includes(t)) return false;
        for (const t of exclude) if (hay.includes(t)) return false;
      }
      return true;
    });

    if (s.sort === "deadline-asc") {
      filtered.sort((a, b) => {
        if (!a.deadline && !b.deadline) return a.periodStart < b.periodStart ? 1 : -1;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
      });
    } else if (s.sort === "budget-desc") {
      filtered.sort((a, b) => budgetNumber(b.budget) - budgetNumber(a.budget) ||
        b.periodStart.localeCompare(a.periodStart));
    } else {
      filtered.sort((a, b) =>
        a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 :
        (a.deadline || "") < (b.deadline || "") ? -1 : 1);
    }

    shown = 0;
    els.results.textContent = "";
    renderMore();
    renderCount();
  }

  // ---------- 呈現 ----------
  function officialSearchUrl(r) {
    if (r.officialUrl) return r.officialUrl;
    const p = new URLSearchParams({
      firstSearch: "true", searchType: "basic",
      tenderType: "TENDER_DECLARATION", tenderWay: "TENDER_WAY_ALL_DECLARATION",
      dateType: "isDate", tenderId: r.caseNo,
    });
    return `https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic?${p}`;
  }

  function isDailyRecord(r) {
    return r.sourceFile?.startsWith("api:") || false;
  }

  function sourceFileUrl(r) {
    if (isDailyRecord(r)) {
      return `https://pcc-api.openfun.app/api/listbydate?date=${r.sourceFile.slice(4)}`;
    }
    return `https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=${encodeURIComponent(r.sourceFile)}`;
  }

  function sourceLabel(r) {
    return isDailyRecord(r) ? `每日API ${r.periodStart}` : r.sourceFile;
  }

  function periodLabel(r) {
    const [y, m, d1] = r.periodStart.split("-");
    if (r.periodStart === r.periodEnd) return `公告日 ${y}/${m}/${d1}`;
    const d2 = r.periodEnd.split("-")[2];
    return `公告期間 ${y}/${m}/${Number(d1)}–${Number(d2)}`;
  }

  function twoMonthsAfter(iso) {
    const date = new Date(`${iso}T00:00:00Z`);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 2);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
  }

  function deadlineInfo(r, today) {
    if (!r.deadline) return { date: "詳情確認", label: isDailyRecord(r) ? "截止日見詳情" : "截止日未提供", cls: "" };
    const days = Math.round((new Date(`${r.deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    if (days < 0) return { date: r.deadline, label: `已截止 ${Math.abs(days)} 天`, cls: "closed" };
    if (days === 0) return { date: r.deadline, label: "今天截止", cls: "urgent" };
    if (days >= 14 && days <= 21) return { date: r.deadline, label: `剩 ${days} 天 · 2～3 週準備期`, cls: "planning" };
    if (days <= 5) return { date: r.deadline, label: `剩 ${days} 天 · 優先處理`, cls: "urgent" };
    return { date: r.deadline, label: `剩 ${days} 天`, cls: "" };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function lookupBidStatus(r) {
    const searchRes = await fetch(`https://pcc-api.openfun.app/api/searchbytitle?query=${encodeURIComponent(r.title)}`, { signal: AbortSignal.timeout(20000) });
    if (!searchRes.ok) throw new Error(`搜尋 API ${searchRes.status}`);
    const search = await searchRes.json();
    const hit = search.records?.find((x) => x.job_number === r.caseNo && (!x.unit_name || x.unit_name === r.agency))
      || search.records?.find((x) => x.job_number === r.caseNo);
    if (!hit?.unit_id) throw new Error("找不到相符的單案資料");
    const detailRes = await fetch(`https://pcc-api.openfun.app/api/tender?unit_id=${encodeURIComponent(hit.unit_id)}&job_number=${encodeURIComponent(r.caseNo)}`, { signal: AbortSignal.timeout(20000) });
    if (!detailRes.ok) throw new Error(`詳情 API ${detailRes.status}`);
    const payload = await detailRes.json();
    const notices = (payload.records || [])
      .filter((x) => x.detail?.["招標資料:招標狀態"])
      .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    const status = notices[0]?.detail?.["招標資料:招標狀態"];
    if (!status) throw new Error("官方公告未提供招標狀態");
    return { status, payload, notice: notices[0] };
  }

  async function hydrateRetenderStatuses() {
    const queue = openTenders.filter((r) => {
      const info = retenderInfo(r);
      return info.source === "title" && info.round >= 2 && !bidStatuses[recordKey(r)];
    }).slice(0, 12);
    if (!queue.length) return;
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const r = queue[cursor++];
        try {
          const result = await lookupBidStatus(r);
          bidStatuses[recordKey(r)] = { status: result.status, checkedAt: new Date().toISOString() };
        } catch (error) {
          console.warn(`招標輪次自動核對失敗：${r.caseNo}`, error);
        }
      }
    }
    await Promise.all([worker(), worker()]);
    saveJson(BID_STATUS_KEY, bidStatuses);
    renderStats();
    await applyFilters();
  }

  function renderMore() {
    const today = todayIso();
    const batch = filtered.slice(shown, shown + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const r of batch) {
      const key = recordKey(r);
      const deadline = deadlineInfo(r, today);
      const bidStatus = bidStatuses[key]?.status || "";
      const reoffer = retenderInfo(r);
      const bidStatusText = bidStatus || (reoffer.source === "title" ? `${reoffer.label} · 查官方` : "查官方招標輪次");
      const li = document.createElement("li");
      li.className = "card";
      const regionBadge = r.region && r.region !== "地區未明"
        ? `<span class="badge region">${escapeHtml(r.region)}（推定）</span>` : "";
      const item = work[key];
      const tracking = item ? `<p class="tracking-note">${escapeHtml(item.stage)} · 負責人：${escapeHtml(item.owner || "待確認")} · ${item.tasks?.length || 0}/${taskLabels.length} 項完成${item.followUp ? ` · <span class="${item.followUp < today ? "overdue" : ""}">追蹤 ${escapeHtml(item.followUp)}${item.followUp < today ? "（逾期）" : ""}</span>` : " · 追蹤日期待確認"}</p>` : "";
      const qualification = qualificationGroup(r);
      const qualificationBadge = qualification === "general-goods"
        ? '<span class="badge qualification">一般商業初篩 · 商品</span>'
        : qualification === "general-services"
          ? '<span class="badge qualification caution">一般商業初篩 · 勞務須複核</span>'
          : "";
      li.innerHTML = `
        <div class="card-main">
          <div class="card-kicker">
            <span>${escapeHtml(r.agency || "機關未提供")}</span><span aria-hidden="true">·</span>
            <span class="case-no">案號 <button class="copy" type="button" data-copy="${escapeHtml(r.caseNo)}" title="複製案號">${escapeHtml(r.caseNo)} ⧉</button></span>
          </div>
          <div class="card-title-row">
            <a class="title" href="${officialSearchUrl(r)}" target="_blank" rel="noopener">${escapeHtml(r.title || "未命名標案")}</a>
            <button class="fav ${favorites[key] ? "on" : ""}" type="button" title="${favorites[key] ? "取消收藏" : "收藏標案"}" aria-label="${favorites[key] ? "取消收藏" : "收藏"} ${escapeHtml(r.title)}" aria-pressed="${!!favorites[key]}" data-key="${escapeHtml(key)}">★</button>
          </div>
          <div class="card-meta">
            <span class="badge attr">${escapeHtml(r.attr || "未分類")}</span>
            ${qualificationBadge}
            <span class="badge">${escapeHtml(r.method || "招標方式未提供")}</span>
            ${regionBadge}
            <span class="badge">${periodLabel(r)}</span>
            ${r.transmissionCount ? `<span class="badge transmission" title="公告更正／傳輸版本，不等同招標輪次">公告傳輸 ${escapeHtml(r.transmissionCount)}</span>` : ""}
            <button class="badge bid-status ${bidStatus ? "loaded" : reoffer.source === "title" ? "observed" : ""}" type="button" data-bid-status="${escapeHtml(key)}" title="${reoffer.source === "title" ? "依案名辨識，尚未確認先前是否流標；按此讀取官方招標狀態" : "讀取單案公告的官方招標狀態"}">${escapeHtml(bidStatusText)}</button>
          </div>
          <div class="card-links">
            <button class="detail-trigger" type="button" data-work="${escapeHtml(key)}">投標工作清單${work[key] ? ` · ${escapeHtml(work[key].stage)}` : ""}</button>
            ${r.officialUrl
              ? `<a class="primary-link" href="${officialSearchUrl(r)}" target="_blank" rel="noopener">查看政府原始公告 ↗</a>`
              : `<button class="detail-trigger" type="button" data-case="${escapeHtml(r.caseNo)}" data-title="${escapeHtml(r.title)}" data-agency="${escapeHtml(r.agency)}">查看完整詳情</button><a href="${officialSearchUrl(r)}" target="_blank" rel="noopener">官方查詢 ↗</a>`}
            ${r.sourceFile?.endsWith(".xml") || isDailyRecord(r) ? `<a href="${sourceFileUrl(r)}" target="_blank" rel="noopener">檢視資料來源</a>` : ""}
          </div>
          ${tracking}
        </div>
        <aside class="card-decision" aria-label="案件時程與預算">
          <div><span class="decision-label">截止投標</span><strong class="deadline-date">${escapeHtml(deadline.date)}</strong><span class="deadline-days ${deadline.cls}">${escapeHtml(deadline.label)}</span></div>
          <div class="budget"><span class="decision-label">採購預算</span><strong>${escapeHtml(formatBudget(r.budget))}</strong></div>
        </aside>`;
      frag.appendChild(li);
    }
    els.results.appendChild(frag);
    shown += batch.length;
    els.more.hidden = shown >= filtered.length;
    els.more.textContent = `載入更多(還有 ${filtered.length - shown} 筆)`;
  }

  function renderCount() {
    const favN = Object.keys(favorites).length;
    els.favCount.textContent = favN ? `(${favN})` : "";
    if (currentTab === "fav" && favN === 0) {
      els.count.textContent = "";
      showEmpty("尚未收藏任何標案。在搜尋結果按 ★ 即可收藏,收藏會保存在這台裝置的瀏覽器內。");
      return;
    }
    if (filtered.length === 0) {
      els.count.textContent = "";
      showEmpty("沒有符合條件的標案。試著放寬關鍵字或期間範圍。");
      return;
    }
    els.empty.hidden = true;
    const showing = Math.min(shown, filtered.length);
    els.count.textContent = `共 ${numberFormat.format(filtered.length)} 筆結果，目前顯示 ${numberFormat.format(showing)} 筆`;
  }

  async function openDetail({ caseNo, title, agency }) {
    els.detailContent.className = "detail-loading";
    els.detailContent.textContent = "正在載入標案詳情…";
    els.detailDialog.showModal();
    try {
      const searchRes = await fetch(`https://pcc-api.openfun.app/api/searchbytitle?query=${encodeURIComponent(title)}`);
      if (!searchRes.ok) throw new Error(`搜尋 API ${searchRes.status}`);
      const search = await searchRes.json();
      const hit = search.records?.find((x) => x.job_number === caseNo && (!x.unit_name || x.unit_name === agency))
        || search.records?.find((x) => x.job_number === caseNo);
      if (!hit?.unit_id) throw new Error("找不到相符的單案資料");
      const detailRes = await fetch(`https://pcc-api.openfun.app/api/tender?unit_id=${encodeURIComponent(hit.unit_id)}&job_number=${encodeURIComponent(caseNo)}`);
      if (!detailRes.ok) throw new Error(`詳情 API ${detailRes.status}`);
      const payload = await detailRes.json();
      const notice = [...(payload.records || [])]
        .filter((x) => x.detail && (x.detail["招標資料:招標狀態"] || x.brief?.type?.includes("招標") || x.brief?.type?.includes("公開取得")))
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))[0]
        || payload.records?.find((x) => x.detail);
      if (!notice?.detail) throw new Error("此案目前沒有可顯示的詳細公告");
      const d = notice.detail;
      const val = (key) => d[key] || "未提供";
      const fields = [
        ["預算金額", "採購資料:預算金額"], ["招標方式", "招標資料:招標方式"], ["招標狀態／第幾次", "招標資料:招標狀態"],
        ["公告傳輸次數", "招標資料:新增公告傳輸次數"], ["決標方式", "招標資料:決標方式"],
        ["公告日", "招標資料:公告日"], ["截止投標", "領投開標:截止投標"], ["開標時間", "領投開標:開標時間"],
        ["開標地點", "領投開標:開標地點"], ["履約地點", "其他:履約地點"], ["履約期限", "其他:履約期限"],
        ["押標金", "領投開標:是否須繳納押標金:押標金額度"], ["聯絡人", "機關資料:聯絡人"], ["聯絡電話", "機關資料:聯絡電話"],
        ["廠商資格摘要", "其他:廠商資格摘要", true], ["附加說明", "其他:附加說明", true],
      ];
      const noticeDownload = d["領投開標:是否提供電子領標:投標須知下載"];
      els.detailContent.className = "detail-panel";
      els.detailContent.innerHTML = `<header><div><span>${escapeHtml(notice.brief?.type || "標案詳情")}</span><h2>${escapeHtml(notice.brief?.title || title)}</h2><p>${escapeHtml(payload.unit_name || agency)} · ${escapeHtml(caseNo)}</p></div><button class="detail-close" type="button" aria-label="關閉">×</button></header><div class="detail-grid">${fields.map(([label,key,wide]) => `<div class="detail-field ${wide ? "wide" : ""}"><small>${label}</small><strong>${escapeHtml(val(key))}</strong></div>`).join("")}</div><div class="detail-actions"><a href="${escapeHtml(d.url || officialSearchUrl({ caseNo }))}" target="_blank" rel="noopener">政府原始公告</a>${noticeDownload ? `<a href="${escapeHtml(noticeDownload)}" target="_blank" rel="noopener">下載投標須知</a>` : ""}</div>`;
    } catch (error) {
      els.detailContent.className = "detail-loading";
      els.detailContent.innerHTML = `<strong>詳細資料暫時無法載入</strong><p>${escapeHtml(error.message)}</p><button class="detail-close btn" type="button">關閉</button>`;
    }
  }

  function showEmpty(msg) {
    els.empty.hidden = false;
    els.empty.textContent = msg;
    els.more.hidden = true;
  }

  function openWork(key) {
    const r = filtered.find(r => recordKey(r) === key) || favorites[key];
    if (!r) return;
    const item = work[key] || { stage: stages[0], owner: "", followUp: "", notes: "", tasks: [] };
    const analysis = item.documentAnalysis && typeof item.documentAnalysis === "object" ? item.documentAnalysis : null;
    const linkedProjectId = item.engineeringProjectId || analysis?.projectId || "";
    const analysisPanel = analysis ? `<section class="detail-field wide"><h3>文件分析摘要</h3><p><strong>${escapeHtml(analysis.fileName || "PDF／DWG")}</strong> · ${escapeHtml(analysis.documentKind || "初步分析")} · ${escapeHtml(analysis.analyzedAt ? new Date(analysis.analyzedAt).toLocaleString("zh-TW") : "分析時間未提供")} · ${escapeHtml(analysis.pageCount || 0)} 頁</p><ul>${(analysis.highlights || []).map(row => `<li><strong>${escapeHtml(row.label || "文件重點")}：</strong>${escapeHtml(row.text || "")}${row.page ? `（PDF 第 ${escapeHtml(row.page)} 頁）` : row.fileName ? `（來源：${escapeHtml(row.fileName)}）` : ""}</li>`).join("") || "<li>尚無引用重點，請開啟完整分析檢視。</li>"}</ul>${analysis.risks?.length ? `<p><strong>風險提示：</strong>${analysis.risks.map(row => escapeHtml(typeof row === "string" ? row : row.text || "")).filter(Boolean).join("；")}</p>` : ""}${analysis.missing?.length ? `<p><strong>待確認：</strong>${analysis.missing.map(escapeHtml).join("；")}</p>` : ""}<a href="engineering.html?project=${encodeURIComponent(linkedProjectId)}&amp;tenderKey=${encodeURIComponent(key)}">開啟完整分析與附件 →</a></section>` : "";
    els.detailContent.className = "detail-panel";
    els.detailContent.innerHTML = `<header><div><span>案件工作台</span><h2>${escapeHtml(r.title)}</h2><p>${escapeHtml(r.agency)} · ${escapeHtml(r.caseNo)}</p></div><button class="detail-close" type="button" aria-label="關閉">×</button></header>
      <p class="work-notice">清單為通用準備項目，${analysis ? "已完成文件初步分析；摘要與待確認事項已連回本案。" : "尚未分析此案文件；可建立工程文書專案並上傳 PDF／DWG。"}資格、金額與送件時間仍須依官方投標須知核對。資料保存在此瀏覽器，請定期匯出備份。</p>
      <form id="work-form"><div class="detail-grid">
      <label class="field">進度<select name="stage">${stages.map(s => `<option${s === item.stage ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="field">負責人<input name="owner" value="${escapeHtml(item.owner)}" maxlength="80"></label>
      <label class="field">下次追蹤日期<input name="followUp" type="date" value="${escapeHtml(item.followUp)}"></label>
      <div class="detail-field"><small>官方截止日／預算</small><strong>${escapeHtml(r.deadline || "待確認")} ／ ${escapeHtml(formatBudget(r.budget))}</strong></div>
      <label class="field detail-field wide">紀錄與待確認事項<textarea name="notes" rows="4" maxlength="10000">${escapeHtml(item.notes)}</textarea></label></div>
      ${analysisPanel}
      <fieldset class="work-tasks"><legend>投標與履約準備</legend>${taskLabels.map((label,i) => `<label class="check"><input type="checkbox" name="task" value="${i}"${item.tasks?.includes(i) ? " checked" : ""}>${label}</label>`).join("")}</fieldset>
      <div class="detail-actions"><button class="btn" type="submit">保存並加入追蹤</button><a href="${escapeHtml(officialSearchUrl(r))}" target="_blank" rel="noopener">核對官方公告 ↗</a></div><p id="work-status" role="status"></p></form>`;
    const engineeringLink = document.createElement('a');
    engineeringLink.className = 'btn';
    engineeringLink.textContent = linkedProjectId ? "開啟工程文書專案" : "建立工程文書專案";
    engineeringLink.href = linkedProjectId
      ? `engineering.html?project=${encodeURIComponent(linkedProjectId)}&tenderKey=${encodeURIComponent(key)}`
      : `engineering.html?tender=${encodeURIComponent(JSON.stringify({ title:r.title, agency:r.agency, caseNo:r.caseNo, budget:r.budget, deadline:r.deadline, officialUrl:officialSearchUrl(r), tenderKey:key }))}`;
    els.detailContent.querySelector('.detail-actions').appendChild(engineeringLink);
    const docLink = document.createElement('a');
    docLink.className = 'btn secondary'; docLink.textContent = '帶入本機文件助理（須先啟動整合版）';
    docLink.href = `http://127.0.0.1:8796/?tender=${encodeURIComponent(JSON.stringify({ title:r.title, attr:r.attr, officialUrl:officialSearchUrl(r) }))}`;
    docLink.target = '_blank'; docLink.rel = 'noopener'; els.detailContent.appendChild(docLink);
    els.detailDialog.showModal();
    $("work-form").addEventListener("submit", e => {
      e.preventDefault(); const form = new FormData(e.target);
      const previous = work[key] || {};
      work[key] = { ...previous, stage: form.get("stage"), owner: form.get("owner").trim(), followUp: form.get("followUp"), notes: form.get("notes").trim(), tasks: form.getAll("task").map(Number), updatedAt: new Date().toISOString() };
      favorites[key] = r;
      const saved = saveJson(WORK_KEY, work) && saveJson(FAV_KEY, favorites);
      $("work-status").textContent = saved ? "已保存，可在「我的追蹤」繼續處理。" : "僅保留在目前頁面，請匯出備份。";
      applyFilters();
    });
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    download(`標案工務台備份-${todayIso()}.json`, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), favorites, savedSearches, work, bidStatuses }, null, 2), "application/json");
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error("備份超過 20 MB");
      const data = JSON.parse(await file.text());
      const object = x => x && typeof x === "object" && !Array.isArray(x);
      if (![1, 2].includes(data.version) || !object(data.favorites) || !object(data.work) || !Array.isArray(data.savedSearches) || (data.bidStatuses != null && !object(data.bidStatuses))) throw new Error("不是有效的工作台備份");
      const rows = Object.values(data.favorites);
      if (rows.some(r => !object(r) || ["kind", "agency", "caseNo", "title", "periodStart", "periodEnd"].some(k => typeof r[k] !== "string") || (r.officialUrl && !/^https:\/\/web\.pcc\.gov\.tw\//.test(r.officialUrl)))) throw new Error("案件欄位或官方網址不正確");
      if (Object.values(data.work).some(w => !object(w) || !stages.includes(w.stage) || !Array.isArray(w.tasks) || w.tasks.some(t => !Number.isInteger(t) || t < 0 || t >= taskLabels.length) || ["owner","followUp","notes"].some(k => typeof w[k] !== "string"))) throw new Error("工作清單格式不正確");
      if (data.savedSearches.some(s => !object(s) || typeof s.name !== "string" || !object(s.state))) throw new Error("搜尋條件格式不正確");
      // Merge-only: retain existing records and work where a key already exists.
      favorites = { ...Object.fromEntries(rows.map(r => [recordKey(r), r])), ...favorites };
      work = { ...data.work, ...work };
      bidStatuses = { ...(data.bidStatuses || {}), ...bidStatuses };
      for (const s of data.savedSearches) if (!savedSearches.some(x => x.name === s.name && JSON.stringify(x.state) === JSON.stringify(s.state))) savedSearches.push(s);
      saveJson(FAV_KEY, favorites); saveJson(WORK_KEY, work); saveJson(SEARCH_KEY, savedSearches); saveJson(BID_STATUS_KEY, bidStatuses);
      renderSavedChips(); await applyFilters(); alert("備份已合併，原有資料保留。");
    } catch (error) { alert(`無法匯入：${error.message}`); }
  }

  function exportCsv() {
    const cell = v => `"${String(v ?? "").replace(/^\s*[=+@-]/, "'$&").replaceAll('"','""')}"`;
    const rows = filtered.map(r => { const key = recordKey(r), w = work[key] || {}; return [r.title,r.agency,r.caseNo,bidStatuses[key]?.status || "待查詢",r.transmissionCount || "未提供",r.deadline,r.budget,w.stage,w.owner,w.followUp,w.notes,officialSearchUrl(r)]; });
    download(`標案清單-${todayIso()}.csv`, "\uFEFF" + [["案名","機關","案號","招標狀態／第幾次","公告傳輸次數","截止日","預算","進度","負責人","追蹤日期","紀錄","官方網址"], ...rows].map(row => row.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  }

  // ---------- 常用搜尋 ----------
  function renderSavedChips() {
    els.savedChips.textContent = "";
    savedSearches.forEach((item, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.textContent = item.name;
      apply.addEventListener("click", () => { setFilterState({ ...item.state, profile: item.state.profile ?? "" }); applyFilters(); });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chip-del";
      del.setAttribute("aria-label", `刪除 ${item.name}`);
      del.textContent = "×";
      del.addEventListener("click", () => {
        savedSearches.splice(i, 1);
        saveJson(SEARCH_KEY, savedSearches);
        renderSavedChips();
      });
      chip.append(apply, del);
      els.savedChips.appendChild(chip);
    });
  }

  // ---------- 事件 ----------
  function bindEvents() {
    $("btn-backup").addEventListener("click", exportBackup);
    $("btn-my-source").addEventListener("click", () => { setFilterState({ profile: "my", deadlineWindow: "", sort: "deadline-asc", openOnly: true }); switchTab("all"); });
    $("btn-engineering").addEventListener("click", () => { setFilterState({ profile: "", attr: "工程類", budget: "100000000", deadlineWindow: "", sort: "deadline-asc", openOnly: true }); switchTab("all"); });
    document.querySelectorAll("[data-urgent-window]").forEach((button) => {
      button.addEventListener("click", () => {
        setFilterState({ profile: "", deadlineWindow: button.dataset.urgentWindow === "today" ? "0-0" : "1-1", sort: "deadline-asc", openOnly: true });
        switchTab("all");
        $("results-heading").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    document.querySelectorAll("[data-qualification]").forEach((button) => {
      button.addEventListener("click", () => {
        setFilterState({ profile: "", qualification: button.dataset.qualification, deadlineWindow: "", sort: "deadline-asc", openOnly: true });
        switchTab("all");
        $("results-heading").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    $("quick-nav-heading").closest(".quick-nav").addEventListener("click",e=>{const button=e.target.closest("button[data-nav-type]");if(button)applyQuickNavigation(button.dataset.navType,button.dataset.navValue);});
    $("btn-export").addEventListener("click", exportCsv);
    $("backup-file").addEventListener("change", e => { importBackup(e.target.files[0]); e.target.value = ""; });
    let timer;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(applyFilters, 150); };
    els.q.addEventListener("input", debounced);
    els.agency.addEventListener("input", debounced);
    els.caseNumber.addEventListener("input", debounced);
    for (const el of [els.profile, els.method, els.region, els.regionIncludeUnknown, els.sort, els.budget, els.deadline, els.retender, els.open, els.start, els.end]) {
      el.addEventListener("change", applyFilters);
    }
    els.qualification.addEventListener("change", () => {
      els.profile.value = "";
      if (els.qualification.value) els.attr.value = "";
      updateQuickCategoryState();
      applyFilters();
    });
    els.attr.addEventListener("change", () => {
      els.profile.value = "";
      if (els.attr.value) els.qualification.value = "";
      updateQuickCategoryState();
      applyFilters();
    });
    document.querySelectorAll(".quick-category").forEach((button) => {
      button.addEventListener("click", () => {
        els.profile.value = "";
        els.attr.value = button.dataset.attr;
        els.qualification.value = "";
        updateQuickCategoryState();
        applyFilters();
      });
    });
    els.range.addEventListener("change", () => {
      els.customDates.hidden = els.range.value !== "custom";
      applyFilters();
    });
    els.clear.addEventListener("click", () => {
      setFilterState({});
      applyFilters();
    });
    els.more.addEventListener("click", () => { renderMore(); renderCount(); });

    els.saveSearch.addEventListener("click", () => {
      const state = getFilterState();
      const suggested = state.q || state.agency || state.attr || "我的條件";
      const name = prompt("為這組搜尋條件命名:", suggested);
      if (!name) return;
      savedSearches.push({ name: name.trim().slice(0, 30), state });
      saveJson(SEARCH_KEY, savedSearches);
      renderSavedChips();
    });

    els.tabAll.addEventListener("click", () => switchTab("all"));
    els.tabFav.addEventListener("click", () => switchTab("fav"));

    els.results.addEventListener("click", async (e) => {
      const bidStatusBtn = e.target.closest("button[data-bid-status]");
      if (bidStatusBtn) {
        const key = bidStatusBtn.dataset.bidStatus;
        const r = filtered.find((item) => recordKey(item) === key) || favorites[key];
        if (!r) return;
        bidStatusBtn.disabled = true;
        bidStatusBtn.textContent = "查詢中…";
        try {
          const result = await lookupBidStatus(r);
          bidStatuses[key] = { status: result.status, checkedAt: new Date().toISOString() };
          saveJson(BID_STATUS_KEY, bidStatuses);
          bidStatusBtn.textContent = result.status;
          bidStatusBtn.classList.add("loaded");
          bidStatusBtn.title = `官方招標狀態；查詢時間 ${fmtTime(bidStatuses[key].checkedAt)}`;
          await applyFilters();
        } catch (error) {
          bidStatusBtn.textContent = "查詢失敗，按此重試";
          bidStatusBtn.title = error.message;
        } finally {
          bidStatusBtn.disabled = false;
        }
        return;
      }
      const workBtn = e.target.closest("button[data-work]");
      if (workBtn) { openWork(workBtn.dataset.work); return; }
      const detailBtn = e.target.closest("button.detail-trigger");
      if (detailBtn) {
        openDetail({ caseNo: detailBtn.dataset.case, title: detailBtn.dataset.title, agency: detailBtn.dataset.agency });
        return;
      }
      const favBtn = e.target.closest("button.fav");
      if (favBtn) {
        const key = favBtn.dataset.key;
        if (favorites[key]) {
          delete favorites[key];
          favBtn.classList.remove("on");
          favBtn.setAttribute("aria-pressed", "false");
        } else {
          let rec = Object.values(favorites).find((r) => recordKey(r) === key);
          if (!rec) rec = openTenders.find((r) => recordKey(r) === key);
          if (!rec) {
            for (const records of monthCache.values()) {
              rec = records.find((r) => recordKey(r) === key);
              if (rec) break;
            }
          }
          if (rec) {
            favorites[key] = rec;
            favBtn.classList.add("on");
            favBtn.setAttribute("aria-pressed", "true");
          }
        }
        saveJson(FAV_KEY, favorites);
        renderCount();
        if (currentTab === "fav") applyFilters();
        return;
      }
      const copyBtn = e.target.closest("button.copy");
      if (copyBtn) {
        copyText(copyBtn.dataset.copy).then(() => {
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 800);
        });
      }
    });
    els.detailDialog.addEventListener("click", (e) => {
      if (e.target.closest(".detail-close") || e.target === els.detailDialog) els.detailDialog.close();
    });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function switchTab(tab) {
    currentTab = tab;
    els.tabAll.classList.toggle("active", tab === "all");
    els.tabFav.classList.toggle("active", tab === "fav");
    els.tabAll.setAttribute("aria-selected", String(tab === "all"));
    els.tabFav.setAttribute("aria-selected", String(tab === "fav"));
    applyFilters();
  }

  function populateFilterOptions() {
    const add = (sel, values) => {
      for (const v of values || []) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
    };
    const merged = (metaValues, key) => [...new Set([...(metaValues || []), ...openTenders.map((r) => r[key]).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    add(els.attr, merged(meta.filters?.attrs, "attr"));
    add(els.method, merged(meta.filters?.methods, "method"));
    add(els.region, merged(meta.filters?.regions, "region"));
  }

  // ---------- 啟動 ----------
  async function init() {
    bindEvents();
    renderSavedChips();
    const history = fetchJson("data/index.json").catch(() => ({ months: [], filters: {} }));
    // 可投標案源載入失敗時退回歷史檢視,不讓整站掛掉
    try {
      [openMeta, validation] = await Promise.all([
        fetchJson("data/open-tenders.json"),
        fetchJson("data/open-tenders-validation.json"),
      ]);
      openTenders = openMeta.records || [];
      if (!validation.passed || openMeta.count !== openTenders.length || validation.recordCount !== openTenders.length || !openTenders.length) throw new Error("可投標資料與驗證報告不一致");
    } catch (err) {
      openMeta = null;
      validation = null;
      openTenders = [];
      console.error("可投標案源載入失敗,退回歷史檢視", err);
    }
    meta = await history;
    for (const r of openTenders) if (favorites[recordKey(r)]) favorites[recordKey(r)] = r;
    if (!openTenders.length && !(meta.months?.length)) {
      renderStats(); showEmpty("案源暫時無法載入，請重新整理重試；仍可開啟我的追蹤與匯出備份。");
      els.count.textContent = ""; els.headerStatus.textContent = "案源載入失敗"; return;
    }
    if (!openTenders.length) { els.open.checked = false; }
    renderStats();
    populateFilterOptions();
    renderQuickNavigation();
    renderSyncStatus();
    const hasOpen = openTenders.length > 0;
    if (!hasOpen) {
      els.statOpen.textContent = els.statToday.textContent = els.statUrgent.textContent = els.statEngineering.textContent = "—";
      els.banner.hidden = false; els.banner.className = "sync-banner warn";
      els.banner.textContent = "目前可投標資料無法載入或未通過驗證，以下改顯示歷史資料；不代表目前沒有標案。請重新整理或核對官方網站。";
    }
    setFilterState(hasOpen ? { profile: "", deadlineWindow: "", regionIncludeUnknown: true, openOnly: true, sort: "deadline-asc" } : { profile: "", deadlineWindow: "", openOnly: false });
    await applyFilters();
    hydrateRetenderStatuses();
  }

  init();
})();
