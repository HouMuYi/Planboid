/**
 * IsoMath.js - 精確 ISO 與 Ortho 座標幾何轉換與頂點計算
 */

import { CONFIG } from '../core/Config.js';

export class IsoMath {
	/**
	 * @param {number} tileSize 地塊尺寸 (預設 CONFIG.TILE_SIZE)
	 */
	constructor(tileSize = 32) {
		this.tileSize = tileSize;
		this.halfWidth = tileSize;
		this.halfHeight = tileSize / 2;
	}

	/**
	 * 計算網格到螢幕座標 (支援正交與菱形動態插值)
	 */
	gridToScreen(gridX, gridY, progress = 1.0) {
		const orthoX = gridX * this.tileSize;
		const orthoY = gridY * this.tileSize;

		const isoX = (gridX - gridY) * this.halfWidth;
		const isoY = (gridX + gridY) * this.halfHeight;

		return {
			x: orthoX + (isoX - orthoX) * progress,
			y: orthoY + (isoY - orthoY) * progress,
		};
	}

	/**
	 * 螢幕座標反算網格座標 (支援 0~1 動態視角過渡精確反推)
	 */
	screenToGrid(screenX, screenY, progress = 1.0) {
		const p = Math.max(0, Math.min(1, progress));
		if (p <= 0.001) {
			const gridX = screenX / this.tileSize;
			const gridY = screenY / this.tileSize;
			return {
				gridX,
				gridY,
				cellX: Math.floor(gridX),
				cellY: Math.floor(gridY),
			};
		}

		const denom = this.tileSize * (1 - p / 2 + (p * p) / 2);
		const gridY = (screenY - (screenX * p) / 2) / denom;
		const gridX = screenX / this.tileSize + gridY * p;

		return {
			gridX,
			gridY,
			cellX: Math.floor(gridX),
			cellY: Math.floor(gridY),
		};
	}

	/**
	 * 取得帶入 PZ 樓層視覺偏移 (-3z, -3z) 後的地塊四頂點 [p0, p1, p2, p3]
	 */
	getTilePolyScreen(x, y, z, progress = 1.0) {
		const rX = x - CONFIG.Z_VISUAL_OFFSET * z * progress;
		const rY = y - CONFIG.Z_VISUAL_OFFSET * z * progress;

		const p0 = this.gridToScreen(rX, rY, progress);
		const p1 = this.gridToScreen(rX + 1, rY, progress);
		const p2 = this.gridToScreen(rX + 1, rY + 1, progress);
		const p3 = this.gridToScreen(rX, rY + 1, progress);

		return [p0, p1, p2, p3];
	}
}
