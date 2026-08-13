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

  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $("sync-banner"),
    headerStatus: $("header-data-status"),
    statOpen: $("stat-open"),
    statToday: $("stat-today"),
    statUrgent: $("stat-urgent"),
    statEngineering: $("stat-engineering"),
    q: $("q"),
    attr: $("f-attr"),
    method: $("f-method"),
    region: $("f-region"),
    agency: $("f-agency"),
    range: $("f-range"),
    customDates: $("custom-dates"),
    start: $("f-start"),
    end: $("f-end"),
    sort: $("f-sort"),
    open: $("f-open"),
    saveSearch: $("btn-save-search"),
    clear: $("btn-clear"),
    savedChips: $("saved-chips"),
    tabAll: $("tab-all"),
    tabFav: $("tab-fav"),
    favCount: $("fav-count"),
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
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 隱私模式可能失敗 */ }
  }
  let favorites = loadJson(FAV_KEY, {});        // key -> record
  let savedSearches = loadJson(SEARCH_KEY, []); // [{name, state}]

  function recordKey(r) {
    return [r.kind, r.periodStart, r.agency, r.caseNo, r.title].join("|");
  }

  // ---------- 資料載入 ----------
  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
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
    } catch {
      monthCache.set(month, []);
      return [];
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

  function renderStats() {
    const today = todayIso();
    const urgentEnd = addDays(today, 3);
    const current = openTenders.filter((r) => r.deadline >= today);
    els.statOpen.textContent = numberFormat.format(current.length);
    els.statToday.textContent = numberFormat.format(current.filter((r) => r.periodStart === today).length);
    els.statUrgent.textContent = numberFormat.format(current.filter((r) => r.deadline <= urgentEnd).length);
    els.statEngineering.textContent = numberFormat.format(current.filter((r) => r.attr === "工程類").length);
  }

  function renderSyncStatus() {
    if (openMeta) {
      els.headerStatus.textContent = `更新 ${fmtTime(openMeta.generatedAt)}`;
      els.footerSync.textContent = `可投標案源更新：${fmtTime(openMeta.generatedAt)}（台北時間） · 官方查詢 ${openMeta.officialResultCount} 筆 · 本站有效案件 ${openMeta.count} 筆 · 官方列表抽驗 ${validation?.officialRowsPassed || 0}/${validation?.officialRowsRequested || 0}`;
      const staleHours = (Date.now() - new Date(openMeta.generatedAt).getTime()) / 3600000;
      const histAttempt = meta && meta.lastAttempt;
      const histFailed = histAttempt && histAttempt.status !== "success";
      if (!validation?.passed) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = "目前資料尚未通過官方公告驗證，請勿作為投標依據。";
      } else if (staleHours > 36) {
        els.banner.hidden = false;
        els.banner.className = "sync-banner warn";
        els.banner.textContent = "可投標案源超過 36 小時未更新，請先以政府電子採購網公告為準。";
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
      attr: els.attr.value,
      method: els.method.value,
      region: els.region.value,
      agency: els.agency.value.trim(),
      range: els.range.value,
      start: els.start.value,
      end: els.end.value,
      sort: els.sort.value,
      openOnly: els.open.checked,
    };
  }

  function setFilterState(s) {
    els.q.value = s.q || "";
    els.attr.value = s.attr || "";
    els.method.value = s.method || "";
    els.region.value = s.region || "";
    els.agency.value = s.agency || "";
    els.range.value = s.range || "3";
    els.start.value = s.start || "";
    els.end.value = s.end || "";
    els.sort.value = s.sort || "period-desc";
    els.open.checked = s.openOnly !== false;
    els.customDates.hidden = els.range.value !== "custom";
    updateQuickCategoryState();
  }

  function updateQuickCategoryState() {
    document.querySelectorAll(".quick-category").forEach((button) => {
      const active = button.dataset.attr === els.attr.value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  async function applyFilters() {
    const token = ++loadToken;
    const s = getFilterState();
    const today = todayIso();

    let source;
    if (currentTab === "fav") {
      source = Object.values(favorites);
    } else if (s.openOnly) {
      source = openTenders;
    } else {
      const months = monthsForState(s);
      const missing = months.filter((m) => !monthCache.has(m));
      if (missing.length) {
        els.count.textContent = "載入資料中…";
        await Promise.all(missing.map(loadMonth));
        if (token !== loadToken) return; // 已有更新的查詢
      }
      source = [];
      for (const m of months) source.push(...(monthCache.get(m) || []));
    }

    const terms = s.q.split(/\s+/).filter(Boolean);
    const include = terms.filter((t) => !t.startsWith("-")).map((t) => t.toLowerCase());
    const exclude = terms.filter((t) => t.startsWith("-") && t.length > 1).map((t) => t.slice(1).toLowerCase());
    const agencyQ = s.agency.toLowerCase();
    const minDate = s.range === "custom" ? (s.start || null) : null;
    const maxDate = s.range === "custom" ? (s.end || null) : null;

    filtered = source.filter((r) => {
      if (s.attr && r.attr !== s.attr) return false;
      if (s.method && r.method !== s.method) return false;
      if (s.region && r.region !== s.region) return false;
      if (agencyQ && !r.agency.toLowerCase().includes(agencyQ)) return false;
      if (minDate && r.periodEnd < minDate) return false;
      if (maxDate && r.periodStart > maxDate) return false;
      if (s.openOnly && currentTab !== "fav") { // 收藏分頁永遠顯示全部收藏
        // 每日 API 記錄不含截止日:公告 45 天內視為可能仍開放
        const maybeOpen = !r.deadline && r.sourceFile.startsWith("api:") &&
          (Date.parse(today) - Date.parse(r.periodStart)) / 86400000 <= 45;
        if (!(r.deadline && r.deadline >= today) && !maybeOpen) return false;
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

  function deadlineInfo(r, today) {
    if (!r.deadline) return { date: "詳情確認", label: isDailyRecord(r) ? "截止日見詳情" : "截止日未提供", cls: "" };
    const days = Math.round((new Date(`${r.deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    if (days < 0) return { date: r.deadline, label: `已截止 ${Math.abs(days)} 天`, cls: "closed" };
    if (days === 0) return { date: r.deadline, label: "今天截止", cls: "urgent" };
    return { date: r.deadline, label: `剩 ${days} 天`, cls: days <= 3 ? "urgent" : "" };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMore() {
    const today = todayIso();
    const batch = filtered.slice(shown, shown + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const r of batch) {
      const key = recordKey(r);
      const deadline = deadlineInfo(r, today);
      const li = document.createElement("li");
      li.className = "card";
      const regionBadge = r.region && r.region !== "地區未明"
        ? `<span class="badge region">${escapeHtml(r.region)}（推定）</span>` : "";
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
            <span class="badge">${escapeHtml(r.method || "招標方式未提供")}</span>
            ${regionBadge}
            <span class="badge">${periodLabel(r)}</span>
          </div>
          <div class="card-links">
            ${r.officialUrl
              ? `<a class="primary-link" href="${officialSearchUrl(r)}" target="_blank" rel="noopener">查看政府原始公告 ↗</a>`
              : `<button class="detail-trigger" type="button" data-case="${escapeHtml(r.caseNo)}" data-title="${escapeHtml(r.title)}" data-agency="${escapeHtml(r.agency)}">查看完整詳情</button><a href="${officialSearchUrl(r)}" target="_blank" rel="noopener">官方查詢 ↗</a>`}
            ${r.sourceFile?.endsWith(".xml") || isDailyRecord(r) ? `<a href="${sourceFileUrl(r)}" target="_blank" rel="noopener">檢視資料來源</a>` : ""}
          </div>
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
      const notice = payload.records?.find((x) => x.brief?.type?.includes("招標") && x.detail) || payload.records?.find((x) => x.detail);
      if (!notice?.detail) throw new Error("此案目前沒有可顯示的詳細公告");
      const d = notice.detail;
      const val = (key) => d[key] || "未提供";
      const fields = [
        ["預算金額", "採購資料:預算金額"], ["招標方式", "招標資料:招標方式"], ["決標方式", "招標資料:決標方式"],
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

  // ---------- 常用搜尋 ----------
  function renderSavedChips() {
    els.savedChips.textContent = "";
    savedSearches.forEach((item, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.textContent = item.name;
      apply.addEventListener("click", () => { setFilterState(item.state); applyFilters(); });
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
    let timer;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(applyFilters, 150); };
    els.q.addEventListener("input", debounced);
    els.agency.addEventListener("input", debounced);
    for (const el of [els.method, els.region, els.sort, els.open, els.start, els.end]) {
      el.addEventListener("change", applyFilters);
    }
    els.attr.addEventListener("change", () => { updateQuickCategoryState(); applyFilters(); });
    document.querySelectorAll(".quick-category").forEach((button) => {
      button.addEventListener("click", () => {
        els.attr.value = button.dataset.attr;
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

    els.results.addEventListener("click", (e) => {
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
    try {
      meta = await fetchJson("data/index.json");
      if (!meta.months || meta.months.length === 0) throw new Error("index 沒有月份資料");
    } catch (err) {
      showEmpty("資料尚未同步或載入失敗。請先執行一次同步(GitHub Actions「每日同步標案資料」),或稍後再試。");
      els.count.textContent = "";
      console.error(err);
      return;
    }
    // 可投標案源載入失敗時退回歷史檢視,不讓整站掛掉
    try {
      [openMeta, validation] = await Promise.all([
        fetchJson("data/open-tenders.json"),
        fetchJson("data/open-tenders-validation.json"),
      ]);
      openTenders = openMeta.records || [];
    } catch (err) {
      openMeta = null;
      validation = null;
      openTenders = [];
      console.error("可投標案源載入失敗,退回歷史檢視", err);
    }
    renderStats();
    populateFilterOptions();
    renderSyncStatus();
    const hasOpen = openTenders.length > 0;
    setFilterState(hasOpen ? { openOnly: true, sort: "deadline-asc" } : { openOnly: false });
    await applyFilters();
  }

  init();
})();
