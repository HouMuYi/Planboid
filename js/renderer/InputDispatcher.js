/**
 * InputDispatcher.js - Canvas 輸入與互動事件分派器 (Input Event Dispatcher Seam)
 * 負責 Canvas DOM 事件綁定、滑鼠座標反算、相機 Drag/Zoom 與筆刷呼叫分派
 * 包含 60FPS 訊框鎖與分層繪製調度 (rAF Lock + Overlay Decoupling)
 *
 * 互動邏輯 (地塊與邊線共用「按下起點、放開終點」統一心智模型)：
 * - 地塊 (floor 筆刷 / 選取工具)：mousedown 記錄起點格，mouseup 時若終點格與起點格相同視為單格操作，
 *   否則視為矩形範圍操作 (起訖對角)。全程僅在 mouseup 當下才寫入領域資料，中途純預覽。
 * - 邊線 (wall 筆刷)：遊標吸附至地塊網格交叉點。首次 mousedown 記錄交叉點起點；之後不論是「按住拖曳
 *   到另一交叉點放開」或「放開後移動遊標、再次點擊」，只要 mouseup 當下的終點交叉點與起點不同，就
 *   立即結算為兩點之間沿同一 X 軸或同一 Y 軸的整排邊線 (軸向鎖定由 GeometryPipeline.constrainAxisPoint 保證)。
 *   若終點與起點相同 (單純點擊尚未移動)，則保留起點、繼續等待下一次互動。
 */

import { CONFIG } from '../core/Config.js';
import { calcZTranslate, GeometryPipeline } from './GeometryPipeline.js';

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
	 * 計算滑鼠對應的邏輯網格座標 (地塊)、最近邊緣區 (供右鍵快速抹除使用) 與最近網格交叉點 (供邊線工具吸附使用)
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
		// (此區域判定僅供右鍵快速抹除的即時單邊偵測使用，與邊線筆刷的交叉點吸附為兩套獨立機制)
		const snapMin = CONFIG.EDGE_SNAP_MIN;
		const snapMax = CONFIG.EDGE_SNAP_MAX;

		if (localY < snapMin && localX >= snapMin && localX <= snapMax) {
			edge = 'north';
		} else if (localY > snapMax && localX >= snapMin && localX <= snapMax) {
			edge = 'south';
		} else if (localX < snapMin && localY >= snapMin && localY <= snapMax) {
			edge = 'west';
		} else if (localX > snapMax && localY >= snapMin && localY <= snapMax) {
			edge = 'east';
		}

		// 邊線筆刷交叉點吸附：直接四捨五入至最近的網格交叉點 (地塊網格的頂點)
		const ix = Math.round(res.gridX);
		const iy = Math.round(res.gridY);

		return { cellX: logicX, cellY: logicY, edge, ix, iy };
	}

	/**
	 * 統一無腦中斷機制：一站式重置所有需起點/終點、選區、貼上或拖曳中之瞬態操作
	 * @returns {boolean} 是否中斷了任何活動中的瞬態操作
	 */
	cancelActiveOperation() {
		let canceledAny = false;

		// 1. 重置地塊矩形拖曳起點與邊線交叉點起點
		if (this.renderer.rectStartCell || this.renderer.wallStartPoint) {
			this.renderer.rectStartCell = null;
			this.renderer.wallStartPoint = null;
			canceledAny = true;
		}

		// 2. 重置 Ctrl+V 跟隨貼上預覽模式
		if (this.state.isPastingMode) {
			this.state.isPastingMode = false;
			canceledAny = true;
		}

		// 3. 清除高亮選區/選區框
		if (this.state.selectedCell || this.state.selectionBox) {
			this.state.selectedCell = null;
			this.state.selectionBox = null;
			canceledAny = true;
		}

		// 4. 重置進行中之塗抹、右鍵擦除與相機拖曳
		if (this.renderer.isPainting || this.renderer.isRightPainting || this.renderer.isDraggingCamera) {
			this.renderer.isPainting = false;
			this.renderer.isRightPainting = false;
			this.renderer.isDraggingCamera = false;
			canceledAny = true;
		}

		if (canceledAny) {
			this.renderer.requestRenderAll();
			this.state.notifyStateChange();
		}

		return canceledAny;
	}

	/**
	 * 結算地塊矩形操作 (floor 筆刷 / 選取工具共用)：起點與終點格相同視為單格，否則視為矩形
	 */
	finalizeRectOperation() {
		const start = this.renderer.rectStartCell;
		this.renderer.rectStartCell = null;
		this.renderer.isPainting = false;
		if (!start) return;

		const end = this.renderer.hoveredCell;
		if (end.x < 0 || end.y < 0) return;

		const minX = Math.min(start.x, end.x);
		const maxX = Math.max(start.x, end.x);
		const minY = Math.min(start.y, end.y);
		const maxY = Math.max(start.y, end.y);

		if (this.state.activeTool === 'select') {
			if (minX === maxX && minY === maxY) {
				if (minX >= 0 && minX < this.state.scheme.width && minY >= 0 && minY < this.state.scheme.height) {
					this.state.selectedCell = { x: minX, y: minY };
					this.state.selectionBox = null;
					this.state.notifyStateChange();
				}
			} else {
				this.state.selectionBox = { minX, minY, maxX, maxY };
				this.state.selectedCell = { x: minX, y: minY };
				this.state.notifyStateChange();
			}
		} else {
			this.applicator.applyRectFloor(minX, minY, maxX, maxY);
		}

		this.renderer.requestRenderAll();
	}

	/**
	 * 結算邊線交叉點直線操作：僅在終點 (依軸向鎖定後) 與起點不同時才真正寫入並重置起點
	 */
	finalizeWallOperationIfMoved() {
		const start = this.renderer.wallStartPoint;
		if (!start) return;

		const raw = this.renderer.hoveredIntersection;
		if (raw.x < 0 || raw.y < 0) return;

		const end = GeometryPipeline.constrainAxisPoint(start, raw);
		if (end.x === start.x && end.y === start.y) return; // 尚未移動到不同交叉點，繼續等待下一次互動

		this.applicator.applyWallLine(start, end);
		this.renderer.wallStartPoint = null;
		this.renderer.requestRenderAll();
	}

	setupEvents() {
		const el = this.renderer.canvas;

		el.addEventListener('mousedown', (e) => {
			if (this.renderer.isAnimating) return;

			const { cellX, cellY, edge, ix, iy } = this.getMouseGridPos(e);

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
				if (this.state.isPastingMode) {
					this.state.pasteSelection(cellX, cellY);
					this.renderer.requestRenderAll();
					return;
				}

				const tool = this.state.activeTool;
				const isWallMode = tool !== 'select' && this.state.brushType === 'wall';

				if (isWallMode) {
					// 邊線工具：只在尚未設定起點時記錄交叉點起點，其餘一律交由 mouseup 統一結算
					if (!this.renderer.wallStartPoint) {
						this.renderer.wallStartPoint = { x: ix, y: iy };
						this.renderer.requestRenderOverlay();
					}
					return;
				}

				// 地塊筆刷 / 選取工具：記錄拖曳起點，統一交由 mouseup 判定單格或矩形
				this.renderer.rectStartCell = { x: cellX, y: cellY };
				this.renderer.isPainting = true;
				this.renderer.requestRenderOverlay();
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

			if (this.renderer.isRightPainting) {
				this.renderer.isRightPainting = false;
				this.state.pushHistory();
			}

			if (this.renderer.rectStartCell) {
				this.finalizeRectOperation();
			}

			if (this.renderer.wallStartPoint) {
				this.finalizeWallOperationIfMoved();
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
				this.renderer.rectStartCell = null;
				this.renderer.wallStartPoint = null;
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
				const { cellX, cellY, edge, ix, iy } = this.getMouseGridPos(touch);
				this.updateHoverState(cellX, cellY, edge, ix, iy);

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

					const newTargetZoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, currentTargetZoom * zoomRatio));

					// 同時計算雙指中心點的位移 (Two-finger Pan)
					const deltaCenterX = centerX - this.lastTouchCenterX;
					const deltaCenterY = centerY - this.lastTouchCenterY;

					this.targetCameraX = centerX - (centerX - currentTargetCamX) * (newTargetZoom / currentTargetZoom)
						+ deltaCenterX;
					this.targetCameraY = centerY - (centerY - currentTargetCamY) * (newTargetZoom / currentTargetZoom)
						+ deltaCenterY;
					this.targetZoom = newTargetZoom;

					this.isZoomAnimating = true;
					this.renderer.requestRenderAll();
				}

				this.lastTouchDist = dist;
				this.lastTouchCenterX = centerX;
				this.lastTouchCenterY = centerY;
			} else if (e.touches.length === 1) {
				if (this.isTouchPinching) return;

				const touch = e.touches[0];
				const { cellX, cellY, edge, ix, iy } = this.getMouseGridPos(touch);
				this.updateHoverState(cellX, cellY, edge, ix, iy);

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
			if (this.renderer.isAnimating) return;

			const currentTargetZoom = this.isZoomAnimating ? this.targetZoom : this.renderer.zoom;
			const currentTargetCamX = this.isZoomAnimating ? this.targetCameraX : this.renderer.cameraX;
			const currentTargetCamY = this.isZoomAnimating ? this.targetCameraY : this.renderer.cameraY;

			const rawTargetZoom = e.deltaY < 0
				? currentTargetZoom * CONFIG.ZOOM_WHEEL_FACTOR
				: currentTargetZoom / CONFIG.ZOOM_WHEEL_FACTOR;
			const newTargetZoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, rawTargetZoom));

			const rect = el.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			this.targetCameraX = mouseX - (mouseX - currentTargetCamX) * (newTargetZoom / currentTargetZoom);
			this.targetCameraY = mouseY - (mouseY - currentTargetCamY) * (newTargetZoom / currentTargetZoom);
			this.targetZoom = newTargetZoom;

			this.isZoomAnimating = true;
			this.renderer.requestRenderAll();
		}, { passive: false });
	}

	updateHoverState(cellX, cellY, edge, ix = -1, iy = -1) {
		const changed = cellX !== this.renderer.hoveredCell.x
			|| cellY !== this.renderer.hoveredCell.y
			|| edge !== this.renderer.hoveredCell.edge
			|| ix !== this.renderer.hoveredIntersection.x
			|| iy !== this.renderer.hoveredIntersection.y;

		if (changed) {
			this.renderer.hoveredCell = { x: cellX, y: cellY, edge };
			this.renderer.hoveredIntersection = { x: ix, y: iy };
			this.renderer.requestRenderOverlay();

			const displayX = cellX + 1;
			const displayY = cellY + 1;
			const gameX = (this.state.scheme.worldOriginX || CONFIG.DEFAULT_ORIGIN_X) + cellX;
			const gameY = (this.state.scheme.worldOriginY || CONFIG.DEFAULT_ORIGIN_Y) + cellY;

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
		// 視角過渡動畫期間排他冷凍網格懸停游標，防止座標抖動
		if (this.renderer.isAnimating) {
			this.updateHoverState(-1, -1, null);
			return;
		}

		// 若遊標移至 .view-overlay-controls 或 .canvas-info-overlay 等懸浮 UI 上方，停止畫布懸停追蹤與游標高亮
		if (e.target && e.target.closest && (e.target.closest('.view-overlay-controls') || e.target.closest('.canvas-info-overlay'))) {
			if (!this.renderer.isDraggingCamera && !this.renderer.isPainting && !this.renderer.isRightPainting) {
				this.updateHoverState(-1, -1, null);
				return;
			}
		}

		if (this.renderer.isDraggingCamera) {
			const dx = e.clientX - this.renderer.lastMouseX;
			const dy = e.clientY - this.renderer.lastMouseY;
			this.renderer.cameraX += dx;
			this.renderer.cameraY += dy;
			this.renderer.lastMouseX = e.clientX;
			this.renderer.lastMouseY = e.clientY;
			this.renderer.requestRenderAll();
		} else {
			const { cellX, cellY, edge, ix, iy } = this.getMouseGridPos(e);
			this.updateHoverState(cellX, cellY, edge, ix, iy);

			if (this.renderer.isRightPainting) {
				this.applicator.applyRightClickErase(cellX, cellY, edge);
			}
		}
	}
}
