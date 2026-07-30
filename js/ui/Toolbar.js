/**
 * Toolbar.js - 工具列、圖檔雙匯出與全套剪貼簿快捷鍵 (平鋪 i18n 整合)
 */

import { SvgExporter } from "../renderer/SvgExporter.js";
import { PngExporter } from "../renderer/PngExporter.js";
import { i18n } from "../core/I18nManager.js";
import { ToastNotification } from "./ToastNotification.js";
import { StateManager } from "../core/StateManager.js";

export class Toolbar {
    /**
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     * @param {import("../renderer/CanvasRenderer.js").CanvasRenderer} [renderer]
     */
    constructor(stateManager, renderer) {
        this.state = stateManager;
        this.renderer = renderer;
        this.init();
    }

    init() {
        const toolButtons = document.querySelectorAll(".tool-btn");
        toolButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                toolButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const tool = btn.dataset.tool;

                if (tool === "floor") {
                    this.state.activeTool = "pencil";
                    this.state.brushType = "floor";
                } else if (tool === "wall") {
                    this.state.activeTool = "pencil";
                    this.state.brushType = "wall";
                } else if (tool === "erase-floor") {
                    this.state.activeTool = "erase-floor";
                    this.state.brushType = "floor";
                } else if (tool === "erase-wall") {
                    this.state.activeTool = "erase-wall";
                    this.state.brushType = "wall";
                } else if (tool === "select") {
                    this.state.activeTool = "select";
                }

                if (tool !== "select") {
                    this.state.selectedCell = null;
                    this.state.selectionBox = null;
                }

                this.state.notifyStateChange();
            });
        });

        document.querySelectorAll(".shape-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".shape-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.state.shapeMode = btn.dataset.shape;
            });
        });

        const btnSvg = document.getElementById("btn-export-svg");
        const btnPng = document.getElementById("btn-export-png");

        btnSvg?.addEventListener("click", () => {
            SvgExporter.exportToSvg(this.state);
        });

        btnPng?.addEventListener("click", () => {
            PngExporter.exportToPng(this.state, this.renderer);
        });

        const inputWorldX = document.getElementById("input-world-x");
        const inputWorldY = document.getElementById("input-world-y");

        if (inputWorldX && inputWorldY) {
            inputWorldX.value = this.state.scheme.worldOriginX || 10500;
            inputWorldY.value = this.state.scheme.worldOriginY || 9200;

            const handleOriginChange = () => {
                const wx = parseInt(inputWorldX.value, 10) || 0;
                const wy = parseInt(inputWorldY.value, 10) || 0;
                this.state.setWorldOrigin(wx, wy);
            };

            inputWorldX.addEventListener("change", handleOriginChange);
            inputWorldY.addEventListener("change", handleOriginChange);
        }

        const chk3DWalls = document.getElementById("chk-3d-walls");
        chk3DWalls?.addEventListener("change", (e) => {
            this.state.is3DWallsEnabled = e.target.checked;
            this.state.notifyStateChange();
        });

        const btnFloorUp = document.getElementById("floor-up");
        const btnFloorDown = document.getElementById("floor-down");
        const displayFloor = document.getElementById("current-floor-display");
        const chkGhost = document.getElementById("chk-ghost-layer");

        const updateFloorDisplay = () => {
            if (displayFloor) {
                displayFloor.textContent = StateManager.toDisplayZ(this.state.currentZLevel);
            }
        };

        btnFloorUp?.addEventListener("click", () => {
            this.state.setZLevel(this.state.currentZLevel + 1);
            updateFloorDisplay();
        });

        btnFloorDown?.addEventListener("click", () => {
            this.state.setZLevel(this.state.currentZLevel - 1);
            updateFloorDisplay();
        });

        chkGhost?.addEventListener("change", (e) => {
            this.state.ghostLayerEnabled = e.target.checked;
            this.state.notifyStateChange();
        });

        window.addEventListener("langchange", updateFloorDisplay);

        const btnUndo = document.getElementById("btn-undo");
        const btnRedo = document.getElementById("btn-redo");

        btnUndo?.addEventListener("click", () => this.state.undo());
        btnRedo?.addEventListener("click", () => this.state.redo());

        window.addEventListener("keydown", (e) => {
            if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === "z") {
                    e.preventDefault();
                    if (e.shiftKey) this.state.redo();
                    else this.state.undo();
                } else if (key === "y") {
                    e.preventDefault();
                    this.state.redo();
                } else if (key === "c") {
                    e.preventDefault();
                    if (this.state.copySelection()) {
                        ToastNotification.show(i18n.t("export_copy_clipboard_success"));
                    }
                } else if (key === "v") {
                    e.preventDefault();
                    if (this.state.clipboard) {
                        this.state.isPastingMode = true;
                        this.state.notifyStateChange();
                    }
                }
            } else if (e.key === "Delete" || e.key === "Backspace") {
                if (this.state.deleteSelection()) {
                    e.preventDefault();
                }
            } else if (e.key === "PageUp") {
                e.preventDefault();
                btnFloorUp?.click();
            } else if (e.key === "PageDown") {
                e.preventDefault();
                btnFloorDown?.click();
            }
        });
    }
}
