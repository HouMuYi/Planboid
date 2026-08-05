/**
 * GeometryPipeline.js - 統一幾何投影管線與樓層視覺偏移 (LevelVisualOffset)
 * 合流 CanvasRenderer 與 SvgExporter 的幾何頂點與多邊形運算邏輯
 *
 * 架構原則 (重構後)：
 * - getTilePolyPoints / getWallQuad96Points 只接受純邏輯 (x, y) 座標，不再套用 Z 軸視覺偏移。
 * - Z 軸視覺偏移 (螢幕像素量) 由 calcZTranslate 計算，交給繪製端 (ctx.translate / SVG <g transform>) 統一套用。
 * - LevelVisualOffset 僅保留給 InputDispatcher 逆算滑鼠座標時使用。
 */

import { CONFIG } from '../core/Config.js';
import { BorderEdgeNormalizer } from './BorderEdgeNormalizer.js';

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

export class GeometryPipeline {
	static constrainAxisPoint(start, raw) {
		const dx = raw.x - start.x;
		const dy = raw.y - start.y;
		return Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: start.y } : { x: start.x, y: raw.y };
	}

	static getTilePolyPoints(isoMath, x, y, progress = 1.0) {
		return [
			isoMath.gridToScreen(x, y, progress),
			isoMath.gridToScreen(x + 1, y, progress),
			isoMath.gridToScreen(x + 1, y + 1, progress),
			isoMath.gridToScreen(x, y + 1, progress),
		];
	}

	static getWallQuad96Points(isoMath, x, y, edge, progress = 1.0) {
		const { x: nx, y: ny, edge: e } = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const b0 = isoMath.gridToScreen(nx, ny, progress);
		const b1 = e === 'N' ? isoMath.gridToScreen(nx + 1, ny, progress) : (e === 'W' ? isoMath.gridToScreen(nx, ny + 1, progress) : null);

		if (!b0 || !b1) return null;

		const wallHeight = CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET * progress;
		return [b0, b1, { x: b1.x, y: b1.y - wallHeight }, { x: b0.x, y: b0.y - wallHeight }];
	}

	static getSortedLayersToRender(tiles, currentZ, otherFloorsMode = 'ghost') {
		let mode = otherFloorsMode;
		if (typeof mode === 'boolean') mode = mode ? 'ghost' : 'hidden';

		const zSet = new Set([currentZ]);
		Object.keys(tiles || {}).forEach(k => zSet.add(parseInt(k.split(',')[2], 10)));

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
					alpha = Math.max(0.05, CONFIG.GHOST_BASE_ALPHA * Math.pow(CONFIG.GHOST_ALPHA_DECAY, dist - 1));
					const saturation = Math.pow(CONFIG.GHOST_SATURATION_DECAY, dist);
					desatFactor = Math.min(0.95, 1.0 - saturation);
				} else if (mode === 'solid') {
					alpha = 1.0;
					desatFactor = 0.0;
				}
			}

			const items = [];
			Object.entries(tiles || {}).forEach(([key, tile]) => {
				const [xStr, yStr, zStr] = key.split(',');
				if (parseInt(zStr, 10) === z) {
					items.push({ x: parseInt(xStr, 10), y: parseInt(yStr, 10), tile });
				}
			});

			if (items.length > 0) {
				items.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
			}

			if (items.length > 0 || isCurrent) {
				layers.push({ z, isCurrent, alpha, desatFactor, items });
			}
		});

		return layers;
	}

	/**
	 * 統一層級 Pass 遍歷器：供 CanvasRenderer、PngExporter 與 SvgExporter 共享 Pass 1~3 的遍歷順序
	 */
	static traverseLayerPasses(layer, palette, callbacks = {}) {
		const { isCurrent, items } = layer;
		const { onFloor, onFloorObjects, onWall, onWallObjects, onLabel } = callbacks;

		// Pass 1: 地塊多邊形
		if (onFloor) {
			items.forEach(({ x, y, tile }) => {
				if (tile.floorColorId && palette[tile.floorColorId]) {
					onFloor(x, y, tile.floorColorId, tile);
				}
			});
		}

		// Pass 1.5: 地塊物件 (Floor Objects)
		if (onFloorObjects) {
			items.forEach(({ x, y, tile }) => {
				if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
					onFloorObjects(x, y, tile.floorObjects, tile);
				}
			});
		}

		// Pass 2: 牆面面片與邊線
		if (onWall) {
			items.forEach(({ x, y, tile }) => {
				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId && palette[colorId]) {
							onWall(x, y, edge, colorId, tile);
						}
					});
				}
			});
		}

		// Pass 2.5: 牆面物件 (Wall Objects)
		if (onWallObjects) {
			items.forEach(({ x, y, tile }) => {
				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
						if (Array.isArray(objArray) && objArray.length > 0) {
							onWallObjects(x, y, edge, objArray, tile);
						}
					});
				}
			});
		}

		// Pass 3: 文字標籤 (僅當前樓層)
		if (onLabel && isCurrent) {
			items.forEach(({ x, y, tile }) => {
				if (tile.label) {
					onLabel(x, y, tile.label, tile);
				}
			});
		}
	}

	/**
	 * 計算能夠在指定 Viewport 下「恰恰好包覆全畫布與所有樓層地塊」的最佳 Camera X, Y 與 Zoom
	 */
	static calculateFitCameraPos(
		isoMath,
		scheme,
		currentProgress,
		viewportWidth,
		viewportHeight,
		padding = CONFIG.FIT_VIEW_PADDING,
		sidebarWidth = 0,
		currentZ = 0,
	) {
		if (!scheme) return { zoom: 1, cameraX: 0, cameraY: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
		const w = Math.max(1, scheme.width || 0);
		const h = Math.max(1, scheme.height || 0);

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

		const safeVpW = Math.max(10, viewportWidth || 0);
		const safeVpH = Math.max(10, viewportHeight || 0);
		const safeSbW = Math.max(0, sidebarWidth || 0);
		const effectiveWidth = Math.max(10, safeVpW - safeSbW);

		const zoomX = effectiveWidth / boundsW;
		const zoomY = safeVpH / boundsH;
		const fitZoom = Math.max(0.15, Math.min(4.0, Math.min(zoomX, zoomY)));

		const cameraX = (effectiveWidth / 2) - targetX * fitZoom;
		const cameraY = (safeVpH / 2) - targetY * fitZoom;

		return { zoom: fitZoom, cameraX, cameraY, minX, minY, maxX, maxY };
	}

	/**
	 * 權威 2D 正交牆線渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawWallLine2D(ctx, isoMath, x, y, edge, colorHex, zoom, currentProgress = 0) {
		const normalized = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const nxGrid = normalized.x;
		const nyGrid = normalized.y;
		const e = normalized.edge;

		const p0 = isoMath.gridToScreen(nxGrid, nyGrid, currentProgress);
		const p1 = e === 'N' ? isoMath.gridToScreen(nxGrid + 1, nyGrid, currentProgress) : (e === 'W' ? isoMath.gridToScreen(nxGrid, nyGrid + 1, currentProgress) : null);

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

		// 動畫過渡期間 (currentProgress < 1.0)：跳過昂貴的 5 重漸層與多重高光描邊，僅做一次基礎外框描邊
		if (currentProgress < 1.0) {
			ctx.strokeStyle = colorHex;
			ctx.lineWidth = 1.5 / zoom;
			ctx.stroke();
			ctx.restore();
			return;
		}

		// 2. 平行向量 Shading 光影遮罩 (靜止與快照時開啟)
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
		str +=
			`<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall" data-edge="${edge}" data-color-id="${colorId}" points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" stroke="${color}" stroke-opacity="0.675" stroke-width="1.5" />\n`;
		// 2. 向量 Shading 遮罩
		str +=
			`<polygon points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="url(#svg-wall-shading)" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" />\n`;
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
		ctx.font = `bold ${Math.max(10, 12 / zoom)}px ${CONFIG.FONT_SANS}`;
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

	/**
	 * 在 Canvas 上繪製 2:1 ISO 菱形/多邊形的切弧圓角 (仿射切線圓角算術)
	 * 完美還原 1:1 正方形圓角在 2:1 ISO 投影下的自然橢圓切弧
	 */
	static drawIsoRoundedPolygon(ctx, points, cornerRatio = 0.15) {
		if (!Array.isArray(points) || points.length < 3) return;

		const len = points.length;
		ctx.beginPath();

		for (let i = 0; i < len; i++) {
			const prev = points[(i - 1 + len) % len];
			const curr = points[i];
			const next = points[(i + 1) % len];

			const inX = curr.x + (prev.x - curr.x) * cornerRatio;
			const inY = curr.y + (prev.y - curr.y) * cornerRatio;

			const outX = curr.x + (next.x - curr.x) * cornerRatio;
			const outY = curr.y + (next.y - curr.y) * cornerRatio;

			if (i === 0) {
				ctx.moveTo(inX, inY);
			} else {
				ctx.lineTo(inX, inY);
			}

			ctx.quadraticCurveTo(curr.x, curr.y, outX, outY);
		}

		ctx.closePath();
	}

	/**
	 * 統一物件面板文字與描邊繪製管道 (全模式共用 CONFIG.OBJECT_* 常數配置)
	 */
	static drawObjectTextLabel(ctx, text, px, py, boxSize) {
		if (!text) return;
		const rawName = String(text).substring(0, 2);
		if (!rawName) return;

		const fontSize = Math.max(CONFIG.OBJECT_FONT_MIN, boxSize * CONFIG.OBJECT_FONT_RATIO);
		ctx.font = `bold ${fontSize}px ${CONFIG.FONT_SANS}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		ctx.strokeStyle = CONFIG.OBJECT_STROKE_COLOR;
		ctx.lineWidth = CONFIG.OBJECT_STROKE_WIDTH;
		ctx.strokeText(rawName, px, py);

		ctx.fillStyle = CONFIG.OBJECT_TEXT_COLOR;
		ctx.fillText(rawName, px, py);
	}

	/**
	 * 權威地塊物件繪製 (支援多重疊加、微縮小與階梯偏移，黑字白邊，精確 ISO 圓角菱形)
	 */
	static drawFloorObjects(ctx, isoMath, x, y, objArray, palette, zoom, currentProgress = 1.0) {
		if (!Array.isArray(objArray) || objArray.length === 0) return;

		const points = this.getTilePolyPoints(isoMath, x, y, currentProgress);
		const cx = (points[0].x + points[2].x) / 2;
		const cy = (points[0].y + points[2].y) / 2;
		const total = objArray.length;

		// 菱形半寬與半高（用於計算相對於地塊尺寸的步進）
		const halfW = Math.abs(points[1].x - points[3].x) / 2;
		const halfH = Math.abs(points[2].y - points[0].y) / 2;

		// 基礎尺寸：TILE_SIZE * 0.95，隨疊加數量等比縮小
		const baseScale = 0.95 - Math.max(0, total - 1) * 0.06;
		const scale = Math.max(0.5, baseScale);

		// 書頁偏移：左上(舊)→右下(新)，步進為菱形尺寸的 8%
		const stepRatio = 0.08;
		const stepX = halfW * stepRatio;
		const stepY = halfH * stepRatio;

		objArray.forEach((objId, idx) => {
			const item = palette[objId];
			if (!item || !item.color) return;

			const shiftX = (idx - (total - 1) / 2) * stepX;
			const shiftY = (idx - (total - 1) / 2) * stepY;
			const px = cx + shiftX;
			const py = cy + shiftY;

			const p0 = { x: px + (points[0].x - cx) * scale, y: py + (points[0].y - cy) * scale };
			const p1 = { x: px + (points[1].x - cx) * scale, y: py + (points[1].y - cy) * scale };
			const p2 = { x: px + (points[2].x - cx) * scale, y: py + (points[2].y - cy) * scale };
			const p3 = { x: px + (points[3].x - cx) * scale, y: py + (points[3].y - cy) * scale };

			ctx.save();
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2.5 / zoom;
			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;

			// 使用 2:1 ISO 仿射圓角多邊形算術
			this.drawIsoRoundedPolygon(ctx, [p0, p1, p2, p3], 0.15);
			ctx.fill();
			ctx.stroke();

			const sideLength = Math.hypot(p1.x - p0.x, p1.y - p0.y);
			this.drawObjectTextLabel(ctx, item.name, px, py, sideLength);

			ctx.restore();
		});
	}

	/**
	 * 權威 2D 牆面物件繪製 (斷線嵌入式，正方形圓角，去除死白背景)
	 */
	static drawWallObjects2D(ctx, isoMath, x, y, edge, objArray, palette, zoom, currentProgress = 0) {
		if (!Array.isArray(objArray) || objArray.length === 0) return;

		const normalized = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const nxGrid = normalized.x;
		const nyGrid = normalized.y;
		const e = normalized.edge;

		const p0 = isoMath.gridToScreen(nxGrid, nyGrid, currentProgress);
		const p1 = e === 'N' ? isoMath.gridToScreen(nxGrid + 1, nyGrid, currentProgress) : (e === 'W' ? isoMath.gridToScreen(nxGrid, nyGrid + 1, currentProgress) : null);
		if (!p0 || !p1) return;

		const cx = (p0.x + p1.x) / 2;
		const cy = (p0.y + p1.y) / 2;
		const total = objArray.length;

		// 基礎尺寸與偏移設定
		const baseScale = Math.max(0.6, 1.0 - Math.max(0, total - 1) * 0.1);
		const stepX = 5 * baseScale;
		const stepY = 4 * baseScale;

		objArray.forEach((objId, idx) => {
			const item = palette[objId];
			if (!item || !item.color) return;

			// 書頁偏移：左上(舊)→右下(新)，整體置中
			const shiftX = (idx - (total - 1) / 2) * stepX;
			const shiftY = (idx - (total - 1) / 2) * stepY;
			const px = cx + shiftX;
			const py = cy + shiftY;

			const boxSize = Math.max(16, (CONFIG.TILE_SIZE * 0.75)) * baseScale;

			ctx.save();
			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2 / zoom;

			ctx.beginPath();
			ctx.roundRect(px - boxSize / 2, py - boxSize / 2, boxSize, boxSize, 4);
			ctx.fill();
			ctx.stroke();

			this.drawObjectTextLabel(ctx, item.name, px, py, boxSize);

			ctx.restore();
		});
	}

	/**
	 * 權威 3D 牆面物件繪製 (立於牆面的正方形圓角面板，四邊長度完全相等呈正菱形)
	 */
	static drawWallObjects3D(ctx, isoMath, x, y, edge, objArray, palette, zoom, currentProgress = 1.0) {
		if (!Array.isArray(objArray) || objArray.length === 0) return;

		const quad = this.getWallQuad96Points(isoMath, x, y, edge, currentProgress);
		if (!quad) return;

		const [b0, b1, t1, t0] = quad;
		// 牆面中央偏上 (偏高 20%)
		const cx = (b0.x + b1.x + t1.x + t0.x) / 4;
		const cy = (b0.y + b1.y + t1.y + t0.y) / 4 - (CONFIG.TILE_SIZE * 0.15 * currentProgress);
		const total = objArray.length;

		// 底邊方向半向量 (平行於牆面)
		const dirX = (b1.x - b0.x) / 2;
		const dirY = (b1.y - b0.y) / 2;
		// 正方形面板高度 (與底邊半向量長度完全一致，保證四邊長度完全相等呈正菱形)
		const halfUp = Math.hypot(dirX, dirY);

		// 依疊加總數決定基礎縮放（疊加越多，全體縮越小）
		const baseScale = Math.max(0.4, 0.75 - Math.max(0, total - 1) * 0.06);
		const stepX = dirX * 0.15;
		const stepY = Math.abs(dirY) * 0.15;

		objArray.forEach((objId, idx) => {
			const item = palette[objId];
			if (!item || !item.color) return;

			// 從左上 (舊) 向右下 (新) 階梯位移，整體幾何中心精確對齊
			const shiftX = (idx - (total - 1) / 2) * stepX;
			const shiftY = (idx - (total - 1) / 2) * stepY;
			const px = cx + shiftX;
			const py = cy + shiftY;

			const dx = dirX * baseScale;
			const dy = dirY * baseScale;
			const dh = halfUp * baseScale;

			// 立於牆面的 4 個頂點 (順時針: 左下 -> 右下 -> 右上 -> 左上)
			const p0 = { x: px - dx, y: py - dy + dh };
			const p1 = { x: px + dx, y: py + dy + dh };
			const p2 = { x: px + dx, y: py + dy - dh };
			const p3 = { x: px - dx, y: py - dy - dh };

			ctx.save();
			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2.5 / zoom;

			// 繪製立於牆面的 3D 圓角面板
			this.drawIsoRoundedPolygon(ctx, [p0, p1, p2, p3], 0.15);
			ctx.fill();
			ctx.stroke();

			const boxSize = dh * 2;
			this.drawObjectTextLabel(ctx, item.name, px, py, boxSize);

			ctx.restore();
		});
	}

	/**
	 * 權威地塊物件 SVG 向量標籤生成管道 (SVG 匯出專用)
	 */
	static getFloorObjectsSvgElements(isoMath, x, y, z, objArray, palette) {
		if (!Array.isArray(objArray) || objArray.length === 0) return '';

		const points = this.getTilePolyPoints(isoMath, x, y, 1.0);
		const cx = (points[0].x + points[2].x) / 2;
		const cy = (points[0].y + points[2].y) / 2;
		const total = objArray.length;

		const halfW = Math.abs(points[1].x - points[3].x) / 2;
		const halfH = Math.abs(points[2].y - points[0].y) / 2;

		const baseScale = Math.max(0.5, 0.95 - Math.max(0, total - 1) * 0.06);
		const stepRatio = 0.08;
		const stepX = halfW * stepRatio;
		const stepY = halfH * stepRatio;

		let str = '';
		objArray.forEach((objId, idx) => {
			const item = palette[objId];
			if (!item || !item.color) return;

			const shiftX = (idx - (total - 1) / 2) * stepX;
			const shiftY = (idx - (total - 1) / 2) * stepY;
			const px = cx + shiftX;
			const py = cy + shiftY;

			const p0 = { x: px + (points[0].x - cx) * baseScale, y: py + (points[0].y - cy) * baseScale };
			const p1 = { x: px + (points[1].x - cx) * baseScale, y: py + (points[1].y - cy) * baseScale };
			const p2 = { x: px + (points[2].x - cx) * baseScale, y: py + (points[2].y - cy) * baseScale };
			const p3 = { x: px + (points[3].x - cx) * baseScale, y: py + (points[3].y - cy) * baseScale };

			const safeColorId = this._escapeXml(String(objId));
			const safeName = this._escapeXml((item.name || '').substring(0, 2));

			str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="floor-object" data-color-id="${safeColorId}" points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${CONFIG.OBJECT_PANEL_BG}" stroke="${item.color}" stroke-width="2.5" />\n`;
			if (safeName) {
				const sideLength = Math.hypot(p1.x - p0.x, p1.y - p0.y);
				const fontSize = Math.max(CONFIG.OBJECT_FONT_MIN, sideLength * CONFIG.OBJECT_FONT_RATIO);
				const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');
				str += `<text x="${px}" y="${py}" fill="${CONFIG.OBJECT_TEXT_COLOR}" stroke="${CONFIG.OBJECT_STROKE_COLOR}" stroke-width="${CONFIG.OBJECT_STROKE_WIDTH}" font-size="${fontSize}" font-family="${safeFont}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeName}</text>\n`;
			}
		});

		return str;
	}

	/**
	 * 權威牆面物件 SVG 向量標籤生成管道 (SVG 匯出專用)
	 */
	static getWallObjectsSvgElements(isoMath, x, y, z, edge, objArray, palette) {
		if (!Array.isArray(objArray) || objArray.length === 0) return '';

		const quad = this.getWallQuad96Points(isoMath, x, y, edge, 1.0);
		if (!quad) return '';

		const [b0, b1, t1, t0] = quad;
		const cx = (b0.x + b1.x + t1.x + t0.x) / 4;
		const cy = (b0.y + b1.y + t1.y + t0.y) / 4 - (CONFIG.TILE_SIZE * 0.15);
		const total = objArray.length;

		const dirX = (b1.x - b0.x) / 2;
		const dirY = (b1.y - b0.y) / 2;
		const halfUp = Math.hypot(dirX, dirY);

		const baseScale = Math.max(0.4, 0.75 - Math.max(0, total - 1) * 0.06);
		const stepX = dirX * 0.15;
		const stepY = Math.abs(dirY) * 0.15;

		let str = '';
		objArray.forEach((objId, idx) => {
			const item = palette[objId];
			if (!item || !item.color) return;

			const shiftX = (idx - (total - 1) / 2) * stepX;
			const shiftY = (idx - (total - 1) / 2) * stepY;
			const px = cx + shiftX;
			const py = cy + shiftY;

			const dx = dirX * baseScale;
			const dy = dirY * baseScale;
			const dh = halfUp * baseScale;

			const p0 = { x: px - dx, y: py - dy + dh };
			const p1 = { x: px + dx, y: py + dy + dh };
			const p2 = { x: px + dx, y: py + dy - dh };
			const p3 = { x: px - dx, y: py - dy - dh };

			const safeColorId = this._escapeXml(String(objId));
			const safeName = this._escapeXml((item.name || '').substring(0, 2));

			str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall-object" data-edge="${edge}" data-color-id="${safeColorId}" points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${CONFIG.OBJECT_PANEL_BG}" stroke="${item.color}" stroke-width="2.5" />\n`;
			if (safeName) {
				const boxSize = dh * 2;
				const fontSize = Math.max(CONFIG.OBJECT_FONT_MIN, boxSize * CONFIG.OBJECT_FONT_RATIO);
				const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');
				str += `<text x="${px}" y="${py}" fill="${CONFIG.OBJECT_TEXT_COLOR}" stroke="${CONFIG.OBJECT_STROKE_COLOR}" stroke-width="${CONFIG.OBJECT_STROKE_WIDTH}" font-size="${fontSize}" font-family="${safeFont}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeName}</text>\n`;
			}
		});

		return str;
	}

	static _escapeXml(unsafe) {
		return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
}
