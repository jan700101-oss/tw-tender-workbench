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
    more: $("btn-more"),
    empty: $("empty-state"),
    footerSync: $("footer-sync"),
  };

  let meta = null;
  const monthCache = new Map(); // "YYYY-MM" -> records[]
  let currentTab = "all";
  let shown = 0;
  let filtered = [];
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

  function renderSyncStatus() {
    const ok = meta.lastSuccess;
    const attempt = meta.lastAttempt;
    const failed = attempt && attempt.status !== "success";
    let staleDays = null;
    if (ok) staleDays = Math.floor((Date.now() - new Date(ok.at).getTime()) / 86400000);

    if (ok) {
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
    els.open.checked = !!s.openOnly;
    els.customDates.hidden = els.range.value !== "custom";
  }

  async function applyFilters() {
    const token = ++loadToken;
    const s = getFilterState();
    const today = todayIso();

    let source;
    if (currentTab === "fav") {
      source = Object.values(favorites);
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
      if (s.openOnly && !(r.deadline && r.deadline >= today)) return false;
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
    const p = new URLSearchParams({
      firstSearch: "true", searchType: "basic",
      tenderType: "TENDER_DECLARATION", tenderWay: "TENDER_WAY_ALL_DECLARATION",
      dateType: "isDate", tenderId: r.caseNo,
    });
    return `https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic?${p}`;
  }

  function sourceFileUrl(r) {
    return `https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=${encodeURIComponent(r.sourceFile)}`;
  }

  function periodLabel(r) {
    const [y, m, d1] = r.periodStart.split("-");
    const d2 = r.periodEnd.split("-")[2];
    return `${y}/${m}/${Number(d1)}–${Number(d2)}`;
  }

  function deadlineBadge(r, today) {
    if (!r.deadline) return `<span class="badge muted">截止日未提供</span>`;
    if (r.deadline < today) return `<span class="badge closed">已截止 ${r.deadline}</span>`;
    const days = Math.round((new Date(`${r.deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    const cls = days <= 3 ? "urgent" : "open";
    return `<span class="badge ${cls}">截止 ${r.deadline}(剩 ${days} 天)</span>`;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMore() {
    const today = todayIso();
    const batch = filtered.slice(shown, shown + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const r of batch) {
      const key = recordKey(r);
      const li = document.createElement("li");
      li.className = "card";
      const regionBadge = r.region && r.region !== "地區未明"
        ? `<span class="badge">${escapeHtml(r.region)}(推定)</span>` : "";
      li.innerHTML = `
        <div class="card-head">
          <a class="title" href="${officialSearchUrl(r)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
          <button class="fav ${favorites[key] ? "on" : ""}" type="button" title="收藏" aria-pressed="${!!favorites[key]}" data-key="${escapeHtml(key)}">★</button>
        </div>
        <div class="card-meta">
          <span class="badge attr">${escapeHtml(r.attr || "未分類")}</span>
          <span class="badge">${escapeHtml(r.method || "—")}</span>
          ${regionBadge}
          <span class="badge announce">公告期間 ${periodLabel(r)}</span>
          ${deadlineBadge(r, today)}
        </div>
        <div class="card-body">
          <span class="agency">${escapeHtml(r.agency)}</span>
          <span class="case-no">案號 <button class="copy" type="button" data-copy="${escapeHtml(r.caseNo)}" title="複製案號">${escapeHtml(r.caseNo)} ⧉</button></span>
        </div>
        <div class="card-links">
          <a href="${officialSearchUrl(r)}" target="_blank" rel="noopener">官方查詢</a>
          <a href="${sourceFileUrl(r)}" target="_blank" rel="noopener">來源檔 ${escapeHtml(r.sourceFile)}</a>
        </div>`;
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
    els.count.textContent = `${filtered.length} 筆結果`;
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
    for (const el of [els.attr, els.method, els.region, els.sort, els.open, els.start, els.end]) {
      el.addEventListener("change", applyFilters);
    }
    els.range.addEventListener("change", () => {
      els.customDates.hidden = els.range.value !== "custom";
      applyFilters();
    });
    els.clear.addEventListener("click", () => {
      setFilterState({});
      applyFilters();
    });
    els.more.addEventListener("click", renderMore);

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
      const favBtn = e.target.closest("button.fav");
      if (favBtn) {
        const key = favBtn.dataset.key;
        if (favorites[key]) {
          delete favorites[key];
          favBtn.classList.remove("on");
          favBtn.setAttribute("aria-pressed", "false");
        } else {
          let rec = Object.values(favorites).find((r) => recordKey(r) === key);
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
        navigator.clipboard?.writeText(copyBtn.dataset.copy).then(() => {
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 800);
        });
      }
    });
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
    add(els.attr, meta.filters?.attrs);
    add(els.method, meta.filters?.methods);
    add(els.region, meta.filters?.regions);
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
    populateFilterOptions();
    renderSyncStatus();
    setFilterState({});
    await applyFilters();
  }

  init();
})();
