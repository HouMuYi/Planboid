/**
 * CanvasRenderer.js - 精確 PZ 幾何重構繪繪引擎 (深模組：雙畫布分層 Offscreen Architecture)
 * - 底層 Canvas (this.canvas): 負責純黑背景、網格與全樓層地塊牆面多邊形 (僅地塊變更與視角過渡時重繪)
 * - 頂層 Canvas (this.overlayCanvas): 負責 Hover 高亮、選區、筆刷與貼上預覽 (極輕量，<0.1ms 重繪，徹底拯救 CPU)
 */

import { BrushActionApplicator } from './BrushActionApplicator.js';
import { calcZTranslate, GeometryPipeline } from './GeometryPipeline.js';
import { InputDispatcher } from './InputDispatcher.js';
import { IsoMath } from './IsoMath.js';
import { ShapeStrokeEngine } from './ShapeStrokeEngine.js';

export class CanvasRenderer {
	/**
	 * @param {HTMLCanvasElement} canvas
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 */
	constructor(canvas, stateManager) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.state = stateManager;

		// 動態建立頂層 Overlay Canvas 實現離屏雙畫布分層
		this.initOverlayCanvas();

		this.isoMath = new IsoMath(32);

		// 相機 (Pan & Zoom)
		this.cameraX = 0;
		this.cameraY = 0;
		this.zoom = 1.0;

		// 視角過渡 (0 = 正交, 1 = 菱形)
		this.currentProgress = 1.0;
		this.targetProgress = 1.0;
		this.transitionSpeed = 0.16;
		this.isAnimating = false;

		// 動態錨定點：切換視角時鎖定的畫面中心網格座標
		this.anchorGridCell = null;

		// 獨立重繪動態鎖
		this.baseRenderRequested = false;
		this.overlayRenderRequested = false;

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

	initOverlayCanvas() {
		const parent = this.canvas.parentElement;
		if (getComputedStyle(parent).position === 'static') {
			parent.style.position = 'relative';
		}

		this.overlayCanvas = document.createElement('canvas');
		this.overlayCanvas.style.position = 'absolute';
		this.overlayCanvas.style.top = '0';
		this.overlayCanvas.style.left = '0';
		this.overlayCanvas.style.width = '100%';
		this.overlayCanvas.style.height = '100%';
		this.overlayCanvas.style.pointerEvents = 'none';
		this.overlayCanvas.style.zIndex = '10';
		this.overlayCtx = this.overlayCanvas.getContext('2d');

		parent.appendChild(this.overlayCanvas);
	}

	init() {
		this.resize();
		window.addEventListener('resize', () => this.resize());
		this.centerCamera();

		window.addEventListener('statechange', () => this.requestRenderAll());
		this.requestRenderAll();
	}

	resize() {
		const rect = this.canvas.parentElement.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;

		this.overlayCanvas.width = rect.width * dpr;
		this.overlayCanvas.height = rect.height * dpr;

		this.viewportWidth = rect.width;
		this.viewportHeight = rect.height;

		this.ctx.scale(dpr, dpr);
		this.overlayCtx.scale(dpr, dpr);

		this.requestRenderAll();
	}

	centerCamera() {
		const scheme = this.state.scheme;
		const z = this.state.currentZLevel;
		const basePos = this.isoMath.gridToScreen(scheme.width / 2, scheme.height / 2, this.currentProgress);
		const { dx, dy } = calcZTranslate(z, this.currentProgress);
		this.cameraX = this.viewportWidth / 2 - (basePos.x + dx) * this.zoom;
		this.cameraY = this.viewportHeight / 2 - (basePos.y + dy) * this.zoom;
	}

	fitView(padding = 40) {
		const fit = GeometryPipeline.calculateFitCameraPos(
			this.isoMath,
			this.state.scheme,
			this.currentProgress,
			this.viewportWidth,
			this.viewportHeight,
			padding,
		);
		this.zoom = fit.zoom;
		this.cameraX = fit.cameraX;
		this.cameraY = fit.cameraY;
		this.requestRenderAll();

		const event = new CustomEvent('zoomchange', { detail: { zoom: this.zoom } });
		window.dispatchEvent(event);
	}

	/**
	 * 取得指定邏輯座標 (含 Z 層偏置) 的最終螢幕座標，供相機錨點計算使用
	 */
	getScreenPos(logicX, logicY, zLevel) {
		const base = this.isoMath.gridToScreen(logicX, logicY, this.currentProgress);
		const { dx, dy } = calcZTranslate(zLevel, this.currentProgress);
		return { x: base.x + dx, y: base.y + dy };
	}

	getCurrentCenterGridCell() {
		const centerScreenX = this.viewportWidth / 2;
		const centerScreenY = this.viewportHeight / 2;

		const worldX = (centerScreenX - this.cameraX) / this.zoom;
		const worldY = (centerScreenY - this.cameraY) / this.zoom;

		const z = this.state.currentZLevel;
		const { dx, dy } = calcZTranslate(z, this.currentProgress);

		// 先減去此層的視覺偏置，再做 2D 反算
		const res = this.isoMath.screenToGrid(worldX - dx, worldY - dy, this.currentProgress);
		return { x: Math.round(res.cellX), y: Math.round(res.cellY) };
	}

	setViewMode(mode) {
		this.targetProgress = mode === 'iso' ? 1.0 : 0.0;
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
				this.renderAll();
				return;
			}
			this.currentProgress += diff * this.transitionSpeed;

			if (this.anchorGridCell) {
				const z = this.state.currentZLevel;
				const newPos = this.getScreenPos(this.anchorGridCell.x, this.anchorGridCell.y, z);
				this.cameraX = this.viewportWidth / 2 - newPos.x * this.zoom;
				this.cameraY = this.viewportHeight / 2 - newPos.y * this.zoom;
			}

			this.renderAll();
			requestAnimationFrame(animate);
		};
		requestAnimationFrame(animate);
	}

	/**
	 * 請求全元件重繪 (底層 + 頂層)
	 */
	requestRenderAll() {
		if (this.baseRenderRequested) return;
		this.baseRenderRequested = true;
		requestAnimationFrame(() => {
			this.baseRenderRequested = false;
			this.renderAll();
		});
	}

	/**
	 * 極輕量請求：只重繪頂層 Overlay (完全零重繪底層 4000 個 Tile，CPU 直接降為 0)
	 */
	requestRenderOverlay() {
		if (this.overlayRenderRequested || this.baseRenderRequested) return;
		this.overlayRenderRequested = true;
		requestAnimationFrame(() => {
			this.overlayRenderRequested = false;
			this.renderOverlay();
		});
	}

	desaturateHex(hex, factor = 0.7) {
		if (!hex || hex.length < 7) return '#64748b';
		let r = parseInt(hex.substring(1, 3), 16);
		let g = parseInt(hex.substring(3, 5), 16);
		let b = parseInt(hex.substring(5, 7), 16);

		const gray = 0.299 * r + 0.587 * g + 0.114 * b;
		r = Math.round(r + (gray - r) * factor);
		g = Math.round(g + (gray - g) * factor);
		b = Math.round(b + (gray - b) * factor);

		return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
	}

	renderAll() {
		this.renderBase();
		this.renderOverlay();
	}

	/**
	 * 繪製底層 Canvas：純黑背景 + 網格 + 4000 個地塊與牆面多邊形
	 */
	renderBase() {
		const ctx = this.ctx;
		const w = this.viewportWidth;
		const h = this.viewportHeight;

		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#0b0f19';
		ctx.fillRect(0, 0, w, h);

		ctx.save();
		ctx.translate(this.cameraX, this.cameraY);
		ctx.scale(this.zoom, this.zoom);

		// 1. 網格
		this.drawGrid(ctx);

		// 2. 全樓層與鬼影淡出渲染
		this.drawAllFloors(ctx);

		ctx.restore();
	}

	/**
	 * 繪製頂層 Overlay Canvas：選區、Hover 高亮、筆刷預覽 (極輕量 <0.1ms)
	 */
	renderOverlay() {
		const ctx = this.overlayCtx;
		const w = this.viewportWidth;
		const h = this.viewportHeight;

		ctx.clearRect(0, 0, w, h);

		ctx.save();
		ctx.translate(this.cameraX, this.cameraY);
		ctx.scale(this.zoom, this.zoom);

		const currentZ = this.state.currentZLevel;
		const { dx: selDx, dy: selDy } = calcZTranslate(currentZ, this.currentProgress);

		ctx.save();
		ctx.translate(selDx, selDy);

		// 1. 單點與矩形選區
		if (this.state.selectionBox) {
			const { minX, minY, maxX, maxY } = this.state.selectionBox;
			this.drawDashedSelectionBox(ctx, minX, minY, maxX, maxY);
		} else if (this.state.selectedCell) {
			const sel = this.state.selectedCell;
			this.drawCellHighlight(ctx, sel.x, sel.y, 'rgba(245, 158, 11, 0.4)', '#f59e0b', 3);
		}

		// 2. 貼上跟隨預覽
		if (this.state.isPastingMode && this.hoveredCell.x >= 0) {
			this.drawPastePreview(ctx, this.hoveredCell.x, this.hoveredCell.y);
		} // 3. 動態筆刷與 Hover 預覽
		else if (this.shapeStartCell && this.hoveredCell.x >= 0) {
			this.drawShapePreview(ctx);
		} else if (
			this.hoveredCell.x >= 0 && this.hoveredCell.x <= this.state.scheme.width
			&& this.hoveredCell.y >= 0 && this.hoveredCell.y <= this.state.scheme.height
		) {
			const isWallMode = this.state.brushType === 'wall' || this.state.activeTool === 'erase-wall';
			if (isWallMode) {
				if (this.hoveredCell.edge && this.state.activeTool !== 'select') {
					const norm = ShapeStrokeEngine.normalizeWallEdge(this.hoveredCell.x, this.hoveredCell.y, this.hoveredCell.edge);
					this.drawWallHighlight(ctx, norm.x, norm.y, norm.edge);
				}
			} else if (this.hoveredCell.x < this.state.scheme.width && this.hoveredCell.y < this.state.scheme.height) {
				this.drawCellHighlight(ctx, this.hoveredCell.x, this.hoveredCell.y, 'rgba(99, 102, 241, 0.35)', '#6366f1', 1.5);
			}
		}

		ctx.restore(); // 結束 Z 層偏移
		ctx.restore(); // 結束相機變換
	}

	drawGrid(ctx) {
		const scheme = this.state.scheme;
		const z = this.state.currentZLevel;
		const { dx, dy } = calcZTranslate(z, this.currentProgress);

		ctx.save();
		ctx.translate(dx, dy);
		ctx.lineWidth = 1 / this.zoom;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';

		for (let x = 0; x <= scheme.width; x++) {
			const start = this.isoMath.gridToScreen(x, 0, this.currentProgress);
			const end = this.isoMath.gridToScreen(x, scheme.height, this.currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}

		for (let y = 0; y <= scheme.height; y++) {
			const start = this.isoMath.gridToScreen(0, y, this.currentProgress);
			const end = this.isoMath.gridToScreen(scheme.width, y, this.currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}

		ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
		ctx.lineWidth = 2 / this.zoom;
		const p00 = this.isoMath.gridToScreen(0, 0, this.currentProgress);
		const p10 = this.isoMath.gridToScreen(scheme.width, 0, this.currentProgress);
		const p11 = this.isoMath.gridToScreen(scheme.width, scheme.height, this.currentProgress);
		const p01 = this.isoMath.gridToScreen(0, scheme.height, this.currentProgress);

		ctx.beginPath();
		ctx.moveTo(p00.x, p00.y);
		ctx.lineTo(p10.x, p10.y);
		ctx.lineTo(p11.x, p11.y);
		ctx.lineTo(p01.x, p01.y);
		ctx.closePath();
		ctx.stroke();
		ctx.restore();
	}

	drawAllFloors(ctx) {
		const scheme = this.state.scheme;
		const currentZ = this.state.currentZLevel;
		const palette = scheme.palette;

		const layers = GeometryPipeline.getSortedLayersToRender(scheme.tiles, currentZ, this.state.ghostLayerEnabled);

		layers.forEach(layer => {
			const { z, isCurrent, alpha, desatFactor, items } = layer;
			const { dx, dy } = calcZTranslate(z, this.currentProgress);

			ctx.save();
			ctx.translate(dx, dy);
			ctx.globalAlpha = alpha;

			// Pass 1: 地塊多邊形
			items.forEach(({ x, y, tile }) => {
				if (tile.floorColorId && palette[tile.floorColorId]) {
					const rawColor = palette[tile.floorColorId].color;
					const finalColor = isCurrent ? rawColor : this.desaturateHex(rawColor, desatFactor);
					this.drawTilePoly(ctx, x, y, finalColor);
				}
			});

			// Pass 2: 牆體
			items.forEach(({ x, y, tile }) => {
				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId && palette[colorId]) {
							const rawColor = palette[colorId].color;
							const finalColor = isCurrent ? rawColor : this.desaturateHex(rawColor, desatFactor);
							if (this.state.is3DWallsEnabled && this.currentProgress > 0) {
								this.drawWallQuad96px(ctx, x, y, edge, finalColor, 0.4);
							} else {
								this.drawWallLine2D(ctx, x, y, edge, finalColor);
							}
						}
					});
				}
			});

			// Pass 3: 文字標籤
			if (isCurrent) {
				items.forEach(({ x, y, tile }) => {
					if (tile.label) {
						this.drawTileText(ctx, x, y, tile.label);
					}
				});
			}

			ctx.restore();
		});
	}

	drawTilePoly(ctx, x, y, colorHex) {
		const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(this.isoMath, x, y, this.currentProgress);

		ctx.fillStyle = colorHex;
		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.lineTo(p3.x, p3.y);
		ctx.closePath();
		ctx.fill();
	}

	drawWallLine2D(ctx, x, y, edge, colorHex) {
		let p0, p1;

		const e = String(edge || '').toLowerCase();
		if (e === 'north' || e === 'n') {
			p0 = this.isoMath.gridToScreen(x, y, this.currentProgress);
			p1 = this.isoMath.gridToScreen(x + 1, y, this.currentProgress);
		} else if (e === 'west' || e === 'w') {
			p0 = this.isoMath.gridToScreen(x, y, this.currentProgress);
			p1 = this.isoMath.gridToScreen(x, y + 1, this.currentProgress);
		}

		if (!p0 || !p1) return;

		ctx.strokeStyle = colorHex;
		ctx.lineWidth = 5 / this.zoom;
		ctx.lineCap = 'round';

		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.stroke();
	}

	drawWallQuad96px(ctx, x, y, edge, colorHex, fillAlpha = 0.45) {
		const quad = GeometryPipeline.getWallQuad96Points(this.isoMath, x, y, edge, this.currentProgress);
		if (!quad) return;

		const [b0, b1, t1, t0] = quad;
		const savedAlpha = ctx.globalAlpha;

		ctx.globalAlpha = savedAlpha * fillAlpha;
		ctx.fillStyle = colorHex;
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.lineTo(t0.x, t0.y);
		ctx.closePath();
		ctx.fill();

		ctx.globalAlpha = savedAlpha * fillAlpha * 1.8;
		ctx.strokeStyle = colorHex;
		ctx.lineWidth = 2 / this.zoom;
		ctx.stroke();

		ctx.globalAlpha = savedAlpha;
	}

	drawTileText(ctx, x, y, text) {
		const center = this.isoMath.gridToScreen(x + 0.5, y + 0.5, this.currentProgress);

		ctx.fillStyle = '#ffffff';
		ctx.font = `bold ${Math.max(10, 12 / this.zoom)}px Inter, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.shadowColor = 'rgba(0,0,0,0.9)';
		ctx.shadowBlur = 4;
		ctx.fillText(text, center.x, center.y);
		ctx.shadowBlur = 0;
	}

	// 以下方法在頂層 Overlay 上繪製

	drawCellHighlight(ctx, x, y, fillColor, strokeColor = '#6366f1', strokeWidth = 1.5) {
		const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(this.isoMath, x, y, this.currentProgress);

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
	}

	drawDashedSelectionBox(ctx, minX, minY, maxX, maxY) {
		const p0 = this.isoMath.gridToScreen(minX, minY, this.currentProgress);
		const p1 = this.isoMath.gridToScreen(maxX + 1, minY, this.currentProgress);
		const p2 = this.isoMath.gridToScreen(maxX + 1, maxY + 1, this.currentProgress);
		const p3 = this.isoMath.gridToScreen(minX, maxY + 1, this.currentProgress);

		ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
		ctx.strokeStyle = '#f59e0b';
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
		ctx.setLineDash([]);
	}

	drawPastePreview(ctx, targetX, targetY) {
		const clip = this.state.clipboard;
		if (!clip || !clip.tiles) return;

		const palette = this.state.scheme.palette;

		Object.entries(clip.tiles).forEach(([relKey, tileData]) => {
			const [rx, ry] = relKey.split(',').map(Number);
			const x = targetX + rx;
			const y = targetY + ry;

			if (x >= 0 && x <= this.state.scheme.width && y >= 0 && y <= this.state.scheme.height) {
				if (tileData.floorColorId && palette[tileData.floorColorId]) {
					const savedAlpha = ctx.globalAlpha;
					ctx.globalAlpha = savedAlpha * 0.6;
					this.drawTilePoly(ctx, x, y, palette[tileData.floorColorId].color);
					ctx.globalAlpha = savedAlpha;
				}
				this.drawCellHighlight(ctx, x, y, 'rgba(16, 185, 129, 0.2)', '#10b981', 1.5);
			}
		});
	}

	drawWallHighlight(ctx, x, y, edge) {
		this.drawWallLine2D(ctx, x, y, edge, '#10b981');
	}

	drawShapePreview(ctx) {
		if (!this.shapeStartCell) return;

		const x1 = this.shapeStartCell.x;
		const y1 = this.shapeStartCell.y;
		const x2 = this.hoveredCell.x;
		const y2 = this.hoveredCell.y;
		const tool = this.state.activeTool;
		const shape = this.state.shapeMode;
		const brushType = this.state.brushType;

		if (tool === 'select' && shape === 'box') {
			const minX = Math.min(x1, x2);
			const maxX = Math.max(x1, x2);
			const minY = Math.min(y1, y2);
			const maxY = Math.max(y1, y2);
			this.drawDashedSelectionBox(ctx, minX, minY, maxX, maxY);
			return;
		}

		if (shape === 'box') {
			const isErasing = tool === 'erase-wall';
			const bounds = ShapeStrokeEngine.getBoxBounds({ x: x1, y: y1 }, { x: x2, y: y2 }, isErasing ? 'wall' : brushType, isErasing);
			if (brushType === 'wall' || isErasing) {
				bounds.walls.forEach(w => this.drawWallHighlight(ctx, w.x, w.y, w.edge));
			} else {
				bounds.floors.forEach(f => this.drawCellHighlight(ctx, f.x, f.y, 'rgba(16, 185, 129, 0.3)', '#10b981', 1.5));
			}
		} else if (shape === 'line') {
			const points = ShapeStrokeEngine.getBresenhamLine(x1, y1, x2, y2);
			points.forEach(p => {
				if (brushType === 'wall' || tool === 'erase-wall') {
					const norm = ShapeStrokeEngine.normalizeWallEdge(p.x, p.y, this.shapeStartCell.edge || 'north');
					this.drawWallHighlight(ctx, norm.x, norm.y, norm.edge);
				} else {
					this.drawCellHighlight(ctx, p.x, p.y, 'rgba(99, 102, 241, 0.4)', '#6366f1', 1.5);
				}
			});
		}
	}
}
