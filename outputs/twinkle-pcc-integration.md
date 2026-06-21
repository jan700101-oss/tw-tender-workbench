# Twinkle `tw-opendata-pcc` 整合規格

## 角色定位

Twinkle `pcc-tender` 是大量標案索引層，用來快速查詢招標公告、決標公告、機關、案名、案號、採購類型、決標金額、得標廠商與聯絡資訊。

它不是官方單案頁替代品。依 skill 文件，`detail_url` 是預留欄位，PCC XML 多半沒有 deep link。因此正式系統必須採雙層資料流：

1. `pcc-tender` 查詢大量候選標案。
2. 以 `title + agency + job_number` 回查政府電子採購網單案頁。
3. 取得 `pk` 或 `pkPmsMain` 後，才開放「直達官方單案」。
4. 再抓附件清單、投標須知、標價清單、契約與圖說。

## 主要查詢

### 室內裝修可投標案

```python
query_rows(
    dataset_id="pcc-tender",
    where="""
      announcement_type='招標公告'
      AND procurement_attr='工程類'
      AND date >= '2026-06-12'
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

### 1 億元以下工程招標候選

PCC 招標公告資料未必有完整預算欄位；若查詢結果缺預算，需進官方單案頁補齊。

```python
query_rows(
    dataset_id="pcc-tender",
    where="""
      announcement_type='招標公告'
      AND procurement_attr='工程類'
      AND date >= '2026-06-12'
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
    limit=500
)
```

### 歷史決標與報價分析

```python
query_rows(
    dataset_id="pcc-tender",
    where="""
      announcement_type='決標公告'
      AND procurement_attr='工程類'
      AND award_price <= 100000000
      AND date >= '2024-01-01'
      AND (title LIKE '%裝修%' OR title LIKE '%整修%' OR title LIKE '%修繕%')
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

## 前台規則

- `pcc-tender` 結果可顯示為「PCC 候選標案」。
- 尚未取得政府單案 URL 時，不顯示「官方直達」。
- 通過單案頁核對後，狀態才變為「官方核對」。
- 投標須知未下載前，文書解析狀態必須是「待解析」。

## 目前環境狀態

目前 Codex 工作區尚未暴露 `query_rows("pcc-tender")` MCP tool。前台只能顯示連線規格與查詢模板，不應顯示假的全量查詢結果。
