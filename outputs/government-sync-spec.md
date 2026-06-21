# 政府電子採購網同步器規格

## 目標

建立可持續更新的政府標案資料管線，讓平台每天取得新標案、年度標案、更正公告、決標與附件清單。所有前台資料必須能回到政府正式來源。

## 雙層資料來源

1. **Twinkle `pcc-tender` corpus**：大量查詢層，負責快速篩出招標公告、決標公告、機關、案名、案號、採購類型、決標金額與廠商資料。
2. **政府電子採購網單案頁**：事實核對層，負責取得官方 deep link、公告版本、附件清單、投標須知、標價清單、契約與圖說。

`pcc-tender` 的 `detail_url` 目前是預留欄位，XML 無 deep link，因此不能只靠 Twinkle 資料開放官方直達。

## 同步範圍

- 招標公告
- 更正公告
- 決標公告
- 無法決標/流標
- 公開徵求
- 附件清單
- 投標須知、標價清單、契約草案、施工規範、圖說

## 核心資料表

### tenders

- `id`
- `year`
- `case_no`
- `title`
- `agency_name`
- `agency_code`
- `category`
- `region`
- `budget_amount`
- `deadline_at`
- `open_at`
- `status`
- `source_id`
- `created_at`
- `updated_at`

### official_sources

- `id`
- `tender_id`
- `source_url`
- `source_pk`
- `source_type`
- `source_version`
- `source_fetched_at`
- `source_hash`
- `compare_status`
- `raw_html_path`

### attachments

- `id`
- `tender_id`
- `source_version`
- `file_name`
- `file_type`
- `file_url`
- `file_hash`
- `document_role`
- `download_status`
- `parsed_status`

### notice_parses

- `id`
- `attachment_id`
- `requirement_type`
- `requirement_text`
- `source_page`
- `source_clause`
- `confidence`
- `human_review_status`

### change_logs

- `id`
- `tender_id`
- `change_type`
- `field_name`
- `old_value`
- `new_value`
- `source_version`
- `detected_at`

### sync_runs

- `id`
- `started_at`
- `finished_at`
- `year`
- `mode`
- `status`
- `fetched_count`
- `created_count`
- `updated_count`
- `error_count`
- `notes`

## 同步流程

1. 依年度與公告日期抓取政府清單。
2. 進入每筆清單的單案頁，保存 `source_url` 與 `source_pk`。
3. 解析案名、機關、案號、預算、截止日、公告狀態。
4. 執行資料誠信檢查：案名、機關、案號、pk 不得衝突。
5. 計算 `source_hash`。
6. 若 `source_hash` 改變，建立更正公告或資料差異紀錄。
7. 抓取附件清單並計算附件 hash。
8. 標記投標須知、標價清單、契約、施工規範、圖說。
9. 下載附件並送入解析器。
10. 更新前台可見資料與提醒。

## 前台可見條件

- `source_url` 已存在。
- `source_pk` 已存在。
- 案名、機關、案號已核對。
- 若附件未取得，需顯示待取得。
- 若投標須知未解析，需顯示待解析。
- 若資料有衝突，禁止顯示官方直達。

## 年度更新

- 每年建立新的 `year` 分區。
- 歷史年度不可刪除，供決標與報價分析。
- 新年度資料可與舊年度同機關、同工項、同得標廠商比對。

## 錯誤處理

- 政府頁無法讀取：保留同步錯誤紀錄，不進前台。
- 單案 URL 重複指向不同案名：關閉官方直達。
- 附件下載失敗：標示附件待取得。
- 解析信心不足：標示需人工確認。
