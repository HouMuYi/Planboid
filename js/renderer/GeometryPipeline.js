/**
 * GeometryPipeline.js - 統一幾何投影管線與樓層視覺偏移 (LevelVisualOffset)
 * 合流 CanvasRenderer 與 SvgExporter 的幾何頂點與多邊形運算邏輯
 *
 * 架構原則 (重構後)：
 * - getTilePolyPoints / getWallQuad96Points 只接受純邏輯 (x, y) 座標，不再套用 Z 軸視覺偏移。
 * - Z 軸視覺偏移 (螢幕像素量) 由 calcZTranslate 計算，交給繪製端 (ctx.translate / SVG <g transform>) 統一套用。
 * - LevelVisualOffset 僅保留給 InputDispatcher 逆算滑鼠座標時使用。
 */

import { IsoMath } from './IsoMath.js';

/**
 * 計算第 z 層樓相對於 z=0 的螢幕像素偏移量
 * 數學推導 (2:1 IsoMath 線性性)：
 *   gridToScreen(x - 3zp, y - 3zp) = gridToScreen(x, y) + gridToScreen(-3zp, -3zp)
 *   ΔsX = -3zp * (64-32p) + 3zp * 32p = -192zp(1-p)
 *   ΔsY = -3zp * 16p + (-3zp) * (32-16p) = -96zp
 * @param {number} z
 * @param {number} progress 視角插值 [0, 1]
 * @returns {{ dx: number, dy: number }}
 */
export function calcZTranslate(z, progress = 1.0) {
	if (z === 0 || progress === 0) return { dx: 0, dy: 0 };
	// 純螢幕空間高程映射：永遠只有垂直向上的位移！徹底消滅水平拋物線錯位。
	return { dx: 0, dy: -96 * z * progress };
}

export class GeometryPipeline {
	/**
	 * 計算地塊四個頂點的螢幕投影座標 (純邏輯座標，不含 Z 軸偏移)
	 */
	static getTilePolyPoints(isoMath, x, y, progress = 1.0) {
		return [
			isoMath.gridToScreen(x, y, progress),
			isoMath.gridToScreen(x + 1, y, progress),
			isoMath.gridToScreen(x + 1, y + 1, progress),
			isoMath.gridToScreen(x, y + 1, progress),
		];
	}

	/**
	 * 計算 96px 3D 牆面立體四邊形頂點 (純邏輯座標，不含 Z 軸偏移)
	 */
	static getWallQuad96Points(isoMath, x, y, edge, progress = 1.0) {
		let b0, b1;
		const e = String(edge || '').toLowerCase();
		if (e === 'north' || e === 'n') {
			b0 = isoMath.gridToScreen(x, y, progress);
			b1 = isoMath.gridToScreen(x + 1, y, progress);
		} else if (e === 'west' || e === 'w') {
			b0 = isoMath.gridToScreen(x, y, progress);
			b1 = isoMath.gridToScreen(x, y + 1, progress);
		} else if (e === 'east' || e === 'e') {
			b0 = isoMath.gridToScreen(x + 1, y, progress);
			b1 = isoMath.gridToScreen(x + 1, y + 1, progress);
		} else if (e === 'south' || e === 's') {
			b0 = isoMath.gridToScreen(x, y + 1, progress);
			b1 = isoMath.gridToScreen(x + 1, y + 1, progress);
		}

		if (!b0 || !b1) return null;

		const wallHeight = 96 * progress;
		const t0 = { x: b0.x, y: b0.y - wallHeight };
		const t1 = { x: b1.x, y: b1.y - wallHeight };

		return [b0, b1, t1, t0];
	}

	/**
	 * 排序並過濾指定 Z 軸視角下的 Tile 渲染陣列，按樓層分組回傳
	 * @returns {{ z: number, alpha: number, desatFactor: number, isCurrent: boolean, items: Array }[]}
	 */
	static getSortedLayersToRender(tiles, currentZ, ghostEnabled = true) {
		const zSet = new Set([currentZ]);
		Object.keys(tiles).forEach(k => {
			zSet.add(parseInt(k.split(',')[2], 10));
		});

		const sortedZLevels = Array.from(zSet).sort((a, b) => a - b);
		const layers = [];

		sortedZLevels.forEach(z => {
			const isCurrent = z === currentZ;
			if (!isCurrent && !ghostEnabled) return;

			const dist = Math.abs(z - currentZ);
			const alpha = isCurrent ? 1.0 : Math.max(0.08, 0.35 / (dist * 1.1));
			const desatFactor = isCurrent ? 0.0 : 0.75;

			const items = [];
			Object.entries(tiles).forEach(([key, tile]) => {
				const [xStr, yStr, zStr] = key.split(',');
				if (parseInt(zStr, 10) !== z) return;
				items.push({
					x: parseInt(xStr, 10),
					y: parseInt(yStr, 10),
					tile,
				});
			});

			if (items.length > 0 || isCurrent) {
				layers.push({ z, isCurrent, alpha, desatFactor, items });
			}
		});

		return layers;
	}

	/**
	 * 計算能夠在指定 Viewport 下「恰恰好包覆全畫布與所有樓層地塊」的最佳 Camera X, Y 與 Zoom
	 */
	static calculateFitCameraPos(isoMath, scheme, currentProgress, viewportWidth, viewportHeight, padding = 40, sidebarWidth = 0) {
		const w = scheme.width;
		const h = scheme.height;

		const zSet = new Set([0]);
		if (scheme && scheme.tiles) {
			Object.keys(scheme.tiles).forEach(k => {
				const zVal = parseInt(k.split(',')[2], 10);
				if (!isNaN(zVal)) zSet.add(zVal);
			});
		}
		const maxZ = Math.max(...Array.from(zSet));
		const minZ = Math.min(...Array.from(zSet));

		const samplePoints = [];
		[minZ, maxZ].forEach(z => {
			const { dx, dy } = calcZTranslate(z, currentProgress);
			// 四個角落 + Z 偏移
			[[0, 0], [w, 0], [w, h], [0, h]].forEach(([gx, gy]) => {
				const p = isoMath.gridToScreen(gx, gy, currentProgress);
				samplePoints.push({ x: p.x + dx, y: p.y + dy });
				// 牆面頂端再往上 96px
				samplePoints.push({ x: p.x + dx, y: p.y + dy - 96 * currentProgress });
			});
		});

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		samplePoints.forEach(p => {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		});

		const boundsW = Math.max(10, maxX - minX);
		const boundsH = Math.max(10, maxY - minY);

		const effectiveWidth = Math.max(100, viewportWidth - sidebarWidth);

		const zoomX = (effectiveWidth - padding * 2) / boundsW;
		const zoomY = (viewportHeight - padding * 2) / boundsH;
		const fitZoom = Math.max(0.15, Math.min(4.0, Math.min(zoomX, zoomY)));

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		const cameraX = effectiveWidth / 2 - centerX * fitZoom;
		const cameraY = viewportHeight / 2 - centerY * fitZoom;

		return { zoom: fitZoom, cameraX, cameraY, minX, minY, maxX, maxY };
	}
}
