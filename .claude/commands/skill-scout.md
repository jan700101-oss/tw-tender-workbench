---
description: 每日掃描 GitHub 上適合我的 Claude Code skills / plugins / MCP servers 與相關工具,分類、簡易分析,並挑出最值得安裝的 3-5 個
---

# skill-scout

每天到 GitHub(及必要時網頁)找尋、歸類「我實際能掛上 Claude Code 使用」的能力,
產出一份精簡 digest。

## 使用者輪廓(挑選時請貼合這個方向)

- **本業:室內設計師** —— 重視 3D / CAD / SketchUp / Blender、圖像與素材、設計工作流。
- **興趣:寫給自己用的小程式(hobby / 個人自動化)** —— 偏好輕量、好上手、單機可用的
  開發輔助,不是企業級大型框架。
- 只挑**能真正用上的**:Claude Code skills/plugins、MCP servers、或能接進這個工作流的工具。
  純粹給別的 runtime(OpenClaw/ClawdBot 等)的東西直接略過。

## 掃描來源與方法

1. GitHub `search_repositories`,涵蓋以下方向(各取近期、活躍者):
   - `topic:mcp-server`(篩 3d / cad / sketchup / blender / design / image / figma 等)
   - `topic:claude-code` 或 `claude code skill`(skills / plugins)
   - `sketchup`、`blender mcp`、`figma mcp`、`comfyui mcp`、設計/圖像相關
   - 排序以 `updated` 為主、`stars` 為輔,優先近 1-2 個月有更新者。
2. 需要補充生態現況時用 `WebSearch`(例如「best MCP servers for designers 2026」)。

## 判準(重要)

- **星數會灌水,不能當可信度**。這一區有大量刷星倉庫(連玩笑 skill 都數萬星)。
- 優先:官方 / 知名維護者 / 近期活躍 / README 清楚 / 授權明確。
- 對「不明發布者 + 要求廣泛權限 / 執行任意程式碼」保持警覺,標註風險。
- MCP server 要看它需要什麼(本機軟體?API 金鑰?網路存取?)。

## 輸出格式

1. **分類清單(10-20 項)**,依 3 大類:`3D/CAD/設計`、`圖像/素材`、`個人開發/Claude Code 技能`。
   每項一行:名稱 + 連結 + 一句「做什麼 + 為何跟我相關」+(必要時)信任/風險註記。
2. **最值得安裝的 3-5 個**:每個給
   - 為什麼特別適合(對照上面的輪廓)
   - 具體安裝方式(指令 / `.mcp.json` 片段 / skill 路徑)
   - 需要的前置條件與風險
3. 把整份報告存到 `skill-scout/reports/YYYY-MM-DD.md`(日期用今天)。

## 注意

- 只做調查與建議,**不要自動安裝**任何東西;安裝要另外經我確認。
- 這個環境是用完即棄的容器,報告請寫檔並(若在排程情境)commit 保存,不要只留在對話裡。
