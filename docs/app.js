const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((el) => [el.id, el]));
const state = { records: [], filtered: [], page: 1, pageSize: 25, meta: null };
const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("zh-TW").replaceAll("臺", "台").replace(/\s+/g, " ").trim();
}

function dateStatus(deadline) {
  if (!deadline) return { label: "日期未提供", kind: "muted" };
  const end = new Date(`${deadline}T23:59:59+08:00`);
  const now = new Date();
  const days = Math.ceil((end - now) / 86400000);
  if (days < 0) return { label: "已截止", kind: "closed" };
  if (days <= 3) return { label: days === 0 ? "今天截止" : `${days} 天後截止`, kind: "urgent" };
  return { label: `${days} 天後截止`, kind: "open" };
}

function populateSelect(id, values, label) {
  els[id].innerHTML = `<option value="">${label}</option>` + values.map((value) => `<option>${escapeHtml(value)}</option>`).join("");
}

function applyFilters(resetPage = true) {
  const query = normalize(els.query.value);
  const tokens = query.split(" ").filter(Boolean);
  const agency = normalize(els.agency.value);
  const region = els.region.value;
  const category = els.category.value;
  const method = els.method.value;
  const status = els.status.value;
  state.filtered = state.records.filter((record) => {
    const haystack = normalize(`${record.title} ${record.agency} ${record.caseNo}`);
    if (tokens.some((token) => !haystack.includes(token))) return false;
    if (agency && !normalize(record.agency).includes(agency)) return false;
    if (region && record.region !== region) return false;
    if (category && record.category !== category) return false;
    if (method && record.method !== method) return false;
    if (status === "open" && !["open", "urgent"].includes(dateStatus(record.deadline).kind)) return false;
    if (status === "closed" && dateStatus(record.deadline).kind !== "closed") return false;
    return true;
  });
  state.filtered.sort((a, b) => b.deadline.localeCompare(a.deadline) || collator.compare(a.agency, b.agency));
  if (resetPage) state.page = 1;
  render();
}

function render() {
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const rows = state.filtered.slice(start, start + state.pageSize);
  els.resultCount.textContent = `找到 ${state.filtered.length.toLocaleString("zh-TW")} 筆`;
  els.range.textContent = state.filtered.length ? `顯示第 ${start + 1}–${Math.min(start + rows.length, state.filtered.length)} 筆` : "請調整搜尋條件";
  els.results.innerHTML = rows.length ? rows.map((record) => {
    const status = dateStatus(record.deadline);
    return `<article class="tender-card">
      <div class="card-top"><span class="tag">${escapeHtml(record.category || "未分類")}</span><span class="status ${status.kind}">${status.label}</span></div>
      <h2>${escapeHtml(record.title)}</h2>
      <p class="agency">${escapeHtml(record.agency)} · ${escapeHtml(record.region)}</p>
      <dl><div><dt>案號</dt><dd>${escapeHtml(record.caseNo)}</dd></div><div><dt>招標方式</dt><dd>${escapeHtml(record.method || "未提供")}</dd></div><div><dt>截止投標</dt><dd>${escapeHtml(record.deadline || "未提供")}</dd></div><div><dt>官方資料期間</dt><dd>${escapeHtml(record.sourcePeriod)}</dd></div></dl>
      <a class="official" href="${escapeHtml(record.officialUrl)}" target="_blank" rel="noopener noreferrer">到政府網站查看此案 <span aria-hidden="true">↗</span></a>
    </article>`;
  }).join("") : `<div class="empty"><strong>沒有符合的標案</strong><span>可以減少關鍵字，或清除部分篩選條件。</span></div>`;
  els.prev.disabled = state.page <= 1;
  els.next.disabled = state.page >= pages;
  els.pageInfo.textContent = `第 ${state.page} / ${pages} 頁`;
}

function saveSearch() {
  const saved = { query: els.query.value, agency: els.agency.value, region: els.region.value, category: els.category.value, method: els.method.value, status: els.status.value };
  localStorage.setItem("tw-tender-search", JSON.stringify(saved));
  els.saveStatus.textContent = "已儲存目前條件";
  setTimeout(() => { els.saveStatus.textContent = ""; }, 1800);
}

async function start() {
  try {
    const response = await fetch("./tenders.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`資料載入失敗 (${response.status})`);
    const payload = await response.json();
    state.records = payload.records;
    state.meta = payload.meta;
    populateSelect("region", [...new Set(state.records.map((row) => row.region).filter(Boolean))].sort((a, b) => a === "地區未明" ? 1 : b === "地區未明" ? -1 : collator.compare(a, b)), "所有地區");
    populateSelect("category", [...new Set(state.records.map((row) => row.category).filter(Boolean))].sort(collator.compare), "所有採購類別");
    populateSelect("method", [...new Set(state.records.map((row) => row.method).filter(Boolean))].sort(collator.compare), "所有招標方式");
    const saved = JSON.parse(localStorage.getItem("tw-tender-search") || "null");
    if (saved) for (const [key, value] of Object.entries(saved)) if (els[key]) els[key].value = value;
    els.syncSummary.textContent = `${payload.meta.recordCount.toLocaleString("zh-TW")} 筆｜官方最新資料：${payload.meta.officialLatestPeriod}｜涵蓋近 ${payload.meta.historyMonths} 個月`;
    els.syncTime.textContent = `本站更新：${new Date(payload.meta.syncedAt).toLocaleString("zh-TW", { hour12: false })}`;
    applyFilters();
  } catch (error) {
    els.loading.innerHTML = `<strong>目前無法載入標案資料</strong><span>${escapeHtml(error.message)}，請稍後重新整理。</span>`;
  }
}

els.filters.addEventListener("submit", (event) => { event.preventDefault(); applyFilters(); });
els.filters.addEventListener("change", () => applyFilters());
els.clear.addEventListener("click", () => { els.filters.reset(); applyFilters(); });
els.save.addEventListener("click", saveSearch);
els.prev.addEventListener("click", () => { state.page -= 1; render(); scrollTo({ top: els.results.offsetTop - 100, behavior: "smooth" }); });
els.next.addEventListener("click", () => { state.page += 1; render(); scrollTo({ top: els.results.offsetTop - 100, behavior: "smooth" }); });
els.pageSize.addEventListener("change", () => { state.pageSize = Number(els.pageSize.value); state.page = 1; render(); });
start();
