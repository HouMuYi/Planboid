/**
 * main.js - ES Modules 主入口點 (含 RWD 側邊抽屜與 Resize 自動適應)
 */

import { StateManager } from "./core/StateManager.js";
import { CanvasRenderer } from "./renderer/CanvasRenderer.js";
import { Toolbar } from "./ui/Toolbar.js";
import { PalettePanel } from "./ui/PalettePanel.js";
import { SchemeModal } from "./ui/SchemeModal.js";
import { AboutModal } from "./ui/AboutModal.js";

document.addEventListener("DOMContentLoaded", () => {
    // 1. 初始化狀態管理器
    const stateManager = new StateManager();

    // 2. 初始化 Canvas 繪圖引擎
    const canvas = document.getElementById("main-canvas");
    const renderer = new CanvasRenderer(canvas, stateManager);

    // 3. 初始化 UI 元件與綁定
    const toolbar = new Toolbar(stateManager);
    const palettePanel = new PalettePanel(stateManager);
    const schemeModal = new SchemeModal(stateManager);
    const aboutModal = new AboutModal();

    // 4. RWD 右側側邊欄摺疊/展開抽屜切換
    const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
    const mainSidebar = document.getElementById("main-sidebar");

    btnToggleSidebar?.addEventListener("click", () => {
        mainSidebar?.classList.toggle("collapsed");
        // 側邊欄切換動畫結束後，重新校準 Canvas 尺寸
        setTimeout(() => {
            renderer.resize();
        }, 320);
    });

    // 5. 視角切換控制
    const btnIso = document.getElementById("view-iso");
    const btnOrtho = document.getElementById("view-ortho");
    const btnResetView = document.getElementById("btn-reset-view");

    btnIso?.addEventListener("click", () => {
        btnIso.classList.add("active");
        btnOrtho?.classList.remove("active");
        renderer.setViewMode("iso");
    });

    btnOrtho?.addEventListener("click", () => {
        btnOrtho.classList.add("active");
        btnIso?.classList.remove("active");
        renderer.setViewMode("ortho");
    });

    btnResetView?.addEventListener("click", () => {
        renderer.zoom = 1.0;
        renderer.centerCamera();
        renderer.requestRender();
    });

    // 6. 滑鼠懸停與座標更新
    const infoCoords = document.getElementById("info-coords");
    const infoGameCoords = document.getElementById("info-game-coords");
    const infoZoom = document.getElementById("info-zoom");

    window.addEventListener("gridhover", (e) => {
        const { x, y, gameX, gameY } = e.detail;
        const z = stateManager.currentZLevel;
        if (infoCoords) infoCoords.textContent = `網格: (${x}, ${y}), Z: ${z === 0 ? "0F (地面)" : z + "F"}`;
        if (infoGameCoords) infoGameCoords.textContent = `PZ座標: (${gameX}, ${gameY})`;
    });

    window.addEventListener("zoomchange", (e) => {
        if (infoZoom) infoZoom.textContent = `Zoom: ${Math.round(e.detail.zoom * 100)}%`;
    });

    console.log("🚀 Planboid 線上地塊規劃器啟動成功！");
});
