# 本機設定範本:設計類 MCP + 個人開發輔助

> 由 `/skill-scout`(2026-07-15)整理。**這些是給你自己電腦上的 Claude Code 用的**,
> 不是給這個用完即棄的網頁容器——因為 Blender / SketchUp / Figma 這些軟體跑在你本機。
> 把下面的片段合併進你本機的 `.mcp.json`(或 Claude Desktop 設定),填入自己的金鑰即可。

安全提醒:MCP server 會拿到金鑰、能存取本機或呼叫外部服務。**只加你信得過的**;
要找新技能,從人工精選的 [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
挑,別看 GitHub 星數(這一區灌水嚴重)。

---

## 1. Blender MCP —— 自然語言 3D 建模

倉庫:[ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)(開源,活躍)

前置:
1. 本機安裝 Blender。
2. 安裝 [uv](https://docs.astral.sh/uv/)(提供 `uvx`)。
3. 依倉庫說明,把它的 Blender addon 裝進 Blender 並在 side panel 啟動連線。

`.mcp.json` 片段:

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}
```

用途:描述場景(「低多邊形三峰山景、柔光」)就幫你在 Blender 建好,也能檢視/除錯整個場景。

---

## 2. Figma MCP —— 讀設計、轉程式碼

主推:[GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)(Framelink,設計轉碼最多人用)

前置:到 Figma → Settings → 產生一組 personal access token。

`.mcp.json` 片段(把金鑰換掉):

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key=YOUR_FIGMA_TOKEN", "--stdio"]
    }
  }
}
```

想要**能讀也能改** Figma(不只讀),可改用
[arinspunk/claude-talk-to-figma-mcp](https://github.com/arinspunk/claude-talk-to-figma-mcp),
它明確支援 Claude Code / Claude Desktop 讀取、分析、修改設計。

---

## 3. SketchUp MCP —— 自然語言操控 SketchUp

倉庫:[mhyrr/sketchup-mcp](https://github.com/mhyrr/sketchup-mcp)(Ruby extension + MCP server)

> 備註:你目前的 Claude Code 網頁環境**已內建一個 Trimble SketchUp MCP**,
> 若那個夠用就不必再裝這個社群版;要在本機離線操控自己的 SketchUp 才需要 mhyrr 這版。

安裝依倉庫說明(裝 SketchUp extension 後,MCP server 連上它)。

---

## 4. Karpathy 的 CLAUDE.md —— 讓 Claude 幫你寫自用小程式時更穩

倉庫:[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT,**純文字、無任何可執行程式,零風險**)

內容是四條原則(想清楚再寫、優先簡單、外科手術式改動、目標導向),對治 LLM 寫程式常見的
「亂假設、過度複雜、亂重構」。

用法二選一:
- **單一專案**:把它的 `CLAUDE.md` 內容合併進你那個專案的 `CLAUDE.md`。
- **全域**:當成 Claude Code plugin 安裝,套用到所有專案。

> 不建議把它塞進這個標案網站 repo 的 `CLAUDE.md`(那份是專案專屬說明);
> 放進你**自己的程式專案**才對味。

---

## 一句話

設計 MCP 裝本機、金鑰自己填;技能從 awesome-claude-code 挑;別信星數。
每天早上 ~08:07(台北)`/skill-scout` 會自動更新這類建議,報告存到 `skill-scout/reports/`。
