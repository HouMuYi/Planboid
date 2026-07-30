# Planboid 📐

> **Project Zomboid (PZ) 線上地塊規劃器** — 專為模組作者、地圖編輯器玩家與生存基地設計師打造的零依賴純前端工具。

## ✨ 特色亮點

- **零依賴純前端 (Zero-Dependency)**：無需 `npm` / `Vite` 或任何外部框架，點擊 `index.html` 即可在瀏覽器中直接運行。
- **PZ 遊戲幾何對齊**：
  - 預設 64x64 地圖規模與 1-based 座標索引 (`(1,1)` 到 `(64,64)`)。
  - 輸入遊戲真實絕對座標原點（例如 `10500, 9200`），即時換算地塊對應的 PZ 世界座標。
- **雙視角即時平滑過渡**：
  - **2:1 菱形視角 (Isometric)**：北方定為右上角，展現立體空間感。
  - **1:1 正交視角 (Orthogonal)**：北方定為正上方，適合純平面佈局觀察。
  - 切換時以畫面正中央地塊為轉軸平滑過渡旋轉。
- **高畫質雙格式圖檔匯出**：
  - **SVG 向量圖**：匯出無限放大不失真、超輕量體積的全畫構圖。
  - **PNG 快照圖**：一鍵產生高畫質圖片，方便分享至 Discord 或社群討論區。
- **選區與剪貼簿 (Copy / Paste / Delete)**：支援矩形區域框選，以及 `Ctrl+C`、`Ctrl+V` (跟隨預覽貼上) 與 `Delete` 快捷鍵操作。

---

## 👥 致謝與貢獻者 (Credits)

- **出一張嘴**：[慕儀 (HouMuYi)](https://github.com/HouMuYi/)
- **具體實作**：小雙 (GEMINIVS · AGENS · IN · REBVS · EX · ANTIGRAVITATE)

---

## 🚀 快速開始

### 線上體驗
存取 [GitHub Pages 線上部署頁面](https://houmuyi.github.io/Planboid/) 即可直接開啟使用。

### 本機運行
複製或下載此專案，直接雙擊 `index.html` 在任何現代瀏覽器中開啟即可！

---

## 📄 授權條款

本專案採用 MIT License 授權。
