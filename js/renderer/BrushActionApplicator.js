/**
 * BrushActionApplicator.js - 筆刷繪製動作發動器 (Brush Action Dispatcher)
 * 負責將矩形地塊批次操作與交叉點邊線直線操作轉化為 StateManager 的領域變更
 */

export class BrushActionApplicator {
	/**
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 */
	constructor(stateManager) {
		this.state = stateManager;
	}

	/**
	 * 右鍵快速抹除操作
	 */
	applyRightClickErase(x, y, edge) {
		if (!this.state || !this.state.scheme) return;
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
	 * 地塊矩形批次操作：點擊放開為單格 (minX===maxX && minY===maxY)，拖曳放開則為矩形範圍
	 */
	applyRectFloor(minX, minY, maxX, maxY) {
		if (!this.state || !this.state.scheme) return;
		const tool = this.state.activeTool;
		const colorId = this.state.activeColorId;
		const width = this.state.scheme.width;
		const height = this.state.scheme.height;

		const startX = Math.max(0, minX);
		const endX = Math.min(width - 1, maxX);
		const startY = Math.max(0, minY);
		const endY = Math.min(height - 1, maxY);
		if (startX > endX || startY > endY) return;

		this.state.batchOperation(() => {
			for (let x = startX; x <= endX; x++) {
				for (let y = startY; y <= endY; y++) {
					if (tool === 'pencil') this.state.setTileFloor(x, y, colorId);
					else if (tool === 'erase-floor') this.state.removeFloor(x, y);
				}
			}
		});
	}

	/**
	 * 邊線交叉點直線操作：start 與 end 必須同 X 軸或同 Y 軸 (由呼叫端保證軸向鎖定)
	 * @param {{x: number, y: number}} start
	 * @param {{x: number, y: number}} end
	 */
	applyWallLine(start, end) {
		if (!this.state || !this.state.scheme) return;
		if (start.x === end.x && start.y === end.y) return;

		const tool = this.state.activeTool;
		const colorId = this.state.activeColorId;
		const width = this.state.scheme.width;
		const height = this.state.scheme.height;

		this.state.batchOperation(() => {
			if (start.y === end.y) {
				const y = start.y;
				const minX = Math.max(0, Math.min(start.x, end.x));
				const maxX = Math.min(width, Math.max(start.x, end.x));
				for (let x = minX; x < maxX; x++) {
					if (tool === 'pencil') this.state.setTileWall(x, y, 'north', colorId);
					else if (tool === 'erase-wall') this.state.removeWall(x, y, 'north');
				}
			} else {
				const x = start.x;
				const minY = Math.max(0, Math.min(start.y, end.y));
				const maxY = Math.min(height, Math.max(start.y, end.y));
				for (let y = minY; y < maxY; y++) {
					if (tool === 'pencil') this.state.setTileWall(x, y, 'west', colorId);
					else if (tool === 'erase-wall') this.state.removeWall(x, y, 'west');
				}
			}
		});
	}
}
