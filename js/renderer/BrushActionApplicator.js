/**
 * BrushActionApplicator.js - 筆刷與圖形繪製動作發動器 (Brush & Shape Action Dispatcher)
 * 負責將點擊、塗抹、直線與矩形等畫筆/橡皮擦指令轉化為 StateManager 的領域變更
 */

import { ShapeStrokeEngine } from './ShapeStrokeEngine.js';

export class BrushActionApplicator {
	/**
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 */
	constructor(stateManager) {
		this.state = stateManager;
	}

	/**
	 * 單點 / 塗抹筆刷操作
	 */
	applyBrushAt(x, y, edge) {
		const tool = this.state.activeTool;
		const brushType = this.state.brushType;
		const colorId = this.state.activeColorId;

		if (tool === 'pencil') {
			if (brushType === 'floor') {
				this.state.setTileFloor(x, y, colorId);
			} else if (brushType === 'wall' && edge) {
				this.state.setTileWall(x, y, edge, colorId);
			}
		} else if (tool === 'erase-floor') {
			this.state.removeFloor(x, y);
		} else if (tool === 'erase-wall' && edge) {
			this.state.removeWall(x, y, edge);
		}
		this.state.notifyStateChange();
	}

	/**
	 * 右鍵快速抹除操作
	 */
	applyRightClickErase(x, y, edge) {
		const brushType = this.state.brushType;
		const tool = this.state.activeTool;

		if (brushType === 'wall' || tool === 'erase-wall') {
			if (edge) {
				this.state.removeWall(x, y, edge);
			}
		} else {
			this.state.removeFloor(x, y);
		}
		this.state.notifyStateChange();
	}

	/**
	 * 圖形筆刷 (直線 Line / 矩形 Box) 操作
	 */
	applyShapeBrush(start, end) {
		const shape = this.state.shapeMode;
		const tool = this.state.activeTool;
		const brushType = this.state.brushType;
		const colorId = this.state.activeColorId;

		this.state.batchOperation(() => {
			if (shape === 'box') {
				const isErasing = tool === 'erase-wall';
				const bounds = ShapeStrokeEngine.getBoxBounds(start, end, isErasing ? 'wall' : brushType, isErasing);
				if (brushType === 'wall' || isErasing) {
					bounds.walls.forEach(w => {
						if (tool === 'pencil') this.state.setTileWall(w.x, w.y, w.edge, colorId);
						else if (tool === 'erase-wall') this.state.removeWall(w.x, w.y, w.edge);
					});
				} else {
					bounds.floors.forEach(f => {
						if (tool === 'pencil') this.state.setTileFloor(f.x, f.y, colorId);
						else if (tool === 'erase-floor') this.state.removeFloor(f.x, f.y);
					});
				}
			} else if (shape === 'line') {
				const points = ShapeStrokeEngine.getBresenhamLine(start.x, start.y, end.x, end.y);
				points.forEach(p => {
					if (tool === 'pencil') {
						if (brushType === 'floor') this.state.setTileFloor(p.x, p.y, colorId);
						else if (brushType === 'wall') this.state.setTileWall(p.x, p.y, start.edge || 'north', colorId);
					} else if (tool === 'erase-floor') {
						this.state.removeFloor(p.x, p.y);
					} else if (tool === 'erase-wall') {
						this.state.removeWall(p.x, p.y, start.edge || 'north');
					}
				});
			}
		});
	}
}
