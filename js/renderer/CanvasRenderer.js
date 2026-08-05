/**
 * CanvasRenderer.js - 精確 PZ 幾何重構繪繪引擎 (深模組：雙畫布分層 Offscreen Architecture)
 * - 底層 Canvas (this.canvas): 負責純黑背景、網格與全樓層地塊牆面多邊形 (僅地塊變更與視角過渡時重繪)
 * - 頂層 Canvas (this.overlayCanvas): 負責 Hover 高亮、選區、筆刷與貼上預覽 (極輕量，<0.1ms 重繪，徹底拯救 CPU)
 */

import { CONFIG } from '../core/Config.js';
import { BrushActionApplicator } from './BrushActionApplicator.js';
import { calcZTranslate, GeometryPipeline } from './GeometryPipeline.js';
import { InputDispatcher } from './InputDispatcher.js';
import { IsoMath } from './IsoMath.js';
import { RenderCacheManager } from './RenderCacheManager.js';

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

		this.isoMath = new IsoMath(CONFIG.TILE_SIZE);
		this.cacheManager = new RenderCacheManager();

		// 相機 (Pan & Zoom)
		this.cameraX = 0;
		this.cameraY = 0;
		this.zoom = 1.0;

		// 視角過渡 (0 = 正交, 1 = 菱形)
		this.currentProgress = 1.0;
		this.targetProgress = 1.0;
		this.transitionSpeed = CONFIG.TRANSITION_SPEED;
		this.isAnimating = false;

		// 動態錨定點：切換視角時鎖定的畫面中心網格座標
		this.anchorGridCell = null;

		// 獨立重繪動態鎖與中央調度器標記
		this.isTickScheduled = false;
		this.baseRenderRequested = false;
		this.overlayRenderRequested = false;

		// 互動與繪圖狀態
		this.isDraggingCamera = false;
		this.isPainting = false;
		this.isRightPainting = false;
		this.lastMouseX = 0;
		this.lastMouseY = 0;

		// 地塊矩形拖曳起點 (floor 筆刷 / 選取工具共用：放開時判定單格或矩形)
		this.rectStartCell = null;
		// 邊線交叉點起點 (wall 筆刷專用：吸附十字交界處繪製直線)
		this.wallStartPoint = null;
		this.hoveredCell = { x: -1, y: -1, edge: null };
		this.hoveredIntersection = { x: -1, y: -1 };

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

		window.addEventListener('statechange', () => {
			this.cacheManager.invalidateAll();
			this.requestRenderAll();
		});
		this.requestRenderAll();
	}

	resize() {
		const rect = this.canvas.parentElement.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;

		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.overlayCanvas.width = rect.width * dpr;
		this.overlayCanvas.height = rect.height * dpr;

		this.viewportWidth = this.canvas.width;
		this.viewportHeight = this.canvas.height;
		this.cacheManager.resize(this.viewportWidth, this.viewportHeight);

		this.ctx.scale(dpr, dpr);
		this.overlayCtx.scale(dpr, dpr);

		this.updateHotkeyLegendPosition();
		this.requestRenderAll();
	}

	/**
	 * 取得展開狀態下右側邊欄的視覺寬度（若已摺疊/收起則回傳 0）
	 */
	getSidebarWidth() {
		const sidebar = document.getElementById('main-sidebar');
		if (sidebar && !sidebar.classList.contains('collapsed')) {
			return sidebar.offsetWidth || 0;
		}
		return 0;
	}

	/**
	 * 根據側邊欄展開/收合狀態，避免右下角熱鍵圖例被展開的側邊欄遮住
	 */
	updateHotkeyLegendPosition() {
		const legend = document.getElementById('canvas-hotkey-legend');
		if (!legend) return;
		legend.style.setProperty('--sidebar-offset', `${this.getSidebarWidth()}px`);
	}

	centerCamera() {
		const sidebarWidth = this.getSidebarWidth();
		const effectiveWidth = this.viewportWidth - sidebarWidth;
		const scheme = this.state ? this.state.scheme : null;
		if (!scheme) return;
		const z = this.state ? this.state.currentZLevel : 0;
		const basePos = this.isoMath.gridToScreen(scheme.width / 2, scheme.height / 2, this.currentProgress);
		const { dx, dy } = calcZTranslate(z, this.currentProgress);
		this.cameraX = effectiveWidth / 2 - (basePos.x + dx) * this.zoom;
		this.cameraY = this.viewportHeight / 2 - (basePos.y + dy) * this.zoom;
	}

	fitView(padding = CONFIG.FIT_VIEW_PADDING) {
		const sidebarWidth = this.getSidebarWidth();
		const fit = GeometryPipeline.calculateFitCameraPos(
			this.isoMath,
			this.state.scheme,
			this.currentProgress,
			this.viewportWidth,
			this.viewportHeight,
			padding,
			sidebarWidth,
			this.state.currentZLevel,
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
		const sidebarWidth = this.getSidebarWidth();
		const effectiveWidth = this.viewportWidth - sidebarWidth;
		const centerScreenX = effectiveWidth / 2;
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
		// 視角過渡開始，記錄時間與起始進度
		this.hoveredCell = { x: -1, y: -1, edge: null };
		this.hoveredIntersection = { x: -1, y: -1 };
		this.isAnimating = true;
		this.animationStartTime = performance.now();
		this.animationStartProgress = this.currentProgress;
		this.requestRenderAll();
	}

	/**
	 * 請求全元件重繪 (底層 + 頂層)
	 */
	requestRenderAll() {
		this.baseRenderRequested = true;
		this.scheduleTick();
	}

	/**
	 * 極輕量請求：只重繪頂層 Overlay (完全零重繪底層 4000 個 Tile，CPU 直接降為 0)
	 */
	requestRenderOverlay() {
		this.overlayRenderRequested = true;
		this.scheduleTick();
	}

	/**
	 * 全站中央單一影格調度器 (Central Unified Frame Scheduler Loop)
	 * 統籌雙畫布分層重繪、相機 Lerp 縮放與 2D/3D 視角過渡動畫，消滅同影格重複繪製
	 */
	scheduleTick() {
		if (this.isTickScheduled) return;
		this.isTickScheduled = true;
		requestAnimationFrame((now) => {
			this.isTickScheduled = false;

			// 僅在 2D/3D 視角動畫期間限制插補頻率 (依據 CONFIG.TRANSITION_FPS_LIMIT)
			const minFrameInterval = 1000 / (CONFIG.TRANSITION_FPS_LIMIT || 30);
			if (this.isAnimating && this.lastAnimTickTime && now - this.lastAnimTickTime < minFrameInterval) {
				this.scheduleTick();
				return;
			}
			if (this.isAnimating) {
				this.lastAnimTickTime = now;
			}

			this.onTick(now);
		});
	}

	onTick() {
		let needsBaseRedraw = this.baseRenderRequested;
		let needsOverlayRedraw = this.overlayRenderRequested;

		this.baseRenderRequested = false;
		this.overlayRenderRequested = false;

		// 1. 處理平滑縮放與相機位移 (Zoom & Pan Lerp)
		if (this.dispatcher && this.dispatcher.isZoomAnimating) {
			const factor = CONFIG.ZOOM_ANIMATION_FACTOR;
			const diffZoom = this.dispatcher.targetZoom - this.zoom;
			const diffCamX = this.dispatcher.targetCameraX - this.cameraX;
			const diffCamY = this.dispatcher.targetCameraY - this.cameraY;

			if (Math.abs(diffZoom) < 0.001 && Math.abs(diffCamX) < 0.1 && Math.abs(diffCamY) < 0.1) {
				this.zoom = this.dispatcher.targetZoom;
				this.cameraX = this.dispatcher.targetCameraX;
				this.cameraY = this.dispatcher.targetCameraY;
				this.dispatcher.isZoomAnimating = false;
			} else {
				this.zoom += diffZoom * factor;
				this.cameraX += diffCamX * factor;
				this.cameraY += diffCamY * factor;
			}
			needsBaseRedraw = true;

			const event = new CustomEvent('zoomchange', { detail: { zoom: this.zoom } });
			window.dispatchEvent(event);
		}

		// 2. 處理 2D/3D 視角切換過渡動畫 (時間驅動型 Ease-InOut 2 秒曲線)
		if (this.isAnimating) {
			const now = performance.now();
			const elapsed = now - (this.animationStartTime || now);
			const duration = CONFIG.TRANSITION_DURATION_MS || 2000;
			const t = Math.min(1.0, Math.max(0.0, elapsed / duration));

			// 純線性 (Linear) 直線勻速：每毫秒進度完全相同，死板且精準
			const startP = this.animationStartProgress ?? 0;
			const targetP = this.targetProgress;
			this.currentProgress = startP + (targetP - startP) * t;

			if (t >= 1.0) {
				this.currentProgress = this.targetProgress;
				this.isAnimating = false;
				this.anchorGridCell = null;
				this.cacheManager.invalidateAll(); // 視角抵達定位，重置快取
			} else {
				if (this.anchorGridCell) {
					const sidebarWidth = this.getSidebarWidth();
					const effectiveWidth = this.viewportWidth - sidebarWidth;
					const z = this.state.currentZLevel;
					const pt = this.isoMath.gridToScreen(this.anchorGridCell.x, this.anchorGridCell.y, this.currentProgress);
					const { dx, dy } = calcZTranslate(z, this.currentProgress);
					const newPosX = pt.x + dx;
					const newPosY = pt.y + dy;
					this.cameraX = effectiveWidth / 2 - newPosX * this.zoom;
					this.cameraY = this.viewportHeight / 2 - newPosY * this.zoom;
				}
			}
			needsBaseRedraw = true;
		}

		// 3. 權威結算：單一 rAF 影格內絕對不重複執行 renderBase / renderOverlay
		if (needsBaseRedraw) {
			this.renderAll();
		} else if (needsOverlayRedraw) {
			this.renderOverlay();
		}

		// 4. 若動力學動畫仍未完成，自動推動下一個 rAF 心跳脈衝
		if (this.isAnimating || (this.dispatcher && this.dispatcher.isZoomAnimating)) {
			this.scheduleTick();
		}
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
		ctx.fillStyle = CONFIG.COLOR_BG;
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
		} // 3. 地塊矩形拖曳預覽 (floor 筆刷 / 選取工具共用)
		else if (this.rectStartCell) {
			if (this.hoveredCell.x >= 0) this.drawRectPreview(ctx);
		} // 4. 邊線交叉點直線預覽
		else if (this.wallStartPoint) {
			this.drawWallLinePreview(ctx);
		} else {
			const isWallMode = this.state.activeTool !== 'select' && this.state.brushType === 'wall';
			if (isWallMode) {
				if (
					this.hoveredIntersection.x >= 0 && this.hoveredIntersection.x <= this.state.scheme.width
					&& this.hoveredIntersection.y >= 0 && this.hoveredIntersection.y <= this.state.scheme.height
				) {
					this.drawIntersectionMarker(ctx, this.hoveredIntersection.x, this.hoveredIntersection.y);
				}
			} else if (
				this.hoveredCell.x >= 0 && this.hoveredCell.x < this.state.scheme.width
				&& this.hoveredCell.y >= 0 && this.hoveredCell.y < this.state.scheme.height
			) {
				this.drawCellHighlight(ctx, this.hoveredCell.x, this.hoveredCell.y, 'rgba(99, 102, 241, 0.35)', '#6366f1', 1.5);
			}
		}


		ctx.restore(); // 結束 Z 層偏移
		ctx.restore(); // 結束相機變換
	}

	drawGrid(ctx) {
		// 視角切換動畫期間直接隱藏背景網格 (不參與動畫與幾何計算)，動畫結束後自動補回
		if (this.isAnimating) return;

		const scheme = this.state.scheme;
		const z = this.state.currentZLevel;
		const { dx, dy } = calcZTranslate(z, this.currentProgress);

		ctx.save();
		ctx.translate(dx, dy);
		ctx.lineWidth = 1 / this.zoom;
		ctx.strokeStyle = CONFIG.COLOR_GRID_NORMAL;

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

		ctx.strokeStyle = CONFIG.COLOR_GRID_BOUNDS;
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

		const layers = GeometryPipeline.getSortedLayersToRender(scheme.tiles, currentZ, this.state.otherFloorsMode);

		const p = 4;
		const w = Math.max(1, scheme.width || 0);
		const h = Math.max(1, scheme.height || 0);
		const pt0 = this.isoMath.gridToScreen(-p, -p, this.currentProgress);
		const pt1 = this.isoMath.gridToScreen(w + p, -p, this.currentProgress);
		const pt2 = this.isoMath.gridToScreen(w + p, h + p, this.currentProgress);
		const pt3 = this.isoMath.gridToScreen(-p, h + p, this.currentProgress);
		const wallHeight = CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET * this.currentProgress;

		const snapMinX = Math.floor(Math.min(pt0.x, pt1.x, pt2.x, pt3.x));
		const snapMinY = Math.floor(Math.min(pt0.y, pt1.y, pt2.y, pt3.y) - wallHeight);
		const snapWidth = Math.ceil(Math.max(pt0.x, pt1.x, pt2.x, pt3.x) - snapMinX);
		const snapHeight = Math.ceil(Math.max(pt0.y, pt1.y, pt2.y, pt3.y) - snapMinY);

		const isPanZooming = Boolean(this.dispatcher && (this.dispatcher.isZoomAnimating || this.isDraggingCamera));

		layers.forEach(layer => {
			const { z, isCurrent, alpha, desatFactor } = layer;
			const { dx, dy } = calcZTranslate(z, this.currentProgress);

			ctx.save();
			ctx.translate(dx, dy);
			ctx.globalAlpha = alpha;

			if (this.isAnimating) {
				if (isCurrent) {
					// 地塊層：使用 2D 快照進行仿射變換拉伸
					const snapMinX2D = -p * CONFIG.TILE_SIZE;
					const snapMinY2D = -p * CONFIG.TILE_SIZE;
					const snapW2D = (w + 2 * p) * CONFIG.TILE_SIZE;
					const snapH2D = (h + 2 * p) * CONFIG.TILE_SIZE;

					const floorCache2D = this.cacheManager.getOrCreateFloor2DCache(z, snapW2D, snapH2D, (c2dCtx) => {
						c2dCtx.translate(-snapMinX2D, -snapMinY2D);
						this._renderPasses(c2dCtx, layer, palette, desatFactor, isCurrent, 1.0, 0.0, { floor: true });
					});

					const pVal = this.currentProgress;
					ctx.save();
					ctx.transform(1, 0.5 * pVal, -pVal, 1 - 0.5 * pVal, 0, 0);
					ctx.drawImage(floorCache2D.canvas, snapMinX2D, snapMinY2D);
					ctx.restore();

					// 牆面層：動畫過渡期間即時繪製
					this._renderPasses(ctx, layer, palette, desatFactor, isCurrent, this.zoom, this.currentProgress, { wall: true });
				}
			} else if (isPanZooming) {
				const cache = this.cacheManager.getOrCreateCache(z, isCurrent, snapWidth, snapHeight, (baseCtx, labelCtx) => {
					baseCtx.translate(-snapMinX, -snapMinY);
					labelCtx.translate(-snapMinX, -snapMinY);
					this._renderPasses(baseCtx, layer, palette, desatFactor, isCurrent, 1.0, this.currentProgress, { floor: true, wall: true });
					if (isCurrent) {
						this._renderPasses(labelCtx, layer, palette, desatFactor, isCurrent, 1.0, this.currentProgress, { label: true });
					}
				});

				ctx.drawImage(cache.base, snapMinX, snapMinY);
				if (isCurrent) ctx.drawImage(cache.label, snapMinX, snapMinY);
			} else {
				// 靜止狀態：完整原生繪製
				this._renderPasses(ctx, layer, palette, desatFactor, isCurrent, this.zoom, this.currentProgress, { floor: true, wall: true, label: isCurrent });
			}

			ctx.restore();
		});
	}

	_renderPasses(targetCtx, layer, palette, desatFactor, isCurrent, zoom, progress, passes = {}) {
		GeometryPipeline.traverseLayerPasses(layer, palette, {
			onFloor: passes.floor ? (x, y, colorId) => {
				const color = isCurrent ? palette[colorId].color : GeometryPipeline.desaturateHex(palette[colorId].color, desatFactor);
				GeometryPipeline.drawTilePoly(targetCtx, this.isoMath, x, y, color, progress);
			} : null,
			onFloorObjects: passes.floor ? (x, y, objArray) => {
				GeometryPipeline.drawFloorObjects(targetCtx, this.isoMath, x, y, objArray, palette, zoom, progress);
			} : null,
			onWall: passes.wall ? (x, y, edge, colorId) => {
				const color = isCurrent ? palette[colorId].color : GeometryPipeline.desaturateHex(palette[colorId].color, desatFactor);
				if (this.state.is3DWallsEnabled && progress > 0) {
					GeometryPipeline.drawWallQuad96px(targetCtx, this.isoMath, x, y, edge, color, zoom, progress, CONFIG.WALL_FILL_ALPHA);
				} else {
					GeometryPipeline.drawWallLine2D(targetCtx, this.isoMath, x, y, edge, color, zoom, progress);
				}
			} : null,
			onWallObjects: passes.wall ? (x, y, edge, objArray) => {
				if (this.state.is3DWallsEnabled && progress > 0) {
					GeometryPipeline.drawWallObjects3D(targetCtx, this.isoMath, x, y, edge, objArray, palette, zoom, progress);
				} else {
					GeometryPipeline.drawWallObjects2D(targetCtx, this.isoMath, x, y, edge, objArray, palette, zoom, progress);
				}
			} : null,
			onLabel: passes.label ? (x, y, label) => {
				GeometryPipeline.drawTileText(targetCtx, this.isoMath, x, y, label, zoom, progress);
			} : null,
		});
	}

	drawTilePoly(ctx, x, y, colorHex) {
		GeometryPipeline.drawTilePoly(ctx, this.isoMath, x, y, colorHex, this.currentProgress);
	}

	drawWallLine2D(ctx, x, y, edge, colorHex) {
		GeometryPipeline.drawWallLine2D(ctx, this.isoMath, x, y, edge, colorHex, this.zoom, this.currentProgress);
	}

	drawWallQuad96px(ctx, x, y, edge, colorHex, fillAlpha = CONFIG.WALL_FILL_ALPHA) {
		GeometryPipeline.drawWallQuad96px(ctx, this.isoMath, x, y, edge, colorHex, this.zoom, this.currentProgress, fillAlpha);
	}

	drawTileText(ctx, x, y, text) {
		GeometryPipeline.drawTileText(ctx, this.isoMath, x, y, text, this.zoom, this.currentProgress);
	}

	// 以下方法在頂層 Overlay 上繪製

	_drawPolyShape(ctx, points, fillColor, strokeColor, strokeWidth, lineDash = []) {
		ctx.fillStyle = fillColor;
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = strokeWidth / this.zoom;
		if (lineDash.length > 0) ctx.setLineDash(lineDash.map(v => v / this.zoom));

		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		if (lineDash.length > 0) ctx.setLineDash([]);
	}

	drawCellHighlight(ctx, x, y, fillColor, strokeColor = '#6366f1', strokeWidth = 1.5) {
		const points = GeometryPipeline.getTilePolyPoints(this.isoMath, x, y, this.currentProgress);
		this._drawPolyShape(ctx, points, fillColor, strokeColor, strokeWidth);
	}

	drawDashedSelectionBox(ctx, minX, minY, maxX, maxY) {
		const points = [
			this.isoMath.gridToScreen(minX, minY, this.currentProgress),
			this.isoMath.gridToScreen(maxX + 1, minY, this.currentProgress),
			this.isoMath.gridToScreen(maxX + 1, maxY + 1, this.currentProgress),
			this.isoMath.gridToScreen(minX, maxY + 1, this.currentProgress),
		];
		this._drawPolyShape(ctx, points, 'rgba(245, 158, 11, 0.25)', '#f59e0b', 2.5, [6, 4]);
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

	/**
	 * 交叉點吸附標記：邊線工具尚未按下起點時的懸停指示
	 */
	drawIntersectionMarker(ctx, x, y) {
		const p = this.isoMath.gridToScreen(x, y, this.currentProgress);
		const r = 5 / this.zoom;

		ctx.fillStyle = '#6366f1';
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 1.5 / this.zoom;
		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	/**
	 * 地塊矩形拖曳預覽 (floor 筆刷 / 選取工具)：rectStartCell 為起點，hoveredCell 為當前終點
	 */
	drawRectPreview(ctx) {
		if (!this.rectStartCell || this.hoveredCell.x < 0) return;

		const minX = Math.min(this.rectStartCell.x, this.hoveredCell.x);
		const maxX = Math.max(this.rectStartCell.x, this.hoveredCell.x);
		const minY = Math.min(this.rectStartCell.y, this.hoveredCell.y);
		const maxY = Math.max(this.rectStartCell.y, this.hoveredCell.y);

		if (this.state.activeTool === 'select') {
			this.drawDashedSelectionBox(ctx, minX, minY, maxX, maxY);
			return;
		}

		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				this.drawCellHighlight(ctx, x, y, 'rgba(16, 185, 129, 0.3)', '#10b981', 1.5);
			}
		}
	}

	/**
	 * 邊線交叉點直線預覽：wallStartPoint 為起點，hoveredIntersection 依軸向鎖定後為當前終點
	 */
	drawWallLinePreview(ctx) {
		if (!this.wallStartPoint || this.hoveredIntersection.x < 0) return;

		const start = this.wallStartPoint;
		const end = GeometryPipeline.constrainAxisPoint(start, this.hoveredIntersection);

		if (end.x === start.x && end.y === start.y) {
			this.drawIntersectionMarker(ctx, start.x, start.y);
			return;
		}

		const isHorizontal = start.y === end.y;
		const key = isHorizontal ? 'x' : 'y';
		const edge = isHorizontal ? 'north' : 'west';
		const min = Math.min(start[key], end[key]);
		const max = Math.max(start[key], end[key]);

		for (let i = min; i < max; i++) {
			const x = isHorizontal ? i : start.x;
			const y = isHorizontal ? start.y : i;
			this.drawWallHighlight(ctx, x, y, edge);
		}
	}
}

