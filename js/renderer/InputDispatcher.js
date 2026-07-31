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

		// 輕量短時間平滑縮放變數初始化
		this.targetZoom = this.renderer.zoom;
		this.targetCameraX = this.renderer.cameraX;
		this.targetCameraY = this.renderer.cameraY;
		this.isZoomAnimating = false;

		// 行動端雙指觸控手勢與防誤觸冷卻鎖變數
		this.lastTouchDist = 0;
		this.lastTouchCenterX = 0;
		this.lastTouchCenterY = 0;
		this.isTouchPinching = false;

		el.addEventListener('touchstart', (e) => {
			if (e.touches.length >= 2) {
				e.preventDefault();
				this.isTouchPinching = true;
				// 防護 1：雙指觸控瞬間，強制冷凍中斷任何單指繪圖/筆刷/選區狀態！
				this.renderer.isPainting = false;
				this.renderer.isRightPainting = false;
				this.renderer.shapeStartCell = null;
				this.renderer.requestRenderOverlay();

				const t1 = e.touches[0];
				const t2 = e.touches[1];
				this.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

				const rect = el.getBoundingClientRect();
				this.lastTouchCenterX = (t1.clientX + t2.clientX) / 2 - rect.left;
				this.lastTouchCenterY = (t1.clientY + t2.clientY) / 2 - rect.top;
			} else if (e.touches.length === 1) {
				// 若處於雙指離場冷卻鎖狀態，禁止觸發單指工具繪圖
				if (this.isTouchPinching) return;

				const touch = e.touches[0];
				const { cellX, cellY, edge } = this.getMouseGridPos(touch);
				this.updateHoverState(cellX, cellY, edge);

				const mouseEvent = new MouseEvent('mousedown', {
					clientX: touch.clientX,
					clientY: touch.clientY,
					button: 0,
				});
				el.dispatchEvent(mouseEvent);
			}
		}, { passive: false });

		el.addEventListener('touchmove', (e) => {
			if (e.touches.length >= 2) {
				e.preventDefault();
				this.isTouchPinching = true;
				// 防護 2：雙指手勢移動期間，持續確保筆刷被冷凍，防止誤繪
				this.renderer.isPainting = false;

				const t1 = e.touches[0];
				const t2 = e.touches[1];
				const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

				const rect = el.getBoundingClientRect();
				const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
				const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;

				if (this.lastTouchDist > 0) {
					const zoomRatio = dist / this.lastTouchDist;
					const currentTargetZoom = this.isZoomAnimating ? this.targetZoom : this.renderer.zoom;
					const currentTargetCamX = this.isZoomAnimating ? this.targetCameraX : this.renderer.cameraX;
					const currentTargetCamY = this.isZoomAnimating ? this.targetCameraY : this.renderer.cameraY;

					const newTargetZoom = Math.max(0.2, Math.min(5.0, currentTargetZoom * zoomRatio));

					// 同時計算雙指中心點的位移 (Two-finger Pan)
					const deltaCenterX = centerX - this.lastTouchCenterX;
					const deltaCenterY = centerY - this.lastTouchCenterY;

					this.targetCameraX = centerX - (centerX - currentTargetCamX) * (newTargetZoom / currentTargetZoom)
						+ deltaCenterX;
					this.targetCameraY = centerY - (centerY - currentTargetCamY) * (newTargetZoom / currentTargetZoom)
						+ deltaCenterY;
					this.targetZoom = newTargetZoom;

					if (!this.isZoomAnimating) {
						this.isZoomAnimating = true;
						this.animateZoom();
					}
				}

				this.lastTouchDist = dist;
				this.lastTouchCenterX = centerX;
				this.lastTouchCenterY = centerY;
			} else if (e.touches.length === 1) {
				if (this.isTouchPinching) return;

				const touch = e.touches[0];
				const { cellX, cellY, edge } = this.getMouseGridPos(touch);
				this.updateHoverState(cellX, cellY, edge);

				const mouseEvent = new MouseEvent('mousemove', {
					clientX: touch.clientX,
					clientY: touch.clientY,
				});
				window.dispatchEvent(mouseEvent);
			}
		}, { passive: false });

		const handleTouchEnd = (e) => {
			if (e.touches.length === 0) {
				// 當所有手指離場時，解開雙指手勢冷卻鎖
				this.isTouchPinching = false;
				this.lastTouchDist = 0;

				const mouseEvent = new MouseEvent('mouseup', {});
				window.dispatchEvent(mouseEvent);
			} else if (e.touches.length === 1) {
				// 雙指離開其中一隻時，重置距離與中心
				this.lastTouchDist = 0;
			}
		};

		el.addEventListener('touchend', handleTouchEnd);
		el.addEventListener('touchcancel', handleTouchEnd);

		el.addEventListener('wheel', (e) => {
			e.preventDefault();
			const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

			const currentTargetZoom = this.isZoomAnimating ? this.targetZoom : this.renderer.zoom;
			const currentTargetCamX = this.isZoomAnimating ? this.targetCameraX : this.renderer.cameraX;
			const currentTargetCamY = this.isZoomAnimating ? this.targetCameraY : this.renderer.cameraY;

			const newTargetZoom = Math.max(0.2, Math.min(5.0, currentTargetZoom * zoomFactor));

			const rect = el.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			this.targetCameraX = mouseX - (mouseX - currentTargetCamX) * (newTargetZoom / currentTargetZoom);
			this.targetCameraY = mouseY - (mouseY - currentTargetCamY) * (newTargetZoom / currentTargetZoom);
			this.targetZoom = newTargetZoom;

			if (!this.isZoomAnimating) {
				this.isZoomAnimating = true;
				this.animateZoom();
			}
		}, { passive: false });
	}

	animateZoom() {
		if (!this.isZoomAnimating) return;

		// 快速短時間 Lerp 插值 (0.35 因子：約 40ms 內極速滑平，超快且極致順暢)
		const factor = 0.35;
		const diffZoom = this.targetZoom - this.renderer.zoom;
		const diffCamX = this.targetCameraX - this.renderer.cameraX;
		const diffCamY = this.targetCameraY - this.renderer.cameraY;

		if (Math.abs(diffZoom) < 0.001 && Math.abs(diffCamX) < 0.1 && Math.abs(diffCamY) < 0.1) {
			this.renderer.zoom = this.targetZoom;
			this.renderer.cameraX = this.targetCameraX;
			this.renderer.cameraY = this.targetCameraY;
			this.isZoomAnimating = false;
		} else {
			this.renderer.zoom += diffZoom * factor;
			this.renderer.cameraX += diffCamX * factor;
			this.renderer.cameraY += diffCamY * factor;
			requestAnimationFrame(() => this.animateZoom());
		}

		this.renderer.requestRenderAll();
		const event = new CustomEvent('zoomchange', { detail: { zoom: this.renderer.zoom } });
		window.dispatchEvent(event);
	}

	updateHoverState(cellX, cellY, edge) {
		if (
			cellX !== this.renderer.hoveredCell.x
			|| cellY !== this.renderer.hoveredCell.y
			|| edge !== this.renderer.hoveredCell.edge
		) {
			this.renderer.hoveredCell = { x: cellX, y: cellY, edge };
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
			this.updateHoverState(cellX, cellY, edge);

			if (this.renderer.isRightPainting) {
				this.applicator.applyRightClickErase(cellX, cellY, edge);
			} else if (this.renderer.isPainting && this.state.shapeMode === 'single') {
				this.applicator.applyBrushAt(cellX, cellY, edge);
			}
		}
	}
}
