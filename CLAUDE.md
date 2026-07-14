# CLAUDE.md

給 Claude Code 的專案說明。

## 專案

臺灣政府標案搜尋的純靜態網站(GitHub Pages),發布目錄為 `docs/`,無建置步驟。
資料由 `scripts/sync.mjs` 每日同步至 `docs/data/`。

## Playwright MCP(瀏覽器自動化)

`.mcp.json` 已設定 Playwright MCP server,讓 Claude 可以實際開瀏覽器測試 `docs/` 網站
(搜尋、篩選、收藏等互動)。設定使用環境內預裝的 Chromium
(`/opt/pw-browsers/chromium`),以 headless、`--isolated`、`--no-sandbox` 執行,
不會另外下載瀏覽器。

在本機或其他環境使用時,若沒有預裝瀏覽器,請移除 `.mcp.json` 中的
`--executable-path` 設定,並先執行一次 `npx playwright install chromium`。

### 本機預覽網站供瀏覽器測試

```
python3 -m http.server 8000 --directory docs
# 然後用 Playwright MCP 開 http://localhost:8000/
```

執行時 MCP 會在工作目錄產生 `.playwright-mcp/` 暫存輸出(已列入 `.gitignore`)。
