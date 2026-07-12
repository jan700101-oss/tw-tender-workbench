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
  const announcementType = els.announcementType.value;
  state.filtered = state.records.filter((record) => {
    const haystack = normalize(`${record.title} ${record.agency} ${record.caseNo}`);
    if (tokens.some((token) => !haystack.includes(token))) return false;
    if (agency && !normalize(record.agency).includes(agency)) return false;
    if (region && record.region !== region) return false;
    if (category && record.category !== category) return false;
    if (announcementType && record.announcementType !== announcementType) return false;
    return true;
  });
  state.filtered.sort((a, b) => b.announcementDate.localeCompare(a.announcementDate) || collator.compare(a.agency, b.agency));
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
    return `<article class="tender-card">
      <div class="card-top"><span class="tag">${escapeHtml(record.category || "未分類")}</span><span class="status open">${escapeHtml(record.announcementType)}</span></div>
      <h2>${escapeHtml(record.title)}</h2>
      <p class="agency">${escapeHtml(record.agency)} · ${escapeHtml(record.region)}</p>
      <dl><div><dt>案號</dt><dd>${escapeHtml(record.caseNo)}</dd></div><div><dt>公告日期</dt><dd>${escapeHtml(record.announcementDate)}</dd></div><div><dt>詳細分類</dt><dd>${escapeHtml(record.categoryDetail || record.category)}</dd></div></dl>
      ${record.unitId ? `<button class="official detail-button" type="button" data-detail-id="${escapeHtml(record.id)}">查看公告詳情 <span aria-hidden="true">→</span></button>` : `<span class="official">詳細資料未提供</span>`}
    </article>`;
  }).join("") : `<div class="empty"><strong>沒有符合的標案</strong><span>可以減少關鍵字，或清除部分篩選條件。</span></div>`;
  els.prev.disabled = state.page <= 1;
  els.next.disabled = state.page >= pages;
  els.pageInfo.textContent = `第 ${state.page} / ${pages} 頁`;
}

function saveSearch() {
  const saved = { query: els.query.value, agency: els.agency.value, region: els.region.value, category: els.category.value, announcementType: els.announcementType.value };
  localStorage.setItem("tw-tender-search", JSON.stringify(saved));
  els.saveStatus.textContent = "已儲存目前條件";
  setTimeout(() => { els.saveStatus.textContent = ""; }, 1800);
}

function detailValue(detail, key) {
  return detail?.[key] || "未提供";
}

async function openDetail(record) {
  els.detailContent.className = "detail-status";
  els.detailContent.innerHTML = "正在載入公告詳情…";
  els.detailDialog.showModal();
  try {
    const url = `https://pcc-api.openfun.app/api/tender?unit_id=${encodeURIComponent(record.unitId)}&job_number=${encodeURIComponent(record.caseNo)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API ${response.status}`);
    const payload = await response.json();
    const notice = payload.records?.find((item) => item.filename === record.sourceFilename) || payload.records?.find((item) => String(item.date) === record.announcementDate.replaceAll("-", "")) || payload.records?.[0];
    if (!notice?.detail) throw new Error("此公告暫無詳細欄位");
    const d = notice.detail;
    const fields = [
      ["預算金額", "採購資料:預算金額"], ["招標方式", "招標資料:招標方式"],
      ["決標方式", "招標資料:決標方式"], ["公告日期", "招標資料:公告日"],
      ["截止投標", "領投開標:截止投標"], ["開標時間", "領投開標:開標時間"],
      ["開標地點", "領投開標:開標地點"], ["履約地點", "其他:履約地點"],
      ["履約期限", "其他:履約期限"], ["押標金", "領投開標:是否須繳納押標金:押標金額度"],
      ["聯絡人", "機關資料:聯絡人"], ["聯絡電話", "機關資料:聯絡電話"],
      ["廠商資格摘要", "其他:廠商資格摘要", true], ["附加說明", "其他:附加說明", true],
    ];
    const officialUrl = d.url || record.officialUrl;
    const noticeDownload = d["領投開標:是否提供電子領標:投標須知下載"];
    els.detailContent.className = "detail-shell";
    els.detailContent.innerHTML = `<div class="detail-head"><div><span class="tag">${escapeHtml(notice.brief?.type || record.announcementType)}</span><h2>${escapeHtml(notice.brief?.title || record.title)}</h2><p>${escapeHtml(payload.unit_name || record.agency)} · ${escapeHtml(record.caseNo)}</p></div><button class="dialog-close" type="button" aria-label="關閉">×</button></div><div class="detail-grid">${fields.map(([label,key,wide]) => `<div class="detail-field ${wide ? "wide" : ""}"><span>${label}</span><strong>${escapeHtml(detailValue(d,key))}</strong></div>`).join("")}</div><div class="detail-links"><a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">政府原始公告 ↗</a>${noticeDownload ? `<a class="secondary" href="${escapeHtml(noticeDownload)}" target="_blank" rel="noopener noreferrer">下載投標須知 ↗</a>` : ""}</div>`;
  } catch (error) {
    els.detailContent.className = "detail-status";
    els.detailContent.innerHTML = `<strong>詳細資料暫時無法載入</strong><br>${escapeHtml(error.message)}<br><br><button class="dialog-close" type="button">關閉</button>`;
  }
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
    populateSelect("announcementType", [...new Set(state.records.map((row) => row.announcementType).filter(Boolean))].sort(collator.compare), "所有公告類型");
    const saved = JSON.parse(localStorage.getItem("tw-tender-search") || "null");
    if (saved) for (const [key, value] of Object.entries(saved)) if (els[key]) els[key].value = value;
    els.syncSummary.textContent = `${payload.meta.recordCount.toLocaleString("zh-TW")} 則公告｜最新：${payload.meta.latestAnnouncementDate}｜近 ${payload.meta.historyDays} 天`;
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
els.results.addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-id]");
  if (!button) return;
  const record = state.records.find((item) => item.id === button.dataset.detailId);
  if (record) openDetail(record);
});
els.detailDialog.addEventListener("click", (event) => {
  if (event.target.closest(".dialog-close") || event.target === els.detailDialog) els.detailDialog.close();
});
start();
