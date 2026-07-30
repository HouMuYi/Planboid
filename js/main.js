/**
 * main.js - ES Modules 主入口點 (平鋪鍵多語言與選單)
 */

import { StateManager } from "./core/StateManager.js";
import { CanvasRenderer } from "./renderer/CanvasRenderer.js";
import { Toolbar } from "./ui/Toolbar.js";
import { PalettePanel } from "./ui/PalettePanel.js";
import { SchemeModal } from "./ui/SchemeModal.js";
import { AboutModal } from "./ui/AboutModal.js";
import { i18n } from "./core/I18nManager.js";

document.addEventListener("DOMContentLoaded", () => {
    const stateManager = new StateManager();

    const canvas = document.getElementById("main-canvas");
    const renderer = new CanvasRenderer(canvas, stateManager);

    const toolbar = new Toolbar(stateManager, renderer);
    const palettePanel = new PalettePanel(stateManager);
    const schemeModal = new SchemeModal(stateManager);
    const aboutModal = new AboutModal();

    const selectLang = document.getElementById("select-lang");
    if (selectLang) {
        selectLang.value = i18n.currentLang;
        selectLang.addEventListener("change", (e) => {
            i18n.setLanguage(e.target.value);
        });
    }

    i18n.updateDomTranslations();

    window.addEventListener("langchange", () => {
        stateManager.notifyStateChange();
        schemeModal.updateHeaderInfo();
    });

    const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
    const mainSidebar = document.getElementById("main-sidebar");

    btnToggleSidebar?.addEventListener("click", () => {
        mainSidebar?.classList.toggle("collapsed");
        setTimeout(() => {
            renderer.resize();
        }, 320);
    });

    const btnIso = document.getElementById("view-iso");
    const btnFitView = document.getElementById("btn-fit-view");
    const btnResetView = document.getElementById("btn-reset-view");

    btnFitView?.addEventListener("click", () => {
        renderer.fitView();
    });

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

    const infoCoords = document.getElementById("info-coords");
    const infoGameCoords = document.getElementById("info-game-coords");
    const infoZoom = document.getElementById("info-zoom");

    window.addEventListener("gridhover", (e) => {
        const { x, y, gameX, gameY } = e.detail;
        const z = stateManager.currentZLevel;
        const displayZ = StateManager.toDisplayZ(z);
        if (infoCoords) {
            infoCoords.textContent = i18n.t("viewport_info_coords", { x, y, z: displayZ });
        }
        if (infoGameCoords) {
            infoGameCoords.textContent = i18n.t("viewport_info_game_coords", { gameX, gameY });
        }
    });

    window.addEventListener("zoomchange", (e) => {
        if (infoZoom) {
            infoZoom.textContent = i18n.t("viewport_info_zoom", { zoom: Math.round(e.detail.zoom * 100) });
        }
    });

    console.log("🚀 Planboid 線上地塊規劃器啟動成功！");
});
