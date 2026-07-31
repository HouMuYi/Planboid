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
import { CONFIG } from '../core/Config.js';

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
	return { dx: 0, dy: -(CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET) * z * progress };
}

/**
 * 鬼影層 (Ghost Layer) 視覺透視與衰減常數配置
 */
export const GHOST_CONFIG = {
	get BASE_ALPHA() { return CONFIG.GHOST_BASE_ALPHA; },
	get ALPHA_DECAY() { return CONFIG.GHOST_ALPHA_DECAY; },
	get SATURATION_DECAY() { return CONFIG.GHOST_SATURATION_DECAY; },
};

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

		const wallHeight = CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET * progress;
		const t0 = { x: b0.x, y: b0.y - wallHeight };
		const t1 = { x: b1.x, y: b1.y - wallHeight };

		return [b0, b1, t1, t0];
	}

	/**
	 * 排序並過濾指定 Z 軸視角下的 Tile 渲染陣列，按樓層分組回傳
	 * @returns {{ z: number, alpha: number, desatFactor: number, isCurrent: boolean, items: Array }[]}
	 */
	static getSortedLayersToRender(tiles, currentZ, otherFloorsMode = 'ghost') {
		let mode = otherFloorsMode;
		if (typeof mode === 'boolean') {
			mode = mode ? 'ghost' : 'hidden';
		}

		const zSet = new Set([currentZ]);
		Object.keys(tiles).forEach(k => {
			zSet.add(parseInt(k.split(',')[2], 10));
		});

		const sortedZLevels = Array.from(zSet).sort((a, b) => a - b);
		const layers = [];

		sortedZLevels.forEach(z => {
			const isCurrent = z === currentZ;
			if (!isCurrent && mode === 'hidden') return;

			const dist = Math.abs(z - currentZ);
			let alpha = 1.0;
			let desatFactor = 0.0;

			if (!isCurrent) {
				if (mode === 'ghost') {
					// 差 1 層鬼影為 BASE_ALPHA，每多隔 1 層乘一次 ALPHA_DECAY
					alpha = Math.max(0.05, GHOST_CONFIG.BASE_ALPHA * Math.pow(GHOST_CONFIG.ALPHA_DECAY, dist - 1));
					// 彩度留存率隨距離次方衰減，去飽和度因子 desatFactor = 1.0 - 彩度留存率
					const saturation = Math.pow(GHOST_CONFIG.SATURATION_DECAY, dist);
					desatFactor = Math.min(0.95, 1.0 - saturation);
				} else if (mode === 'solid') {
					alpha = 1.0;
					desatFactor = 0.0;
				}
			}

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
	static calculateFitCameraPos(isoMath, scheme, currentProgress, viewportWidth, viewportHeight, padding = CONFIG.FIT_VIEW_PADDING, sidebarWidth = 0, currentZ = 0) {
		const w = scheme.width;
		const h = scheme.height;

		// 目前 Z 樓層中心為權威畫布對齊中心點
		const centerPos = isoMath.gridToScreen(w / 2, h / 2, currentProgress);
		const { dx: currentDx, dy: currentDy } = calcZTranslate(currentZ, currentProgress);
		const targetX = centerPos.x + currentDx;
		const targetY = centerPos.y + currentDy;

		const zSet = new Set([0, currentZ]);
		if (scheme && scheme.tiles) {
			Object.keys(scheme.tiles).forEach(k => {
				const zVal = parseInt(k.split(',')[2], 10);
				if (!isNaN(zVal)) zSet.add(zVal);
			});
		}
		const sortedZ = Array.from(zSet);
		const maxZ = Math.max(...sortedZ);
		const minZ = Math.min(...sortedZ);

		const p = Math.max(0, padding);
		const samplePoints = [];
		[minZ, maxZ].forEach(z => {
			const { dx, dy } = calcZTranslate(z, currentProgress);
			// 帶入 FIT_VIEW_PADDING 留白格數的外擴四角落頂點 + Z 軸高程偏移
			[[-p, -p], [w + p, -p], [w + p, h + p], [-p, h + p]].forEach(([gx, gy]) => {
				const pt = isoMath.gridToScreen(gx, gy, currentProgress);
				samplePoints.push({ x: pt.x + dx, y: pt.y + dy });
				// 牆面頂端 96px 高度
				samplePoints.push({ x: pt.x + dx, y: pt.y + dy - (CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET) * currentProgress });
			});
		});

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		samplePoints.forEach(pt => {
			if (pt.x < minX) minX = pt.x;
			if (pt.x > maxX) maxX = pt.x;
			if (pt.y < minY) minY = pt.y;
			if (pt.y > maxY) maxY = pt.y;
		});

		const boundsW = Math.max(10, maxX - minX);
		const boundsH = Math.max(10, maxY - minY);

		const effectiveWidth = Math.max(100, viewportWidth - sidebarWidth);

		const zoomX = effectiveWidth / boundsW;
		const zoomY = viewportHeight / boundsH;
		const fitZoom = Math.max(0.15, Math.min(4.0, Math.min(zoomX, zoomY)));

		const cameraX = (effectiveWidth / 2) - targetX * fitZoom;
		const cameraY = (viewportHeight / 2) - targetY * fitZoom;

		return { zoom: fitZoom, cameraX, cameraY, minX, minY, maxX, maxY };
	}

	/**
	 * 權威 2D 正交牆線渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawWallLine2D(ctx, isoMath, x, y, edge, colorHex, zoom, currentProgress = 0) {
		let p0, p1;

		const e = String(edge || '').toLowerCase();
		if (e === 'north' || e === 'n') {
			p0 = isoMath.gridToScreen(x, y, currentProgress);
			p1 = isoMath.gridToScreen(x + 1, y, currentProgress);
		} else if (e === 'west' || e === 'w') {
			p0 = isoMath.gridToScreen(x, y, currentProgress);
			p1 = isoMath.gridToScreen(x, y + 1, currentProgress);
		}

		if (!p0 || !p1) return;

		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const len = Math.hypot(dx, dy);

		if (len > 0) {
			ctx.save();
			const nx = -dy / len;
			const ny = dx / len;
			const offset = 2.2 / zoom;

			// 1. 長邊兩側 4px 深色襯底線 (短邊平口不封線)
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.lineWidth = 4 / zoom;
			ctx.lineCap = 'butt';

			ctx.beginPath();
			ctx.moveTo(p0.x + nx * offset, p0.y + ny * offset);
			ctx.lineTo(p1.x + nx * offset, p1.y + ny * offset);
			ctx.moveTo(p0.x - nx * offset, p0.y - ny * offset);
			ctx.lineTo(p1.x - nx * offset, p1.y - ny * offset);
			ctx.stroke();

			// 2. 中央牆線主體
			ctx.strokeStyle = colorHex;
			ctx.lineWidth = 5 / zoom;
			ctx.lineCap = 'butt';
			ctx.beginPath();
			ctx.moveTo(p0.x, p0.y);
			ctx.lineTo(p1.x, p1.y);
			ctx.stroke();

			ctx.restore();
		}
	}

	/**
	 * 權威 3D 菱形立體牆面渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawWallQuad96px(ctx, isoMath, x, y, edge, colorHex, zoom, currentProgress = 1.0, fillAlpha = CONFIG.WALL_FILL_ALPHA) {
		const quad = this.getWallQuad96Points(isoMath, x, y, edge, currentProgress);
		if (!quad) return;

		const [b0, b1, t1, t0] = quad;
		const savedAlpha = ctx.globalAlpha;

		const topMidX = (t0.x + t1.x) / 2;
		const topMidY = (t0.y + t1.y) / 2;
		const botMidX = (b0.x + b1.x) / 2;
		const botMidY = (b0.y + b1.y) / 2;

		ctx.save();

		// 1. 原色層
		ctx.globalAlpha = savedAlpha * fillAlpha;
		ctx.fillStyle = colorHex;
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.lineTo(t0.x, t0.y);
		ctx.closePath();
		ctx.fill();

		// 2. 平行向量 Shading 光影遮罩
		const shadingGrad = ctx.createLinearGradient(topMidX, topMidY, botMidX, botMidY);
		shadingGrad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
		shadingGrad.addColorStop(1, 'rgba(0, 0, 0, 0.32)');

		ctx.globalAlpha = savedAlpha * fillAlpha;
		ctx.fillStyle = shadingGrad;
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.lineTo(t0.x, t0.y);
		ctx.closePath();
		ctx.fill();

		// 3. 主輪廓線
		ctx.globalAlpha = savedAlpha * fillAlpha * 1.5;
		ctx.strokeStyle = colorHex;
		ctx.lineWidth = 1.5 / zoom;
		ctx.stroke();

		// 4. 牆頂 1px 高光
		ctx.globalAlpha = savedAlpha * 0.75;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 1.5 / zoom;
		ctx.beginPath();
		ctx.moveTo(t0.x, t0.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.stroke();

		// 5. 牆底 1px 壓角暗邊
		ctx.globalAlpha = savedAlpha * 0.6;
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 1.5 / zoom;
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.stroke();

		ctx.restore();
	}

	/**
	 * 權威 3D/2D 牆體 SVG 向量標籤生成管道 (SVG 匯出專用)
	 */
	static getWallSvgElements(isoMath, x, y, z, edge, colorId, color) {
		const quad = this.getWallQuad96Points(isoMath, x, y, edge, 1.0);
		if (!quad) return '';

		const [b0, b1, t1, t0] = quad;
		let str = '';
		// 1. 原色面片
		str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall" data-edge="${edge}" data-color-id="${colorId}" points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" stroke="${color}" stroke-opacity="0.675" stroke-width="1.5" />\n`;
		// 2. 向量 Shading 遮罩
		str += `<polygon points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="url(#svg-wall-shading)" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" />\n`;
		// 3. 牆頂 1px 高光
		str += `<line x1="${t0.x}" y1="${t0.y}" x2="${t1.x}" y2="${t1.y}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1.5" />\n`;
		// 4. 牆底 1px 壓角暗線
		str += `<line x1="${b0.x}" y1="${b0.y}" x2="${b1.x}" y2="${b1.y}" stroke="#000000" stroke-opacity="0.6" stroke-width="1.5" />\n`;

		return str;
	}

	/**
	 * 權威地塊多邊形渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawTilePoly(ctx, isoMath, x, y, colorHex, currentProgress = 1.0) {
		const [p0, p1, p2, p3] = this.getTilePolyPoints(isoMath, x, y, currentProgress);

		ctx.fillStyle = colorHex;
		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.lineTo(p2.x, p2.y);
		ctx.lineTo(p3.x, p3.y);
		ctx.closePath();
		ctx.fill();
	}

	/**
	 * 權威地塊文字標籤渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawTileText(ctx, isoMath, x, y, text, zoom, currentProgress = 1.0) {
		const center = isoMath.gridToScreen(x + 0.5, y + 0.5, currentProgress);

		ctx.save();
		ctx.fillStyle = '#ffffff';
		ctx.font = `bold ${Math.max(10, 12 / zoom)}px Inter, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.shadowColor = 'rgba(0,0,0,0.9)';
		ctx.shadowBlur = 4;
		ctx.fillText(text, center.x, center.y);
		ctx.restore();
	}

	/**
	 * 權威樓層鬼影去飽和度色號運算 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static desaturateHex(hex, factor = 0.5) {
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
}
