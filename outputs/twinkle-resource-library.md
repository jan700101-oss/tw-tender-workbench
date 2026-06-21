# Twinkle Hub 資源庫

## 使用原則

Twinkle Hub 可以作為台灣公開資料的查詢入口，但不能取代官方來源。對標案產品而言，Twinkle 適合做大量索引、搜尋、歷史分析；政府電子採購網單案頁才是官方核對與附件來源。

鐵律：

- 查詢結果可以當候選資料。
- 官方直達必須回到政府單案頁。
- 沒有 `pk` / `pkPmsMain`、案名、機關、案號一致核對，就不能標示為已核對。
- 不能把 Twinkle 查詢結果、樣本資料或 AI 推測包裝成正式標案。
- 不把公司內部資料、投標策略、報價底稿送進第三方 MCP 查詢。

## Twinkle Hub 概況

- 網站：https://hub.twinkleai.tw/
- 型態：Taiwan data MCP Hub。
- 支援：MCP endpoint，可被 Claude、OpenAI Codex CLI、GitHub Copilot CLI、自建 agent 等 MCP client 使用。
- 資料方向：台灣 open data、工具函式、官方 skills。
- 隱私重點：會記錄 MCP tool call metadata，例如工具名、時間、成本、回應大小、IP；查詢參數會送到 Twinkle MCP gateway。
- 使用限制：目前公開頁顯示 alpha 服務，註冊/金鑰流程可能受維護或政策調整影響。

## 對本專案最有用的資源

### 1. tw-opendata-pcc

用途：

- 政府電子採購網 PCC 招標公告、決標公告查詢。
- 查案名、機關、案號、採購類型、決標金額、得標廠商、聯絡資訊。
- 適合做大量標案入口、歷史決標分析、機關習慣與廠商競爭情報。

資料集：

- `pcc-tender`

主要工具：

```python
query_rows(
    dataset_id="pcc-tender",
    where="announcement_type='招標公告' AND procurement_attr='工程類'",
    columns=["date", "title", "agency", "job_number", "procurement_type", "procurement_attr"],
    limit=100
)
```

重要欄位：

- `date`：公告日期
- `announcement_type`：招標公告 / 決標公告
- `title`：標案名稱
- `agency`：機關名稱
- `job_number`：標案案號
- `companies`：得標廠商，決標公告使用
- `procurement_type`：採購方式
- `procurement_attr`：工程類 / 財物類 / 勞務類
- `award_way`：決標方式
- `award_price`：決標金額，單位是元
- `contact_phone`：承辦電話
- `contact_person`：承辦人

重要限制：

- `detail_url` 是預留欄位，PCC XML 多半沒有 deep link。
- 所以 Twinkle PCC 只能做大量查詢層，不能直接當官方單案直達。
- 單案 URL 必須另由政府電子採購網 resolver 取得。

室內裝修查詢模板：

```python
query_rows(
    dataset_id="pcc-tender",
    where="""
      announcement_type='招標公告'
      AND procurement_attr='工程類'
      AND date >= CURRENT_DATE
      AND (
        title LIKE '%室內裝修%'
        OR title LIKE '%裝修%'
        OR title LIKE '%整修%'
        OR title LIKE '%修繕%'
      )
    """,
    columns=[
      "date",
      "title",
      "agency",
      "job_number",
      "procurement_type",
      "procurement_attr",
      "contact_phone",
      "contact_person"
    ],
    limit=100
)
```

1 億元以下工程歷史決標：

```python
query_rows(
    dataset_id="pcc-tender",
    where="""
      announcement_type='決標公告'
      AND procurement_attr='工程類'
      AND award_price <= 100000000
      AND date >= '2024-01-01'
    """,
    columns=[
      "date",
      "title",
      "agency",
      "companies",
      "award_price",
      "award_way",
      "procurement_type"
    ],
    limit=500
)
```

### 2. tw-opendata-general

用途：

- 查一般政府開放資料。
- 可作為 PCC 以外資料來源補充，例如公司登記、公共設施、政府資料目錄。

本專案可能用途：

- 輔助查廠商、機關、行政區、資料集來源。
- 補政府電子採購網之外的公開資料。

### 3. tw-opendata-judicial

用途：

- 查司法判決與法院資料。

本專案可能用途：

- 查政府採購履約爭議。
- 查廠商與政府採購相關訴訟。
- 風險分析：廠商是否有採購履約糾紛紀錄。

### 4. tw-opendata-geo / GIS

用途：

- 地理、行政區、地址、座標資料。

本專案可能用途：

- 標案地點地圖化。
- 依縣市、行政區、施工地點篩選。
- 計算廠商到工地距離。

### 5. tw-opendata-lvr

用途：

- 不動產實價登錄。

本專案可能用途：

- 若未來做裝修/工程市場分析，可分析區域建案、商辦、住宅價位與裝修需求。

## 本專案的正確資料流

```mermaid
flowchart LR
  A["Twinkle pcc-tender 大量查詢"] --> B["候選標案清單"]
  B --> C["政府電子採購網單案 URL resolver"]
  C --> D["官方單案頁核對"]
  D --> E["附件清單與投標須知"]
  E --> F["投標須知解析"]
  F --> G["資格封/價格封/送件/履約工作流"]
```

## 安全與隱私邊界

可送入 Twinkle：

- 公開標案查詢條件
- 公開機關名稱
- 公開案名
- 公開廠商名稱
- 公開決標資料查詢

不應送入 Twinkle：

- 內部報價底稿
- 未公開投標策略
- 公司財務資料
- 業主或合作廠商私下資訊
- 未公開契約或內部估算

## 之後要做的工程

1. 接上 Twinkle Hub MCP。
2. 呼叫 `query_rows("pcc-tender")` 取得候選標案。
3. 建立政府電子採購網單案 URL resolver。
4. 取得並驗證 `pk` / `pkPmsMain`。
5. 抓附件清單與投標須知。
6. 建立更正公告版本比對。
7. 將已核對資料匯入標案工務台。

## 目前狀態

- 已把 `tw-opendata-pcc` 查詢規則寫入本專案。
- 已建立本機 Codex skill：`C:\Users\user\.codex\skills\tw-opendata-pcc\SKILL.md`
- 目前 Codex 可見工具中尚未暴露 Twinkle `query_rows`。
- 因此目前只能準備查詢模板與資料流，不能假裝已經完成即時查詢。
