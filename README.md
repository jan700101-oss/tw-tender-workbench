# 標案工務台

臺灣政府標案搜尋網站:每日同步政府電子採購網公開資料,提供比官方網站好用的搜尋、篩選與收藏。

網站:https://jan700101-oss.github.io/tw-tender-workbench/

## 架構

```
政府電子採購網公開 XML(資料集下載頁)
        │  GitHub Actions 每日 08:30 / 18:30(台北時間)自動執行
        ▼
scripts/sync.mjs  下載 → 解析 → 驗證 → 產出
        ▼
docs/data/        index.json(同步狀態)+ tenders-YYYY-MM.json(月分片資料)
        ▼
docs/             靜態網站(GitHub Pages),前端直接搜尋 JSON 資料
```

## 資料誠信原則

- 所有欄位皆來自政府公開 XML,不以推測補齊。
- **公告日期**取自官方每日清單檔檔名(`tender_YYYYMMDD.xml` = 該日公告)。
- **截止投標日**為官方 `TENDER_SPDT` 欄位;缺漏時明確顯示「截止日未提供」。
- 每筆標案附「官方查詢」與「來源檔」連結,可回到政府正式來源核對。
- 同步失敗時保留上一版資料,網站顯示警示,不讓錯誤資料上線。
- 保留最近 92 天公告;截止日未到的案件即使超過保留期也不會被刪除。

## 功能

- 關鍵字搜尋案名/案號/機關(空白分隔 = AND,`-詞` = 排除)
- 篩選:類別(工程/財物/勞務)、招標方式、機關、公告日期範圍、僅顯示尚未截止
- 排序:公告日或截止日
- 收藏標案、儲存常用搜尋條件(保存於瀏覽器 localStorage,重新整理不消失)
- 同步狀態顯示於頁尾;資料過期或同步失敗會出現警示橫幅

## 手動同步

GitHub Actions 之外,也可在任何有 Node.js 20+ 的電腦執行:

```
node scripts/sync.mjs            # 正式同步(需可連線 web.pcc.gov.tw)
node scripts/sync.mjs --discover # 額外輸出政府 XML 欄位樣本
git add docs/data && git commit -m "更新標案資料" && git push
```

## 未來擴充(尚未實作)

`outputs/` 內的規劃文件描述決標資料、附件解析等後續階段;目前僅同步招標公告,
其他檔案類型名稱會記錄在 `docs/data/index.json` 的 `discoveredFiles` 供評估。
