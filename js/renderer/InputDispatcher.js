/**
 * InputDispatcher.js - Canvas 輸入與互動事件分派器 (Input Event Dispatcher Seam)
 * 負責 Canvas DOM 事件綁定、滑鼠座標反算、相機 Drag/Zoom 與筆刷呼叫分派
 */

import { LevelVisualOffset } from "./GeometryPipeline.js";

export class InputDispatcher {
    /**
     * @param {import("./CanvasRenderer.js").CanvasRenderer} renderer 
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     * @param {import("./BrushActionApplicator.js").BrushActionApplicator} applicator 
     */
    constructor(renderer, stateManager, applicator) {
        this.renderer = renderer;
        this.state = stateManager;
        this.applicator = applicator;

        this.setupEvents();
    }

    /**
     * 計算滑鼠對應的邏輯網格座標與最近邊緣
     */
    getMouseGridPos(e) {
        const rect = this.renderer.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - this.renderer.cameraX) / this.renderer.zoom;
        const worldY = (mouseY - this.renderer.cameraY) / this.renderer.zoom;

        const res = this.renderer.isoMath.screenToGrid(worldX, worldY, this.renderer.currentProgress);
        const z = this.state.currentZLevel;

        const { logicX, logicY } = LevelVisualOffset.toLogicPos(res.cellX, res.cellY, z, this.renderer.currentProgress);

        const localX = res.gridX - res.cellX;
        const localY = res.gridY - res.cellY;

        let edge = "north";
        if (localY < 0.25) edge = "north";
        else if (localY > 0.75) edge = "south";
        else if (localX < 0.25) edge = "west";
        else if (localX > 0.75) edge = "east";
        else edge = (localY < localX) ? "north" : "west";

        return { cellX: logicX, cellY: logicY, edge };
    }

    setupEvents() {
        const el = this.renderer.canvas;

        el.addEventListener("mousedown", (e) => {
            const { cellX, cellY, edge } = this.getMouseGridPos(e);

            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                this.renderer.isDraggingCamera = true;
                this.renderer.lastMouseX = e.clientX;
                this.renderer.lastMouseY = e.clientY;
                el.style.cursor = "grabbing";
                return;
            }

            if (e.button === 2) {
                e.preventDefault();
                this.state.pushHistory();
                this.renderer.isRightPainting = true;
                this.applicator.applyRightClickErase(cellX, cellY, edge);
                return;
            }

            if (e.button === 0) {
                const tool = this.state.activeTool;
                const shape = this.state.shapeMode;

                if (this.state.isPastingMode) {
                    this.state.pasteSelection(cellX, cellY);
                    this.renderer.requestRender();
                    return;
                }

                if (tool === "select") {
                    if (shape === "single") {
                        if (cellX >= 0 && cellX < this.state.scheme.width &&
                            cellY >= 0 && cellY < this.state.scheme.height) {
                            this.state.selectedCell = { x: cellX, y: cellY };
                            this.state.selectionBox = null;
                            this.state.notifyStateChange();
                        }
                    } else if (shape === "box") {
                        if (!this.renderer.shapeStartCell) {
                            this.renderer.shapeStartCell = { x: cellX, y: cellY };
                            this.renderer.requestRender();
                        } else {
                            const minX = Math.min(this.renderer.shapeStartCell.x, cellX);
                            const maxX = Math.max(this.renderer.shapeStartCell.x, cellX);
                            const minY = Math.min(this.renderer.shapeStartCell.y, cellY);
                            const maxY = Math.max(this.renderer.shapeStartCell.y, cellY);

                            this.state.selectionBox = { minX, minY, maxX, maxY };
                            this.state.selectedCell = { x: minX, y: minY };
                            this.renderer.shapeStartCell = null;
                            this.state.notifyStateChange();
                        }
                    }
                    return;
                }

                if (shape === "single") {
                    this.state.pushHistory();
                    this.renderer.isPainting = true;
                    this.applicator.applyBrushAt(cellX, cellY, edge);
                } else if (shape === "line" || shape === "box") {
                    if (!this.renderer.shapeStartCell) {
                        this.renderer.shapeStartCell = { x: cellX, y: cellY, edge };
                        this.renderer.requestRender();
                    } else {
                        const start = this.renderer.shapeStartCell;
                        this.applicator.applyShapeBrush(start, { x: cellX, y: cellY, edge });
                        this.renderer.shapeStartCell = null;
                        this.renderer.requestRender();
                    }
                }
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (this.renderer.isDraggingCamera) {
                const dx = e.clientX - this.renderer.lastMouseX;
                const dy = e.clientY - this.renderer.lastMouseY;
                this.renderer.cameraX += dx;
                this.renderer.cameraY += dy;
                this.renderer.lastMouseX = e.clientX;
                this.renderer.lastMouseY = e.clientY;
                this.renderer.requestRender();
            } else {
                const { cellX, cellY, edge } = this.getMouseGridPos(e);
                if (cellX !== this.renderer.hoveredCell.x || cellY !== this.renderer.hoveredCell.y || edge !== this.renderer.hoveredCell.edge) {
                    this.renderer.hoveredCell = { x: cellX, y: cellY, edge };
                    this.renderer.requestRender();

                    const displayX = cellX + 1;
                    const displayY = cellY + 1;
                    const gameX = (this.state.scheme.worldOriginX || 10500) + cellX;
                    const gameY = (this.state.scheme.worldOriginY || 9200) + cellY;

                    const event = new CustomEvent("gridhover", {
                        detail: {
                            x: displayX,
                            y: displayY,
                            gameX,
                            gameY
                        }
                    });
                    window.dispatchEvent(event);
                }

                if (this.renderer.isRightPainting) {
                    this.applicator.applyRightClickErase(cellX, cellY, edge);
                } else if (this.renderer.isPainting && this.state.shapeMode === "single") {
                    this.applicator.applyBrushAt(cellX, cellY, edge);
                }
            }
        });

        const handleMouseUp = () => {
            if (this.renderer.isDraggingCamera) {
                this.renderer.isDraggingCamera = false;
                el.style.cursor = "default";
            }
            if (this.renderer.isPainting || this.renderer.isRightPainting) {
                this.renderer.isPainting = false;
                this.renderer.isRightPainting = false;
                this.state.pushHistory();
            }
        };

        window.addEventListener("mouseup", handleMouseUp);
        el.addEventListener("mouseleave", handleMouseUp);

        el.addEventListener("contextmenu", (e) => e.preventDefault());

        el.addEventListener("wheel", (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.max(0.2, Math.min(5.0, this.renderer.zoom * zoomFactor));

            const rect = el.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.renderer.cameraX = mouseX - (mouseX - this.renderer.cameraX) * (newZoom / this.renderer.zoom);
            this.renderer.cameraY = mouseY - (mouseY - this.renderer.cameraY) * (newZoom / this.renderer.zoom);
            this.renderer.zoom = newZoom;

            this.renderer.requestRender();

            const event = new CustomEvent("zoomchange", { detail: { zoom: this.renderer.zoom } });
            window.dispatchEvent(event);
        }, { passive: false });
    }
}
