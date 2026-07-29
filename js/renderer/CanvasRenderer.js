/**
 * CanvasRenderer.js - 精確 PZ 幾何重構引擎 (重構使用 ShapeStrokeEngine 與 GeometryPipeline 深模組)
 */

import { IsoMath } from "./IsoMath.js";
import { ShapeStrokeEngine } from "./ShapeStrokeEngine.js";
import { GeometryPipeline } from "./GeometryPipeline.js";

export class CanvasRenderer {
    /**
     * @param {HTMLCanvasElement} canvas 
     * @param {import("../core/StateManager.js").StateManager} stateManager
     */
    constructor(canvas, stateManager) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.state = stateManager;

        this.isoMath = new IsoMath(32);

        // 相機 (Pan & Zoom)
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoom = 1.0;

        // 視角過渡 (0 = 正交, 1 = 菱形)
        this.currentProgress = 1.0;
        this.targetProgress = 1.0;
        this.transitionSpeed = 0.08;
        this.isAnimating = false;

        // 動態錨定點：切換視角時鎖定的畫面中心網格座標
        this.anchorGridCell = null;

        // 互動與繪圖狀態
        this.isDraggingCamera = false;
        this.isPainting = false;
        this.isRightPainting = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // 多模式繪畫/選區起點
        this.shapeStartCell = null;

        // 懸停地塊
        this.hoveredCell = { x: -1, y: -1, edge: null };

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener("resize", () => this.resize());
        this.setupEvents();
        this.centerCamera();

        window.addEventListener("statechange", () => this.requestRender());
        this.requestRender();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.viewportWidth = rect.width;
        this.viewportHeight = rect.height;

        this.ctx.scale(dpr, dpr);
        this.requestRender();
    }

    centerCamera() {
        const scheme = this.state.scheme;
        const centerPos = this.getScreenPos(scheme.width / 2, scheme.height / 2, this.state.currentZLevel);
        this.cameraX = this.viewportWidth / 2 - centerPos.x * this.zoom;
        this.cameraY = this.viewportHeight / 2 - centerPos.y * this.zoom;
    }

    getCurrentCenterGridCell() {
        const centerScreenX = this.viewportWidth / 2;
        const centerScreenY = this.viewportHeight / 2;

        const worldX = (centerScreenX - this.cameraX) / this.zoom;
        const worldY = (centerScreenY - this.cameraY) / this.zoom;

        const res = this.isoMath.screenToGrid(worldX, worldY, this.currentProgress);
        const z = this.state.currentZLevel;

        let logicX = res.cellX;
        let logicY = res.cellY;

        if (this.currentProgress > 0) {
            const offset = 3 * z * this.currentProgress;
            logicX += offset;
            logicY += offset;
        }

        return { x: logicX, y: logicY };
    }

    setViewMode(mode) {
        this.targetProgress = mode === "iso" ? 1.0 : 0.0;
        this.anchorGridCell = this.getCurrentCenterGridCell();

        if (!this.isAnimating) {
            this.startAnimation();
        }
    }

    startAnimation() {
        this.isAnimating = true;
        const animate = () => {
            const diff = this.targetProgress - this.currentProgress;
            if (Math.abs(diff) < 0.001) {
                this.currentProgress = this.targetProgress;
                this.isAnimating = false;
                this.anchorGridCell = null;
                this.render();
                return;
            }
            this.currentProgress += diff * this.transitionSpeed;

            if (this.anchorGridCell) {
                const z = this.state.currentZLevel;
                const newPos = this.getScreenPos(this.anchorGridCell.x, this.anchorGridCell.y, z);
                this.cameraX = this.viewportWidth / 2 - newPos.x * this.zoom;
                this.cameraY = this.viewportHeight / 2 - newPos.y * this.zoom;
            }

            this.render();
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    requestRender() {
        if (!this.isAnimating) {
            requestAnimationFrame(() => this.render());
        }
    }

    getScreenPos(logicX, logicY, zLevel) {
        let renderX = logicX;
        let renderY = logicY;

        if (this.currentProgress > 0) {
            const offset = 3 * zLevel * this.currentProgress;
            renderX -= offset;
            renderY -= offset;
        }

        return this.isoMath.gridToScreen(renderX, renderY, this.currentProgress);
    }

    desaturateHex(hex, factor = 0.7) {
        if (!hex || hex.length < 7) return "#64748b";
        let r = parseInt(hex.substring(1, 3), 16);
        let g = parseInt(hex.substring(3, 5), 16);
        let b = parseInt(hex.substring(5, 7), 16);

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = Math.round(r + (gray - r) * factor);
        g = Math.round(g + (gray - g) * factor);
        b = Math.round(b + (gray - b) * factor);

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    render() {
        const ctx = this.ctx;
        const w = this.viewportWidth;
        const h = this.viewportHeight;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#0b0f19";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.translate(this.cameraX, this.cameraY);
        ctx.scale(this.zoom, this.zoom);

        // 1. 網格
        this.drawGrid();

        // 2. 全樓層與鬼影淡出渲染
        this.drawAllFloors();

        // 3. 單點與矩形選區
        if (this.state.selectionBox) {
            const { minX, minY, maxX, maxY } = this.state.selectionBox;
            this.drawDashedSelectionBox(minX, minY, maxX, maxY);
        } else if (this.state.selectedCell) {
            const sel = this.state.selectedCell;
            this.drawCellHighlight(sel.x, sel.y, this.state.currentZLevel, "rgba(245, 158, 11, 0.4)", "#f59e0b", 3);
        }

        // 4. 貼上跟隨預覽
        if (this.state.isPastingMode && this.hoveredCell.x >= 0) {
            this.drawPastePreview(this.hoveredCell.x, this.hoveredCell.y);
        }
        // 5. 動態筆刷預覽
        else if (this.shapeStartCell && this.hoveredCell.x >= 0) {
            this.drawShapePreview();
        } else if (this.hoveredCell.x >= 0 && this.hoveredCell.x < this.state.scheme.width &&
                   this.hoveredCell.y >= 0 && this.hoveredCell.y < this.state.scheme.height) {
            const isWallMode = (this.state.brushType === "wall" || this.state.activeTool === "erase-wall");
            if (isWallMode && this.hoveredCell.edge && this.state.activeTool !== "select") {
                this.drawWallHighlight(this.hoveredCell.x, this.hoveredCell.y, this.hoveredCell.edge);
            } else {
                this.drawCellHighlight(this.hoveredCell.x, this.hoveredCell.y, this.state.currentZLevel, "rgba(99, 102, 241, 0.35)", "#6366f1", 1.5);
            }
        }

        ctx.restore();
    }

    drawGrid() {
        const ctx = this.ctx;
        const scheme = this.state.scheme;
        const z = this.state.currentZLevel;

        ctx.lineWidth = 1 / this.zoom;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";

        for (let x = 0; x <= scheme.width; x++) {
            const start = this.getScreenPos(x, 0, z);
            const end = this.getScreenPos(x, scheme.height, z);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        for (let y = 0; y <= scheme.height; y++) {
            const start = this.getScreenPos(0, y, z);
            const end = this.getScreenPos(scheme.width, y, z);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        ctx.strokeStyle = "rgba(99, 102, 241, 0.5)";
        ctx.lineWidth = 2 / this.zoom;
        const p00 = this.getScreenPos(0, 0, z);
        const p10 = this.getScreenPos(scheme.width, 0, z);
        const p11 = this.getScreenPos(scheme.width, scheme.height, z);
        const p01 = this.getScreenPos(0, scheme.height, z);

        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.stroke();
    }

    drawAllFloors() {
        const scheme = this.state.scheme;
        const currentZ = this.state.currentZLevel;
        const palette = scheme.palette;

        const tilesToRender = GeometryPipeline.getSortedTilesToRender(scheme.tiles, currentZ, this.state.ghostLayerEnabled);

        // Pass 1: 無腦先繪製所有地塊 (塊/Floor Polygons)
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, alpha, desatFactor, tile } = item;
            if (tile.floorColorId && palette[tile.floorColorId]) {
                const rawColor = palette[tile.floorColorId].color;
                const finalColor = isCurrent ? rawColor : this.desaturateHex(rawColor, desatFactor);
                this.drawTilePoly(x, y, z, finalColor, alpha);
            }
        });

        // Pass 2: 無腦將所有牆體 (立體 96px 牆面面片與 2D 邊線) 繪製於地塊之上
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, alpha, desatFactor, tile } = item;
            if (tile.walls) {
                Object.entries(tile.walls).forEach(([edge, colorId]) => {
                    if (colorId && palette[colorId]) {
                        const rawColor = palette[colorId].color;
                        const finalColor = isCurrent ? rawColor : this.desaturateHex(rawColor, desatFactor);
                        if (this.state.is3DWallsEnabled && this.currentProgress > 0) {
                            this.drawWallQuad96px(x, y, z, edge, finalColor, alpha * 0.4);
                        } else {
                            this.drawWallLine2D(x, y, z, edge, finalColor, alpha);
                        }
                    }
                });
            }
        });

        // Pass 3: 繪製所有文字標籤
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, tile } = item;
            if (tile.label && isCurrent) {
                this.drawTileText(x, y, z, tile.label);
            }
        });
    }

    drawTilePoly(x, y, z, colorHex, alpha = 1.0) {
        const ctx = this.ctx;
        const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(this.isoMath, x, y, z, this.currentProgress);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colorHex;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawWallLine2D(x, y, z, edge, colorHex, alpha = 1.0) {
        const ctx = this.ctx;
        let p0, p1;

        if (edge === "north") { p0 = this.getScreenPos(x, y, z); p1 = this.getScreenPos(x + 1, y, z); }
        else if (edge === "west") { p0 = this.getScreenPos(x, y, z); p1 = this.getScreenPos(x, y + 1, z); }
        else if (edge === "east") { p0 = this.getScreenPos(x + 1, y, z); p1 = this.getScreenPos(x + 1, y + 1, z); }
        else if (edge === "south") { p0 = this.getScreenPos(x, y + 1, z); p1 = this.getScreenPos(x + 1, y + 1, z); }

        if (!p0 || !p1) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 5 / this.zoom;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.restore();
    }

    drawWallQuad96px(x, y, z, edge, colorHex, fillAlpha = 0.45) {
        const ctx = this.ctx;
        const quad = GeometryPipeline.getWallQuad96Points(this.isoMath, x, y, z, edge, this.currentProgress);
        if (!quad) return;

        const [b0, b1, t1, t0] = quad;

        ctx.save();
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = colorHex;
        ctx.beginPath();
        ctx.moveTo(b0.x, b0.y);
        ctx.lineTo(b1.x, b1.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.lineTo(t0.x, t0.y);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = fillAlpha * 1.8;
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 2 / this.zoom;
        ctx.stroke();

        ctx.restore();
    }

    drawTileText(x, y, z, text) {
        const ctx = this.ctx;
        const center = this.getScreenPos(x + 0.5, y + 0.5, z);

        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.max(10, 12 / this.zoom)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.fillText(text, center.x, center.y);
        ctx.restore();
    }

    drawCellHighlight(x, y, z, fillColor, strokeColor = "#6366f1", strokeWidth = 1.5) {
        const ctx = this.ctx;
        const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(this.isoMath, x, y, z, this.currentProgress);

        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.zoom;

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawDashedSelectionBox(minX, minY, maxX, maxY) {
        const ctx = this.ctx;
        const z = this.state.currentZLevel;

        const p0 = this.getScreenPos(minX, minY, z);
        const p1 = this.getScreenPos(maxX + 1, minY, z);
        const p2 = this.getScreenPos(maxX + 1, maxY + 1, z);
        const p3 = this.getScreenPos(minX, maxY + 1, z);

        ctx.save();
        ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2.5 / this.zoom;
        ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawPastePreview(targetX, targetY) {
        const clip = this.state.clipboard;
        if (!clip || !clip.tiles) return;

        const z = this.state.currentZLevel;
        const palette = this.state.scheme.palette;

        Object.entries(clip.tiles).forEach(([relKey, tileData]) => {
            const [rx, ry] = relKey.split(",").map(Number);
            const x = targetX + rx;
            const y = targetY + ry;

            if (x >= 0 && x < this.state.scheme.width && y >= 0 && y < this.state.scheme.height) {
                if (tileData.floorColorId && palette[tileData.floorColorId]) {
                    this.drawTilePoly(x, y, z, palette[tileData.floorColorId].color, 0.6);
                }
                this.drawCellHighlight(x, y, z, "rgba(16, 185, 129, 0.2)", "#10b981", 1.5);
            }
        });
    }

    drawWallHighlight(x, y, edge) {
        this.drawWallLine2D(x, y, this.state.currentZLevel, edge, "#10b981", 1.0);
    }

    drawShapePreview() {
        if (!this.shapeStartCell) return;

        const x1 = this.shapeStartCell.x;
        const y1 = this.shapeStartCell.y;
        const x2 = this.hoveredCell.x;
        const y2 = this.hoveredCell.y;
        const z = this.state.currentZLevel;
        const tool = this.state.activeTool;
        const shape = this.state.shapeMode;
        const brushType = this.state.brushType;

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        if (tool === "select" && shape === "box") {
            this.drawDashedSelectionBox(minX, minY, maxX, maxY);
            return;
        }

        if (shape === "box") {
            const bounds = ShapeStrokeEngine.getBoxBounds({ x: x1, y: y1 }, { x: x2, y: y2 }, (tool === "erase-wall" ? "wall" : brushType));
            if (brushType === "wall" || tool === "erase-wall") {
                bounds.walls.forEach(w => this.drawWallHighlight(w.x, w.y, w.edge));
            } else {
                bounds.floors.forEach(f => this.drawCellHighlight(f.x, f.y, z, "rgba(16, 185, 129, 0.3)", "#10b981", 1.5));
            }
        } else if (shape === "line") {
            const points = ShapeStrokeEngine.getBresenhamLine(x1, y1, x2, y2);
            points.forEach(p => {
                if (brushType === "wall" || tool === "erase-wall") {
                    this.drawWallHighlight(p.x, p.y, this.shapeStartCell.edge || "north");
                } else {
                    this.drawCellHighlight(p.x, p.y, z, "rgba(99, 102, 241, 0.4)", "#6366f1", 1.5);
                }
            });
        }
    }

    getMouseGridPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - this.cameraX) / this.zoom;
        const worldY = (mouseY - this.cameraY) / this.zoom;

        const res = this.isoMath.screenToGrid(worldX, worldY, this.currentProgress);
        const renderCellX = res.cellX;
        const renderCellY = res.cellY;

        const z = this.state.currentZLevel;

        let logicX = renderCellX;
        let logicY = renderCellY;
        if (this.currentProgress > 0) {
            const offset = 3 * z * this.currentProgress;
            logicX = Math.round(renderCellX + offset);
            logicY = Math.round(renderCellY + offset);
        }

        const localX = res.gridX - renderCellX;
        const localY = res.gridY - renderCellY;

        let edge = "north";
        if (localY < 0.25) edge = "north";
        else if (localY > 0.75) edge = "south";
        else if (localX < 0.25) edge = "west";
        else if (localX > 0.75) edge = "east";
        else edge = (localY < localX) ? "north" : "west";

        return { cellX: logicX, cellY: logicY, edge };
    }

    setupEvents() {
        const el = this.canvas;

        el.addEventListener("mousedown", (e) => {
            const { cellX, cellY, edge } = this.getMouseGridPos(e);

            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                this.isDraggingCamera = true;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                el.style.cursor = "grabbing";
                return;
            }

            if (e.button === 2) {
                e.preventDefault();
                this.isRightPainting = true;
                this.applyRightClickErase(cellX, cellY, edge);
                return;
            }

            if (e.button === 0) {
                const tool = this.state.activeTool;
                const shape = this.state.shapeMode;

                if (this.state.isPastingMode) {
                    this.state.pasteSelection(cellX, cellY);
                    this.requestRender();
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
                        if (!this.shapeStartCell) {
                            this.shapeStartCell = { x: cellX, y: cellY };
                            this.requestRender();
                        } else {
                            const minX = Math.min(this.shapeStartCell.x, cellX);
                            const maxX = Math.max(this.shapeStartCell.x, cellX);
                            const minY = Math.min(this.shapeStartCell.y, cellY);
                            const maxY = Math.max(this.shapeStartCell.y, cellY);

                            this.state.selectionBox = { minX, minY, maxX, maxY };
                            this.state.selectedCell = { x: minX, y: minY };
                            this.shapeStartCell = null;
                            this.state.notifyStateChange();
                        }
                    }
                    return;
                }

                if (shape === "single") {
                    this.isPainting = true;
                    this.applyBrushAt(cellX, cellY, edge);
                } else if (shape === "line" || shape === "box") {
                    if (!this.shapeStartCell) {
                        this.shapeStartCell = { x: cellX, y: cellY, edge };
                        this.requestRender();
                    } else {
                        const start = this.shapeStartCell;
                        this.applyShapeBrush(start, { x: cellX, y: cellY, edge });
                        this.shapeStartCell = null;
                        this.requestRender();
                    }
                }
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (this.isDraggingCamera) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.cameraX += dx;
                this.cameraY += dy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.requestRender();
            } else {
                const { cellX, cellY, edge } = this.getMouseGridPos(e);
                if (cellX !== this.hoveredCell.x || cellY !== this.hoveredCell.y || edge !== this.hoveredCell.edge) {
                    this.hoveredCell = { x: cellX, y: cellY, edge };
                    this.requestRender();

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

                if (this.isRightPainting) {
                    this.applyRightClickErase(cellX, cellY, edge);
                } else if (this.isPainting && this.state.shapeMode === "single") {
                    this.applyBrushAt(cellX, cellY, edge);
                }
            }
        });

        window.addEventListener("mouseup", (e) => {
            if (this.isDraggingCamera) {
                this.isDraggingCamera = false;
                el.style.cursor = "default";
            }
            if (this.isPainting) {
                this.isPainting = false;
            }
            if (this.isRightPainting) {
                this.isRightPainting = false;
            }
        });

        el.addEventListener("contextmenu", (e) => e.preventDefault());

        el.addEventListener("wheel", (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.max(0.2, Math.min(5.0, this.zoom * zoomFactor));

            const rect = el.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.cameraX = mouseX - (mouseX - this.cameraX) * (newZoom / this.zoom);
            this.cameraY = mouseY - (mouseY - this.cameraY) * (newZoom / this.zoom);
            this.zoom = newZoom;

            this.requestRender();

            const event = new CustomEvent("zoomchange", { detail: { zoom: this.zoom } });
            window.dispatchEvent(event);
        }, { passive: false });
    }

    applyRightClickErase(x, y, edge) {
        const scheme = this.state.scheme;
        if (x < 0 || x >= scheme.width || y < 0 || y >= scheme.height) return;

        const brushType = this.state.brushType;
        const tool = this.state.activeTool;

        if (brushType === "wall" || tool === "erase-wall") {
            this.state.removeWall(x, y, edge);
        } else {
            this.state.removeFloor(x, y);
        }
        this.state.notifyStateChange();
    }

    applyBrushAt(x, y, edge) {
        const scheme = this.state.scheme;
        if (x < 0 || x >= scheme.width || y < 0 || y >= scheme.height) return;

        const tool = this.state.activeTool;
        const brushType = this.state.brushType;
        const colorId = this.state.activeColorId;

        if (tool === "pencil") {
            if (brushType === "floor") {
                this.state.setTileFloor(x, y, colorId);
            } else if (brushType === "wall") {
                this.state.setTileWall(x, y, edge, colorId);
            }
        } else if (tool === "erase-floor") {
            this.state.removeFloor(x, y);
        } else if (tool === "erase-wall") {
            this.state.removeWall(x, y, edge);
        }
        this.state.notifyStateChange();
    }

    applyShapeBrush(start, end) {
        const shape = this.state.shapeMode;
        const tool = this.state.activeTool;
        const brushType = this.state.brushType;
        const colorId = this.state.activeColorId;

        this.state.batchOperation(() => {
            if (shape === "box") {
                const bounds = ShapeStrokeEngine.getBoxBounds(start, end, (tool === "erase-wall" ? "wall" : brushType));
                if (brushType === "wall" || tool === "erase-wall") {
                    bounds.walls.forEach(w => {
                        if (tool === "pencil") this.state.setTileWall(w.x, w.y, w.edge, colorId);
                        else if (tool === "erase-wall") this.state.removeWall(w.x, w.y, w.edge);
                    });
                } else {
                    bounds.floors.forEach(f => {
                        if (tool === "pencil") this.state.setTileFloor(f.x, f.y, colorId);
                        else if (tool === "erase-floor") this.state.removeFloor(f.x, f.y);
                    });
                }
            } else if (shape === "line") {
                const points = ShapeStrokeEngine.getBresenhamLine(start.x, start.y, end.x, end.y);
                points.forEach(p => {
                    if (tool === "pencil") {
                        if (brushType === "floor") this.state.setTileFloor(p.x, p.y, colorId);
                        else if (brushType === "wall") this.state.setTileWall(p.x, p.y, start.edge || "north", colorId);
                    } else if (tool === "erase-floor") {
                        this.state.removeFloor(p.x, p.y);
                    } else if (tool === "erase-wall") {
                        this.state.removeWall(p.x, p.y, start.edge || "north");
                    }
                });
            }
        });
    }
}
