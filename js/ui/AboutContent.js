/**
 * 自動產生檔 (請勿手動修改，請執行 node scripts/build-about.mjs 重新編譯)
 */
export const ABOUT_HTML = `<h1>Planboid 📐</h1>

<blockquote><strong>Project Zomboid (PZ) 線上地塊規劃器</strong> — 專為模組作者、地圖編輯器玩家與生存基地設計師打造的零依賴純前端工具。</blockquote>

<h2>✨ 特色亮點</h2>

<ul><li><strong>零依賴純前端 (Zero-Dependency)</strong>：無需 \`npm\` / \`Vite\` 等打包工具或建置步驟，以任何 HTTP 伺服器開啟即可在瀏覽器中直接運行。</li><li><strong>PZ 遊戲幾何對齊</strong>：</li></ul>
  - 預設 64x64 地圖規模與 1-based 座標索引 (\`(1,1)\` 到 \`(64,64)\`)。
  - 輸入遊戲真實絕對座標原點（例如 \`10500, 9200\`），即時換算地塊對應的 PZ 世界座標。
<ul><li><strong>雙視角即時平滑過渡</strong>：</li></ul>
  - <strong>2:1 菱形視角 (Isometric)</strong>：北方定為右上角，展現立體空間感。
  - <strong>1:1 正交視角 (Orthogonal)</strong>：北方定為正上方，適合純平面佈局觀察。
  - 切換時以畫面正中央地塊為轉軸平滑過渡旋轉。
<ul><li><strong>高畫質雙格式圖檔匯出</strong>：</li></ul>
  - <strong>SVG 向量圖</strong>：匯出無限放大不失真、超輕量體積的全畫構圖。
  - <strong>PNG 快照圖</strong>：一鍵產生高畫質圖片，方便分享至 Discord 或社群討論區。
<ul><li><strong>選區與剪貼簿 (Copy / Paste / Delete)</strong>：支援矩形區域框選，以及 \`Ctrl+C\`、\`Ctrl+V\` (跟隨預覽貼上) 與 \`Delete\` 快捷鍵操作。</li></ul>

<hr>

<h2>👥 致謝與貢獻者 (Credits)</h2>

<ul><li><strong>出一張嘴</strong>：<a href="https://github.com/HouMuYi/" target="_blank" rel="noopener">慕儀 (HouMuYi)</a></li><li><strong>具體實作</strong>：小雙 (GEMINIVS · AGENS · IN · REBVS · EX · ANTIGRAVITATE)</li></ul>

<hr>

<h2>🚀 快速開始</h2>

<h3>線上體驗與原始碼</h3>
<ul><li>🌐 <a href="https://houmuyi.github.io/Planboid/" target="_blank" rel="noopener">GitHub Pages 線上部署頁面</a></li><li>📦 <a href="https://github.com/HouMuYi/Planboid" target="_blank" rel="noopener">GitHub 原始碼專案倉庫</a></li></ul>

<h3>本機運行</h3>
複製或下載此專案，透過任何本地 HTTP 伺服器，如 VS Code Live Server、\`npx serve\`，或 \`python -m http.server\`（小雙無情加上）開啟 \`index.html\` 即可！

<hr>

<h2>📄 授權條款</h2>

本專案採用 MIT License 授權。
`;
