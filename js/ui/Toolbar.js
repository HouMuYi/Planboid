/**
 * Toolbar.js - 工具列、圖檔雙匯出與全套剪貼簿快捷鍵
 */

import { SvgExporter } from "../renderer/SvgExporter.js";

export class Toolbar {
    /**
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    constructor(stateManager) {
        this.state = stateManager;
        this.init();
    }

    init() {
        // 工具模式切換 (Pencil / Eraser / Select)
        const toolButtons = document.querySelectorAll(".tool-btn");
        toolButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                toolButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.state.activeTool = btn.dataset.tool;
                if (btn.dataset.tool !== "select") {
                    this.state.selectedCell = null;
                    this.state.selectionBox = null;
                    this.state.notifyStateChange();
                }
            });
        });

        // 繪製形狀 (Single / Line / Box)
        const shapeButtons = document.forEach ? document.querySelectorAll(".shape-btn") : [];
        document.querySelectorAll(".shape-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".shape-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.state.shapeMode = btn.dataset.shape;
            });
        });

        // 筆刷類型 (Floor / Wall)
        document.querySelectorAll(".brush-type-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".brush-type-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.state.brushType = btn.dataset.type;
            });
        });

        // 圖檔匯出 (SVG & PNG)
        const btnSvg = document.getElementById("btn-export-svg");
        const btnPng = document.getElementById("btn-export-png");

        btnSvg?.addEventListener("click", () => {
            SvgExporter.exportToSvg(this.state);
        });

        btnPng?.addEventListener("click", () => {
            const canvas = document.getElementById("main-canvas");
            if (!canvas) return;

            const url = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = url;
            a.download = `${this.state.scheme.name}_snapshot_planboid.png`;
            a.click();
        });

        // 遊戲原點
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

        // PZ 3D 牆面顯示開關
        const chk3DWalls = document.getElementById("chk-3d-walls");
        chk3DWalls?.addEventListener("change", (e) => {
            this.state.is3DWallsEnabled = e.target.checked;
            this.state.notifyStateChange();
        });

        // 樓層控制
        const btnFloorUp = document.getElementById("floor-up");
        const btnFloorDown = document.getElementById("floor-down");
        const displayFloor = document.getElementById("current-floor-display");
        const chkGhost = document.getElementById("chk-ghost-layer");

        const updateFloorDisplay = () => {
            if (displayFloor) {
                const z = this.state.currentZLevel;
                displayFloor.textContent = z === 0 ? "0F (地面層)" : `${z}F`;
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

        // Undo / Redo
        const btnUndo = document.getElementById("btn-undo");
        const btnRedo = document.getElementById("btn-redo");

        btnUndo?.addEventListener("click", () => this.state.undo());
        btnRedo?.addEventListener("click", () => this.state.redo());

        // 鍵盤全套快捷鍵
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
                        alert("已將選擇範圍複製至剪貼簿 (按 Ctrl+V 貼上)");
                    }
                } else if (key === "v") {
                    e.preventDefault();
                    if (this.state.clipboard) {
                        this.state.isPastingMode = true;
                        this.state.notifyStateChange();
                        console.log("📌 進入貼上預覽模式，請移動滑鼠並點擊目標位置。");
                    }
                }
            } else if (e.key === "Delete" || e.key === "Backspace") {
                if (this.state.deleteSelection()) {
                    e.preventDefault();
                }
            }
        });
    }
}
