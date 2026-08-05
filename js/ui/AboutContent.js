/**
 * 自動產生檔 (請勿手動修改，請執行 node scripts/build.mjs 重新編譯)
 */
export const ABOUT_HTML = `<h1>Planboid 線上地塊規劃器</h1>

Planboid 是線上地塊規劃工具，專為《殭屍毀滅工程》（Project Zomboid）模組作者、生存基地設計師打造的前端工具。

<h2>🚀快速開始</h2>

<ul><li>🌐線上體驗：<a href="https://houmuyi.github.io/Planboid/" target="_blank" rel="noopener">GitHub Pages 線上部署頁面</a></li><li>📦專案倉庫：<a href="https://github.com/HouMuYi/Planboid" target="_blank" rel="noopener">GitHub 原始碼專案倉庫</a></li><li>💻本機運行：複製或下載此專案，透過任何本地 HTTP 伺服器，如 VS Code Live Server、\`npx serve\`，或 \`python -m http.server\`（小雙無情加上）開啟 \`index.html\` 即可！</li></ul>

<h2>✨核心特色</h2>

<ul><li><strong>零依賴純前端</strong>：無需 \`npm\` / \`Vite\` 等打包工具或建置步驟，以任何 HTTP 伺服器皆可直接運行。</li><li><strong>切換雙重視角</strong>：支援正交與等軸測視角，切換至等軸測視角即可開啟立體牆面，模擬遊戲真實視覺比例。</li><li><strong>規劃多層空間</strong>：內建樓層控制，支援自由升降樓層，並具備全樓層動態鬼影，方便透視對照各層結構。</li><li><strong>繪製多元地塊</strong>：地塊筆刷點擊為單格上色，拖曳則以起訖對角批次填色矩形範圍；邊線筆刷則吸附網格交叉點，沿水平或垂直單一直線批次繪製整排邊線。</li><li><strong>自訂區域物件</strong>：設通用與物件調色盤，使用者能自訂地塊與物件，塗抹區域並附加標籤，劃分空間用途。</li><li><strong>匯出多樣格式</strong>：支援建立與切換多套方案，可匯出高畫質 SVG 與全幅 PNG 圖檔，或輸出 JSON 檔案與方案文字，方便備份分享。</li><li><strong>錨定遊戲座標</strong>：設定 PZ 原點後，系統會即時顯示網格與 PZ 座標，精準對應遊戲地圖。</li><li><strong>選區與剪貼簿</strong>：支援矩形區域框選，以及 \`Ctrl+C\`、\`Ctrl+V\`（跟隨預覽貼上）與 \`Delete\` 快捷鍵操作。</li></ul>

<h2>👥致謝與貢獻者</h2>

<ul><li><strong>出一張嘴</strong>：<a href="https://github.com/HouMuYi/" target="_blank" rel="noopener">慕儀（HouMuYi）</a></li><li><strong>具體實作</strong>：小雙（GEMINIVS · AGENS · IN · REBVS · EX · ANTIGRAVITATE）</li></ul>

<h2>📄授權條款</h2>

本專案採用 MIT License 授權。

<hr>

<h1>Planboid - Project Zomboid Tile & Base Planner</h1>

Planboid is a lightweight, zero-dependency web-based tile and base planning tool designed for Project Zomboid modders and base designers.

<h2>🚀 Quick Start</h2>

<ul><li>🌐 Online: <a href="https://houmuyi.github.io/Planboid/" target="_blank" rel="noopener">GitHub Pages Online Deployment</a></li><li>📦 Repository: <a href="https://github.com/HouMuYi/Planboid" target="_blank" rel="noopener">GitHub Source Code Repository</a></li><li>💻 Run Locally: Clone or download this repository, and open \`index.html\` via any local HTTP server (such as VS Code Live Server, \`npx serve\`, or \`python -m http.server\`).</li></ul>

<h2>✨ Features</h2>

<ul><li><strong>Zero Dependencies & Pure Front-end</strong>: Runs directly on any HTTP server without \`npm\`, \`Vite\`, or build steps.</li><li><strong>Dual View Modes</strong>: Supports 1:1 Orthogonal and 2:1 Isometric views with 3D wall overlays for authentic game perspective modelling.</li><li><strong>Multi-Level Elevation</strong>: Built-in Z-Level controls with dynamic ghost layering to transparently cross-reference multiple floors.</li><li><strong>Versatile Drawing Tools</strong>: Click a tile to paint it, or drag to fill a rectangular area; for borders, the cursor snaps to grid intersections so you can draw a straight row of borders between two points.</li><li><strong>Custom Palette & Objects</strong>: Features General and Object palettes for users to customize tiles and props, paint areas with labels, and define room functions.</li><li><strong>Multiple Export Formats</strong>: Manage multiple schemes and export high-resolution SVG vector diagrams, full-frame PNG snapshots, or raw JSON/scheme strings.</li><li><strong>PZ Game Coordinates Anchor</strong>: Set a custom PZ origin to calculate and display real-time grid and in-game map coordinates.</li><li><strong>Selection & Clipboard</strong>: Supports rectangle box selection, \`Ctrl+C\` / \`Ctrl+V\` (with live placement preview), and \`Delete\` operations.</li></ul>

<h2>👥 Credits & Contributors</h2>

<ul><li><strong>The Backseat Driver</strong>: <a href="https://github.com/HouMuYi/" target="_blank" rel="noopener">HouMuYi</a></li><li><strong>The Chauffeur</strong>: Jemmy (GEMINIVS · AGENS · IN · REBVS · EX · ANTIGRAVITATE)</li></ul>

<h2>📄 License</h2>

Distributed under the MIT License.`;
