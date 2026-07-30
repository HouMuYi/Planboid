/**
 * InputDispatcher.js - Canvas 輸入與互動事件分派器 (Input Event Dispatcher Seam)
 * 負責 Canvas DOM 事件綁定、滑鼠座標反算、相機 Drag/Zoom 與筆刷呼叫分派
 * 包含 60FPS 訊框鎖與分層繪製調度 (rAF Lock + Overlay Decoupling)
 */

import { calcZTranslate } from './GeometryPipeline.js';

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

		this.mouseMoveTicking = false;

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

		const z = this.state.currentZLevel;
		const { dx, dy } = calcZTranslate(z, this.renderer.currentProgress);

		// 減去 Z 層的純垂直視覺偏置後，交給 2D 平面反算的 cellX 與 cellY 就是真實的邏輯座標
		const res = this.renderer.isoMath.screenToGrid(worldX - dx, worldY - dy, this.renderer.currentProgress);
		const logicX = res.cellX;
		const logicY = res.cellY;

		const localX = res.gridX - res.cellX;
		const localY = res.gridY - res.cellY;

		let edge = null;
		// 邊緣吸附需在 25% 帶內，且必須位於邊長度方向的中央 50% (0.25 ~ 0.75，忽略兩端各 25% 角落交錯區)
		if (localY < 0.25 && localX >= 0.25 && localX <= 0.75) {
			edge = 'north';
		} else if (localY > 0.75 && localX >= 0.25 && localX <= 0.75) {
			edge = 'south';
		} else if (localX < 0.25 && localY >= 0.25 && localY <= 0.75) {
			edge = 'west';
		} else if (localX > 0.75 && localY >= 0.25 && localY <= 0.75) {
			edge = 'east';
		}

		return { cellX: logicX, cellY: logicY, edge };
	}

	setupEvents() {
		const el = this.renderer.canvas;

		el.addEventListener('mousedown', (e) => {
			const { cellX, cellY, edge } = this.getMouseGridPos(e);

			if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
				this.renderer.isDraggingCamera = true;
				this.renderer.lastMouseX = e.clientX;
				this.renderer.lastMouseY = e.clientY;
				el.style.cursor = 'grabbing';
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
					this.renderer.requestRenderAll();
					return;
				}

				if (tool === 'select') {
					if (shape === 'single') {
						if (
							cellX >= 0 && cellX < this.state.scheme.width
							&& cellY >= 0 && cellY < this.state.scheme.height
						) {
							this.state.selectedCell = { x: cellX, y: cellY };
							this.state.selectionBox = null;
							this.state.notifyStateChange();
						}
					} else if (shape === 'box') {
						if (!this.renderer.shapeStartCell) {
							this.renderer.shapeStartCell = { x: cellX, y: cellY };
							this.renderer.requestRenderOverlay();
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

				if (shape === 'single') {
					this.state.pushHistory();
					this.renderer.isPainting = true;
					this.applicator.applyBrushAt(cellX, cellY, edge);
				} else if (shape === 'line' || shape === 'box') {
					if (!this.renderer.shapeStartCell) {
						this.renderer.shapeStartCell = { x: cellX, y: cellY, edge };
						this.renderer.requestRenderOverlay();
					} else {
						const start = this.renderer.shapeStartCell;
						this.applicator.applyShapeBrush(start, { x: cellX, y: cellY, edge });
						this.renderer.shapeStartCell = null;
						this.renderer.requestRenderAll();
					}
				}
			}
		});

		window.addEventListener('mousemove', (e) => {
			if (this.mouseMoveTicking) return;
			this.mouseMoveTicking = true;

			requestAnimationFrame(() => {
				this.mouseMoveTicking = false;
				this.handleMouseMove(e);
			});
		});

		const handleMouseUp = () => {
			if (this.renderer.isDraggingCamera) {
				this.renderer.isDraggingCamera = false;
				el.style.cursor = 'default';
			}
			if (this.renderer.isPainting || this.renderer.isRightPainting) {
				this.renderer.isPainting = false;
				this.renderer.isRightPainting = false;
				this.state.pushHistory();
			}
		};

		window.addEventListener('mouseup', handleMouseUp);
		el.addEventListener('mouseleave', handleMouseUp);

		el.addEventListener('contextmenu', (e) => e.preventDefault());

		el.addEventListener('wheel', (e) => {
			e.preventDefault();
			const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
			const newZoom = Math.max(0.2, Math.min(5.0, this.renderer.zoom * zoomFactor));

			const rect = el.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			this.renderer.cameraX = mouseX - (mouseX - this.renderer.cameraX) * (newZoom / this.renderer.zoom);
			this.renderer.cameraY = mouseY - (mouseY - this.renderer.cameraY) * (newZoom / this.renderer.zoom);
			this.renderer.zoom = newZoom;

			this.renderer.requestRenderAll();

			const event = new CustomEvent('zoomchange', { detail: { zoom: this.renderer.zoom } });
			window.dispatchEvent(event);
		}, { passive: false });
	}

	handleMouseMove(e) {
		if (this.renderer.isDraggingCamera) {
			const dx = e.clientX - this.renderer.lastMouseX;
			const dy = e.clientY - this.renderer.lastMouseY;
			this.renderer.cameraX += dx;
			this.renderer.cameraY += dy;
			this.renderer.lastMouseX = e.clientX;
			this.renderer.lastMouseY = e.clientY;
			this.renderer.requestRenderAll();
		} else {
			const { cellX, cellY, edge } = this.getMouseGridPos(e);
			if (cellX !== this.renderer.hoveredCell.x || cellY !== this.renderer.hoveredCell.y || edge !== this.renderer.hoveredCell.edge) {
				this.renderer.hoveredCell = { x: cellX, y: cellY, edge };
				// 關鍵優化：Hover 變更時，僅請求極輕量的頂層 Overlay 重繪 (耗費 <0.1ms)，完全不重繪底層地塊！
				this.renderer.requestRenderOverlay();

				const displayX = cellX + 1;
				const displayY = cellY + 1;
				const gameX = (this.state.scheme.worldOriginX || 10500) + cellX;
				const gameY = (this.state.scheme.worldOriginY || 9200) + cellY;

				const event = new CustomEvent('gridhover', {
					detail: {
						x: displayX,
						y: displayY,
						gameX,
						gameY,
					},
				});
				window.dispatchEvent(event);
			}

			if (this.renderer.isRightPainting) {
				this.applicator.applyRightClickErase(cellX, cellY, edge);
			} else if (this.renderer.isPainting && this.state.shapeMode === 'single') {
				this.applicator.applyBrushAt(cellX, cellY, edge);
			}
		}
	}
}
