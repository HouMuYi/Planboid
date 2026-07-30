/**
 * CanvasRenderer.js - 精確 PZ 幾何重構繪繪引擎 (深模組：專注 Canvas 上色與幾何繪製)
 */

import { IsoMath } from "./IsoMath.js";
import { ShapeStrokeEngine } from "./ShapeStrokeEngine.js";
import { GeometryPipeline, LevelVisualOffset } from "./GeometryPipeline.js";
import { BrushActionApplicator } from "./BrushActionApplicator.js";
import { InputDispatcher } from "./InputDispatcher.js";

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

        // 多模式繪畫/選區起點與懸停狀態
        this.shapeStartCell = null;
        this.hoveredCell = { x: -1, y: -1, edge: null };

        // 獨立分派器與筆刷器 (Seams)
        this.applicator = new BrushActionApplicator(this.state);
        this.dispatcher = new InputDispatcher(this, this.state, this.applicator);

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener("resize", () => this.resize());
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

    fitView(padding = 40) {
        const fit = GeometryPipeline.calculateFitCameraPos(
            this.isoMath,
            this.state.scheme,
            this.currentProgress,
            this.viewportWidth,
            this.viewportHeight,
            padding
        );
        this.zoom = fit.zoom;
        this.cameraX = fit.cameraX;
        this.cameraY = fit.cameraY;
        this.requestRender();

        const event = new CustomEvent("zoomchange", { detail: { zoom: this.zoom } });
        window.dispatchEvent(event);
    }

    getCurrentCenterGridCell() {
        const centerScreenX = this.viewportWidth / 2;
        const centerScreenY = this.viewportHeight / 2;

        const worldX = (centerScreenX - this.cameraX) / this.zoom;
        const worldY = (centerScreenY - this.cameraY) / this.zoom;

        const res = this.isoMath.screenToGrid(worldX, worldY, this.currentProgress);
        const z = this.state.currentZLevel;

        const { logicX, logicY } = LevelVisualOffset.toLogicPos(res.cellX, res.cellY, z, this.currentProgress);
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
        const { renderX, renderY } = LevelVisualOffset.toRenderPos(logicX, logicY, zLevel, this.currentProgress);
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
        } else if (this.hoveredCell.x >= 0 && this.hoveredCell.x <= this.state.scheme.width &&
                   this.hoveredCell.y >= 0 && this.hoveredCell.y <= this.state.scheme.height) {
            const isWallMode = (this.state.brushType === "wall" || this.state.activeTool === "erase-wall");
            if (isWallMode) {
                if (this.hoveredCell.edge && this.state.activeTool !== "select") {
                    const norm = ShapeStrokeEngine.normalizeWallEdge(this.hoveredCell.x, this.hoveredCell.y, this.hoveredCell.edge);
                    this.drawWallHighlight(norm.x, norm.y, norm.edge);
                }
            } else if (this.hoveredCell.x < this.state.scheme.width && this.hoveredCell.y < this.state.scheme.height) {
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

        const e = String(edge || "").toLowerCase();
        if (e === "north" || e === "n") { p0 = this.getScreenPos(x, y, z); p1 = this.getScreenPos(x + 1, y, z); }
        else if (e === "west" || e === "w") { p0 = this.getScreenPos(x, y, z); p1 = this.getScreenPos(x, y + 1, z); }

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

            if (x >= 0 && x <= this.state.scheme.width && y >= 0 && y <= this.state.scheme.height) {
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

        if (tool === "select" && shape === "box") {
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            this.drawDashedSelectionBox(minX, minY, maxX, maxY);
            return;
        }

        if (shape === "box") {
            const isErasing = (tool === "erase-wall");
            const bounds = ShapeStrokeEngine.getBoxBounds({ x: x1, y: y1 }, { x: x2, y: y2 }, (isErasing ? "wall" : brushType), isErasing);
            if (brushType === "wall" || isErasing) {
                bounds.walls.forEach(w => this.drawWallHighlight(w.x, w.y, w.edge));
            } else {
                bounds.floors.forEach(f => this.drawCellHighlight(f.x, f.y, z, "rgba(16, 185, 129, 0.3)", "#10b981", 1.5));
            }
        } else if (shape === "line") {
            const points = ShapeStrokeEngine.getBresenhamLine(x1, y1, x2, y2);
            points.forEach(p => {
                if (brushType === "wall" || tool === "erase-wall") {
                    const norm = ShapeStrokeEngine.normalizeWallEdge(p.x, p.y, this.shapeStartCell.edge || "north");
                    this.drawWallHighlight(norm.x, norm.y, norm.edge);
                } else {
                    this.drawCellHighlight(p.x, p.y, z, "rgba(99, 102, 241, 0.4)", "#6366f1", 1.5);
                }
            });
        }
    }
}
