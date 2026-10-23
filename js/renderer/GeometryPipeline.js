/**
 * GeometryPipeline.js - 統一幾何投影管線與樓層視覺偏移 (LevelVisualOffset)
 * 合流 CanvasRenderer 與 SvgExporter 的幾何頂點與多邊形運算邏輯
 *
 * 幾何架構原則：
 * - getTilePolyPoints / getWallQuad96Points 只接受純邏輯 (x, y) 座標，不再套用 Z 軸視覺偏移。
 * - Z 軸視覺偏移 (螢幕像素量) 由 calcZTranslate 計算，交給繪製端 (ctx.translate / SVG <g transform>) 統一套用。
 * - LevelVisualOffset 僅保留給 InputDispatcher 逆算滑鼠座標時使用。
 */

import { CONFIG } from '../core/Config.js';
import { Utils } from '../core/Utils.js';
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
		const mode = typeof otherFloorsMode === 'boolean' ? (otherFloorsMode ? 'ghost' : 'hidden') : otherFloorsMode;
		const zBuckets = new Map([[currentZ, []]]);

		if (tiles) {
			Object.entries(tiles).forEach(([key, tile]) => {
				const [xStr, yStr, zStr] = key.split(',');
				const z = parseInt(zStr, 10);
				if (!zBuckets.has(z)) zBuckets.set(z, []);
				zBuckets.get(z).push({ x: parseInt(xStr, 10), y: parseInt(yStr, 10), tile });
			});
		}

		const sortedZLevels = Array.from(zBuckets.keys()).sort((a, b) => a - b);
		const layers = [];

		sortedZLevels.forEach(z => {
			const isCurrent = z === currentZ;
			if (!isCurrent && mode === 'hidden') return;

			const dist = Math.abs(z - currentZ);
			let alpha = 1.0;
			let desatFactor = 0.0;

			if (!isCurrent && mode === 'ghost') {
				alpha = Math.max(0.05, CONFIG.GHOST_BASE_ALPHA * Math.pow(CONFIG.GHOST_ALPHA_DECAY, dist - 1));
				desatFactor = Math.min(0.95, 1.0 - Math.pow(CONFIG.GHOST_SATURATION_DECAY, dist));
			}

			const items = zBuckets.get(z);
			if (items.length > 1) {
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
		const { items } = layer;
		const { onFloor, onFloorObjects, onWall, onWallObjects } = callbacks;

		// Pass 1: 地塊多邊形
		if (onFloor) {
			items.forEach(({ x, y, tile }) => {
				let id = null;
				if (Array.isArray(tile.floor)) {
					id = tile.floor.find(cid => palette[cid] && !palette[cid].isZone && !palette[cid].isObject);
				} else {
					id = tile.floorColorId || (typeof tile.floor === 'string' ? tile.floor : null);
				}
				if (id && palette[id] && !palette[id].isZone && !palette[id].isObject) {
					onFloor(x, y, id, tile);
				}
			});
		}

		// Pass 1.5: 地塊物件 (Floor Objects)
		if (onFloorObjects) {
			items.forEach(({ x, y, tile }) => {
				let objs = null;
				if (Array.isArray(tile.floor)) {
					objs = tile.floor.filter(cid => palette[cid]?.isObject);
				} else if (Array.isArray(tile.floorObjects)) {
					objs = tile.floorObjects;
				}
				if (objs && objs.length > 0) {
					onFloorObjects(x, y, objs, tile);
				}
			});
		}

		// Pass 2: 牆面面片與邊線
		if (onWall) {
			items.forEach(({ x, y, tile }) => {
				['N', 'W'].forEach(edge => {
					let id = null;
					if (Array.isArray(tile[edge])) {
						id = tile[edge].find(cid => palette[cid] && !palette[cid].isZone && !palette[cid].isObject);
					} else if (tile.walls?.[edge]) {
						id = tile.walls[edge];
					}
					if (typeof id === 'string' && palette[id] && !palette[id].isZone && !palette[id].isObject) {
						onWall(x, y, edge, id, tile);
					}
				});
			});
		}

		// Pass 2.5: 牆面物件 (Wall Objects)
		if (onWallObjects) {
			items.forEach(({ x, y, tile }) => {
				['N', 'W'].forEach(edge => {
					let objs = null;
					if (Array.isArray(tile[edge])) {
						objs = tile[edge].filter(cid => palette[cid]?.isObject);
					} else if (Array.isArray(tile.wallObjects?.[edge])) {
						objs = tile.wallObjects[edge];
					}
					if (objs && objs.length > 0) {
						onWallObjects(x, y, edge, objs, tile);
					}
				});
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

		// 目前 Z 樓層中心為畫布對齊中心點
		const centerPos = isoMath.gridToScreen(w / 2, h / 2, currentProgress);
		const { dx: currentDx, dy: currentDy } = calcZTranslate(currentZ, currentProgress);
		const targetX = centerPos.x + currentDx;
		const targetY = centerPos.y + currentDy;

		let minZ = Math.min(0, currentZ);
		let maxZ = Math.max(0, currentZ);
		if (scheme.tiles) {
			Object.keys(scheme.tiles).forEach(k => {
				const zVal = parseInt(k.split(',')[2], 10);
				if (!isNaN(zVal)) {
					if (zVal < minZ) minZ = zVal;
					if (zVal > maxZ) maxZ = zVal;
				}
			});
		}

		const p = Math.max(0, padding);
		const wallHeight = CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET * currentProgress;
		const corners = [[-p, -p], [w + p, -p], [w + p, h + p], [-p, h + p]];

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		[minZ, maxZ].forEach(z => {
			const { dx, dy } = calcZTranslate(z, currentProgress);
			corners.forEach(([gx, gy]) => {
				const pt = isoMath.gridToScreen(gx, gy, currentProgress);
				const px = pt.x + dx;
				const py = pt.y + dy;
				if (px < minX) minX = px;
				if (px > maxX) maxX = px;
				if (py < minY) minY = py;
				if (py > maxY) maxY = py;

				const wallTopY = py - wallHeight;
				if (wallTopY < minY) minY = wallTopY;
			});
		});

		const boundsW = Math.max(10, maxX - minX);
		const boundsH = Math.max(10, maxY - minY);
		const effectiveWidth = Math.max(10, Math.max(10, viewportWidth || 0) - Math.max(0, sidebarWidth || 0));
		const safeVpH = Math.max(10, viewportHeight || 0);

		const fitZoom = Math.max(0.15, Math.min(4.0, Math.min(effectiveWidth / boundsW, safeVpH / boundsH)));
		const cameraX = (effectiveWidth / 2) - targetX * fitZoom;
		const cameraY = (safeVpH / 2) - targetY * fitZoom;

		return { zoom: fitZoom, cameraX, cameraY, minX, minY, maxX, maxY };
	}

	// ==========================================
	// 純幾何計算管道 (Pure Geometry Extractors)
	// ==========================================

	/**
	 * 計算地塊物件的階梯堆疊幾何 (支援微縮小與階梯偏移)
	 * @returns {Array<{ points: Array<{x:number, y:number}>, cx: number, cy: number, size: number }>}
	 */
	static getFloorObjectGeometries(isoMath, x, y, count, progress = 1.0) {
		if (!count) return [];
		const pts = this.getTilePolyPoints(isoMath, x, y, progress);
		const cx = (pts[0].x + pts[2].x) / 2;
		const cy = (pts[0].y + pts[2].y) / 2;
		const halfW = Math.abs(pts[1].x - pts[3].x) / 2;
		const halfH = Math.abs(pts[2].y - pts[0].y) / 2;
		const scale = Math.max(0.5, 0.95 - Math.max(0, count - 1) * 0.06);
		const stepX = halfW * 0.08;
		const stepY = halfH * 0.08;

		const items = [];
		for (let idx = 0; idx < count; idx++) {
			const shift = idx - (count - 1) / 2;
			const px = cx + shift * stepX;
			const py = cy + shift * stepY;
			const p0 = { x: px + (pts[0].x - cx) * scale, y: py + (pts[0].y - cy) * scale };
			const p1 = { x: px + (pts[1].x - cx) * scale, y: py + (pts[1].y - cy) * scale };
			const p2 = { x: px + (pts[2].x - cx) * scale, y: py + (pts[2].y - cy) * scale };
			const p3 = { x: px + (pts[3].x - cx) * scale, y: py + (pts[3].y - cy) * scale };
			items.push({
				points: [p0, p1, p2, p3],
				cx: px,
				cy: py,
				size: Math.hypot(p1.x - p0.x, p1.y - p0.y),
			});
		}
		return items;
	}

	/**
	 * 計算牆面物件的堆疊幾何 (2D 正方形圓角 / 3D 菱形立體面片)
	 * @param {import("./IsoMath.js").IsoMath} isoMath
	 * @param {number} x
	 * @param {number} y
	 * @param {'N'|'W'} edge
	 * @param {number} count
	 * @param {number} [progress=1.0]
	 * @param {boolean} [is3D=true] 是否依立體牆面抬升繪製 (若為 false 則貼平於地面邊線)
	 * @returns {Array<{ is2D: boolean, points?: Array<{x:number, y:number}>, cx: number, cy: number, size: number }>}
	 */
	static getWallObjectGeometries(isoMath, x, y, edge, count, progress = 1.0, is3D = true) {
		if (!count) return [];
		if (!is3D || progress === 0) {
			const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
			const p0 = isoMath.gridToScreen(norm.x, norm.y, progress);
			const p1 = norm.edge === 'N' ? isoMath.gridToScreen(norm.x + 1, norm.y, progress) : isoMath.gridToScreen(norm.x, norm.y + 1, progress);
			if (!p0 || !p1) return [];
			const cx = (p0.x + p1.x) / 2;
			const cy = (p0.y + p1.y) / 2;
			const dirX = p1.x - p0.x;
			const dirY = p1.y - p0.y;
			const len = Math.hypot(dirX, dirY);
			const scale = Math.max(0.6, 1.0 - Math.max(0, count - 1) * 0.1);
			const boxSize = Math.max(16, CONFIG.TILE_SIZE * 0.75) * scale;
			const stepX = (len > 0 ? dirX / len : 0) * 6 * scale;
			const stepY = (len > 0 ? dirY / len : 0) * 6 * scale;
			const items = [];
			for (let idx = 0; idx < count; idx++) {
				const shift = idx - (count - 1) / 2;
				items.push({
					is2D: true,
					cx: cx + shift * stepX,
					cy: cy + shift * stepY,
					size: boxSize,
				});
			}
			return items;
		}

		const quad = this.getWallQuad96Points(isoMath, x, y, edge, progress);
		if (!quad) return [];
		const [b0, b1, t1, t0] = quad;
		const cx = (b0.x + b1.x + t1.x + t0.x) / 4;
		const cy = (b0.y + b1.y + t1.y + t0.y) / 4 - (CONFIG.TILE_SIZE * 0.15 * progress);
		const dirX = (b1.x - b0.x) / 2;
		const dirY = (b1.y - b0.y) / 2;
		const halfUp = Math.hypot(dirX, dirY);
		const scale = Math.max(0.4, 0.75 - Math.max(0, count - 1) * 0.06);
		const stepX = dirX * 0.15;
		const stepY = Math.abs(dirY) * 0.15;
		const dx = dirX * scale;
		const dy = dirY * scale;
		const dh = halfUp * scale;

		const items = [];
		for (let idx = 0; idx < count; idx++) {
			const shift = idx - (count - 1) / 2;
			const px = cx + shift * stepX;
			const py = cy + shift * stepY;
			items.push({
				is2D: false,
				points: [
					{ x: px - dx, y: py - dy + dh },
					{ x: px + dx, y: py + dy + dh },
					{ x: px + dx, y: py + dy - dh },
					{ x: px - dx, y: py - dy - dh },
				],
				cx: px,
				cy: py,
				size: dh * 2,
			});
		}
		return items;
	}

	/**
	/**
	 * 計算單一邊線標籤在空間中的透視懸空帶狀多邊形幾何
	 */
	static calcWallBandGeometry(isoMath, x, y, edge, progress) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const b0 = isoMath.gridToScreen(norm.x, norm.y, progress);
		const b1 = norm.edge === 'N'
			? isoMath.gridToScreen(norm.x + 1, norm.y, progress)
			: isoMath.gridToScreen(norm.x, norm.y + 1, progress);
		if (!b0 || !b1) return null;

		const dx = b1.x - b0.x;
		const dy = b1.y - b0.y;
		const len = Math.hypot(dx, dy);
		const nx = len === 0 ? 0 : -dy / len;
		const ny = len === 0 ? 0 : dx / len;

		// 2D 橫向半寬 (在 2D 下維持 6px 帶狀面，3D 動畫過渡時平滑收合)
		const latOffset = 6 * (1 - progress);
		// 3D 懸空垂直高度 (在牆高中段 25%~75% 處懸空，厚度 48px，離地 24px)
		const wallHeight = CONFIG.TILE_SIZE * CONFIG.Z_VISUAL_OFFSET * progress;
		const dyBottom = -wallHeight * 0.25;
		const dyTop = -wallHeight * 0.75;

		const pb0 = { x: b0.x + nx * latOffset, y: b0.y + ny * latOffset + dyBottom };
		const pb1 = { x: b1.x + nx * latOffset, y: b1.y + ny * latOffset + dyBottom };
		const pt1 = { x: b1.x - nx * latOffset, y: b1.y - ny * latOffset + dyTop };
		const pt0 = { x: b0.x - nx * latOffset, y: b0.y - ny * latOffset + dyTop };

		return {
			norm,
			polygon: [pb0, pb1, pt1, pt0],
			bottomEdge: { p0: pb0, p1: pb1 },
			topEdge: { p0: pt0, p1: pt1 },
			v0Edge: { p0: pb0, p1: pt0 },
			v1Edge: { p0: pb1, p1: pt1 },
			center: { x: (pb0.x + pb1.x + pt1.x + pt0.x) / 4, y: (pb0.y + pb1.y + pt1.y + pt0.y) / 4 },
			v0Key: `${norm.x},${norm.y}`,
			v1Key: norm.edge === 'N' ? `${norm.x + 1},${norm.y}` : `${norm.x},${norm.y + 1}`,
		};
	}

	/**
	 * 萃取區域標籤的幾何資料 (Canvas 渲染與 SVG 匯出共用)
	 * 支援地面多邊形與外框虛線，以及邊線區域之 3D 透視懸空帶狀多邊形與相鄰連通外框
	 */
	static getZoneGeometries(isoMath, layer, palette, progress = 1.0) {
		const zones = this._collectZones(layer, palette);
		if (!zones || zones.size === 0) return [];

		const result = [];
		zones.forEach(({ id, item, cells, islands, edgeIslands }) => {
			const polygons = cells.map(({ x, y }) => this.getTilePolyPoints(isoMath, x, y, progress));
			const borderEdges = [];
			this._forEachZoneBorderEdge(cells, (x0, y0, x1, y1) => {
				borderEdges.push({
					p0: isoMath.gridToScreen(x0, y0, progress),
					p1: isoMath.gridToScreen(x1, y1, progress),
				});
			});
			const labels = islands.map(({ centerCell }) => {
				const pos = isoMath.gridToScreen(centerCell.x + 0.5, centerCell.y + 0.5, progress);
				return { text: item.name, x: pos.x, y: pos.y };
			});

			const wallPolygons = [];
			const wallBorderEdges = [];
			const wallLabels = [];

			(edgeIslands || []).forEach(island => {
				const bands = island.map(e => this.calcWallBandGeometry(isoMath, e.x, e.y, e.edge, progress)).filter(Boolean);
				if (bands.length === 0) return;

				// 收集立面多邊形
				bands.forEach(b => wallPolygons.push(b.polygon));

				// 統計頂點度數以過濾內部接縫線段
				const vertexCounts = new Map();
				bands.forEach(b => {
					vertexCounts.set(b.v0Key, (vertexCounts.get(b.v0Key) || 0) + 1);
					vertexCounts.set(b.v1Key, (vertexCounts.get(b.v1Key) || 0) + 1);
				});

				// 外周邊界線段 (頂邊、底邊，以及無相鄰邊線的開放末端)
				bands.forEach(b => {
					wallBorderEdges.push(b.topEdge);
					wallBorderEdges.push(b.bottomEdge);
					if (vertexCounts.get(b.v0Key) === 1) wallBorderEdges.push(b.v0Edge);
					if (vertexCounts.get(b.v1Key) === 1) wallBorderEdges.push(b.v1Edge);
				});

				// 連通島嶼質心文字位置
				const avg = bands.reduce((acc, b) => ({ x: acc.x + b.center.x, y: acc.y + b.center.y }), { x: 0, y: 0 });
				const cx = avg.x / bands.length;
				const cy = avg.y / bands.length;
				let bestCenter = bands[0].center;
				let minDist = Infinity;
				for (const b of bands) {
					const dist = (b.center.x - cx) ** 2 + (b.center.y - cy) ** 2;
					if (dist < minDist) {
						minDist = dist;
						bestCenter = b.center;
					}
				}
				wallLabels.push({ text: item.name, x: bestCenter.x, y: bestCenter.y });
			});

			result.push({ id, item, cells, polygons, borderEdges, labels, wallPolygons, wallBorderEdges, wallLabels });
		});
		return result;
	}

	static _collectZones(layer, palette) {
		const { items } = layer;
		if (!items || items.length === 0) return null;
		const zones = new Map();

		const getOrCreateZone = (zoneId) => {
			if (!zones.has(zoneId)) {
				zones.set(zoneId, { id: zoneId, item: palette[zoneId], cells: [], wallEdges: [] });
			}
			return zones.get(zoneId);
		};

		items.forEach(({ x, y, tile }) => {
			// 地面標籤 (支援新三槽位 floor 與舊格式向下相容)
			let floorZoneIds = [];
			if (Array.isArray(tile.floor)) {
				floorZoneIds = tile.floor.filter(id => palette[id]?.isZone);
			} else {
				floorZoneIds = Array.isArray(tile.zoneIds)
					? tile.zoneIds
					: (tile.zoneId ? [tile.zoneId] : (typeof tile.floor === 'string' && palette[tile.floor]?.isZone ? [tile.floor] : []));
			}
			floorZoneIds.forEach(floorZoneId => {
				if (floorZoneId && palette[floorZoneId]) {
					getOrCreateZone(floorZoneId).cells.push({ x, y });
				}
			});

			// 邊線標籤 (支援新三槽位 N/W 與舊格式向下相容)
			['N', 'W'].forEach(edge => {
				let edgeZoneIds = [];
				if (Array.isArray(tile[edge])) {
					edgeZoneIds = tile[edge].filter(id => palette[id]?.isZone);
				} else if (tile.wallZones?.[edge]) {
					const val = tile.wallZones[edge];
					edgeZoneIds = Array.isArray(val) ? val : [val];
				} else if (tile.walls?.[edge]) {
					const val = tile.walls[edge];
					edgeZoneIds = Array.isArray(val) ? val : [val];
				}
				edgeZoneIds.forEach(colorId => {
					if (colorId && palette[colorId]?.isZone) {
						getOrCreateZone(colorId).wallEdges.push({ x, y, edge });
					}
				});
			});
		});

		if (zones.size === 0) return null;
		zones.forEach(zone => {
			if (zone.cells.length > 0) {
				zone.islands = this._partitionIslands(zone.cells);
			} else {
				zone.islands = [];
			}

			if (zone.wallEdges.length > 0) {
				const edgeKeySet = new Set();
				const uniqueEdges = [];
				zone.wallEdges.forEach(e => {
					const norm = BorderEdgeNormalizer.normalizeEdge(e.x, e.y, e.edge);
					const key = `${norm.edge},${norm.x},${norm.y}`;
					if (!edgeKeySet.has(key)) {
						edgeKeySet.add(key);
						uniqueEdges.push(norm);
					}
				});
				zone.wallEdges = uniqueEdges;
				zone.edgeIslands = this._partitionEdgeIslands(uniqueEdges);
			} else {
				zone.edgeIslands = [];
			}
		});
		return zones;
	}

	static _partitionIslands(cells) {
		const unvisited = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
		const islands = [];

		while (unvisited.size > 0) {
			const [firstKey, seed] = unvisited.entries().next().value;
			unvisited.delete(firstKey);
			const islandCells = [];
			const queue = [seed];

			while (queue.length > 0) {
				const curr = queue.pop();
				islandCells.push(curr);
				const neighbors = [
					`${curr.x + 1},${curr.y}`,
					`${curr.x - 1},${curr.y}`,
					`${curr.x},${curr.y + 1}`,
					`${curr.x},${curr.y - 1}`,
				];
				neighbors.forEach(nKey => {
					if (unvisited.has(nKey)) {
						queue.push(unvisited.get(nKey));
						unvisited.delete(nKey);
					}
				});
			}

			const sum = islandCells.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
			const cx = sum.x / islandCells.length;
			const cy = sum.y / islandCells.length;
			let bestCell = islandCells[0];
			let minDist = Infinity;
			for (const c of islandCells) {
				const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
				if (d < minDist) {
					minDist = d;
					bestCell = c;
				}
			}
			islands.push({ cells: islandCells, centerCell: bestCell });
		}
		return islands;
	}

	static _partitionEdgeIslands(edges) {
		if (!edges || edges.length === 0) return [];

		const vertexToEdges = new Map();
		const getEndpoints = (e) => (
			e.edge === 'N'
				? [`${e.x},${e.y}`, `${e.x + 1},${e.y}`]
				: [`${e.x},${e.y}`, `${e.x},${e.y + 1}`]
		);

		edges.forEach((e, idx) => {
			const [v0, v1] = getEndpoints(e);
			if (!vertexToEdges.has(v0)) vertexToEdges.set(v0, []);
			if (!vertexToEdges.has(v1)) vertexToEdges.set(v1, []);
			vertexToEdges.get(v0).push(idx);
			vertexToEdges.get(v1).push(idx);
		});

		const visited = new Set();
		const islands = [];

		for (let i = 0; i < edges.length; i++) {
			if (visited.has(i)) continue;

			const island = [];
			const queue = [i];
			visited.add(i);

			while (queue.length > 0) {
				const currIdx = queue.pop();
				const currEdge = edges[currIdx];
				island.push(currEdge);

				const [v0, v1] = getEndpoints(currEdge);
				[v0, v1].forEach(v => {
					const neighbors = vertexToEdges.get(v) || [];
					neighbors.forEach(nIdx => {
						if (!visited.has(nIdx)) {
							visited.add(nIdx);
							queue.push(nIdx);
						}
					});
				});
			}

			islands.push(island);
		}

		return islands;
	}

	static _forEachZoneBorderEdge(cells, onEdge) {
		const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
		cells.forEach(({ x, y }) => {
			if (!cellSet.has(`${x},${y - 1}`)) onEdge(x, y, x + 1, y);
			if (!cellSet.has(`${x - 1},${y}`)) onEdge(x, y, x, y + 1);
			if (!cellSet.has(`${x},${y + 1}`)) onEdge(x, y + 1, x + 1, y + 1);
			if (!cellSet.has(`${x + 1},${y}`)) onEdge(x + 1, y, x + 1, y + 1);
		});
	}

	// ==========================================
	// 基礎幾何繪製工具
	// ==========================================

	/**
	 * 在 Canvas 上繪製 2:1 ISO 菱形/多邊形的切弧圓角 (仿射切線圓角算術)
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
			if (i === 0) ctx.moveTo(inX, inY);
			else ctx.lineTo(inX, inY);
			ctx.quadraticCurveTo(curr.x, curr.y, outX, outY);
		}
		ctx.closePath();
	}

	/**
	 * 繪製置中徽章文字 (黑邊白字，全模式共用 CONFIG.OBJECT_* 常數配置)
	 */
	static drawObjectTextLabel(ctx, text, px, py, boxSize) {
		const rawName = String(text || '').substring(0, 2);
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

	// ==========================================
	// Canvas 繪圖管道
	// ==========================================

	/**
	 * 地塊多邊形渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
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
	 * 2D 正交牆線渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawWallLine2D(ctx, isoMath, x, y, edge, colorHex, zoom, currentProgress = 0) {
		const normalized = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const p0 = isoMath.gridToScreen(normalized.x, normalized.y, currentProgress);
		const p1 = normalized.edge === 'N'
			? isoMath.gridToScreen(normalized.x + 1, normalized.y, currentProgress)
			: (normalized.edge === 'W' ? isoMath.gridToScreen(normalized.x, normalized.y + 1, currentProgress) : null);
		if (!p0 || !p1) return;

		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const len = Math.hypot(dx, dy);
		if (len === 0) return;

		ctx.save();
		const nx = -dy / len;
		const ny = dx / len;
		const offset = 2.2 / zoom;

		// 1. 長邊兩側深色襯底線 (短邊平口不封線)
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
		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * 3D 菱形立體牆面渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static drawWallQuad96px(ctx, isoMath, x, y, edge, colorHex, zoom, currentProgress = 1.0, fillAlpha = CONFIG.WALL_FILL_ALPHA) {
		const quad = this.getWallQuad96Points(isoMath, x, y, edge, currentProgress);
		if (!quad) return;
		const [b0, b1, t1, t0] = quad;
		const savedAlpha = ctx.globalAlpha;

		ctx.save();
		ctx.globalAlpha = savedAlpha * fillAlpha;
		ctx.fillStyle = colorHex;
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.lineTo(t0.x, t0.y);
		ctx.closePath();
		ctx.fill();

		// 動畫過渡期間：僅做基礎外框描邊
		if (currentProgress < 1.0) {
			ctx.strokeStyle = colorHex;
			ctx.lineWidth = 1.5 / zoom;
			ctx.stroke();
			ctx.restore();
			return;
		}

		// 平行向量 Shading 光影遮罩
		const grad = ctx.createLinearGradient((t0.x + t1.x) / 2, (t0.y + t1.y) / 2, (b0.x + b1.x) / 2, (b0.y + b1.y) / 2);
		grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
		grad.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
		ctx.fillStyle = grad;
		ctx.fill();

		// 主輪廓線
		ctx.globalAlpha = savedAlpha * fillAlpha * 1.5;
		ctx.strokeStyle = colorHex;
		ctx.lineWidth = 1.5 / zoom;
		ctx.stroke();

		// 牆頂高光與牆底暗邊
		ctx.globalAlpha = savedAlpha * 0.75;
		ctx.strokeStyle = '#ffffff';
		ctx.beginPath();
		ctx.moveTo(t0.x, t0.y);
		ctx.lineTo(t1.x, t1.y);
		ctx.stroke();

		ctx.globalAlpha = savedAlpha * 0.6;
		ctx.strokeStyle = '#000000';
		ctx.beginPath();
		ctx.moveTo(b0.x, b0.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * 地塊物件繪製 (支援多重疊加、微縮小與階梯偏移，黑字白邊，精確 ISO 圓角菱形)
	 */
	static drawFloorObjects(ctx, isoMath, x, y, objArray, palette, zoom, currentProgress = 1.0) {
		const geometries = this.getFloorObjectGeometries(isoMath, x, y, objArray?.length || 0, currentProgress);
		if (geometries.length === 0) return;

		ctx.save();
		geometries.forEach(({ points, cx, cy, size }, idx) => {
			const item = palette[objArray[idx]];
			if (!item || !item.color) return;

			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2.5 / zoom;
			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;
			this.drawIsoRoundedPolygon(ctx, points, 0.15);
			ctx.fill();
			ctx.stroke();
			this.drawObjectTextLabel(ctx, item.name, cx, cy, size);
		});
		ctx.restore();
	}

	/**
	 * 2D 牆面物件繪製 (斷線嵌入式，正方形圓角，去除死白背景)
	 */
	static drawWallObjects2D(ctx, isoMath, x, y, edge, objArray, palette, zoom, currentProgress = 0) {
		const geometries = this.getWallObjectGeometries(isoMath, x, y, edge, objArray?.length || 0, currentProgress, false);
		if (geometries.length === 0) return;

		ctx.save();
		geometries.forEach(({ cx, cy, size }, idx) => {
			const item = palette[objArray[idx]];
			if (!item || !item.color) return;

			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2 / zoom;
			ctx.beginPath();
			ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 4);
			ctx.fill();
			ctx.stroke();
			this.drawObjectTextLabel(ctx, item.name, cx, cy, size);
		});
		ctx.restore();
	}

	/**
	 * 3D 牆面物件繪製 (立於牆面的正方形圓角面板，四邊長度完全相等呈正菱形)
	 */
	static drawWallObjects3D(ctx, isoMath, x, y, edge, objArray, palette, zoom, currentProgress = 1.0) {
		const geometries = this.getWallObjectGeometries(isoMath, x, y, edge, objArray?.length || 0, currentProgress);
		if (geometries.length === 0) return;

		ctx.save();
		geometries.forEach(({ points, cx, cy, size }, idx) => {
			const item = palette[objArray[idx]];
			if (!item || !item.color) return;

			ctx.fillStyle = CONFIG.OBJECT_PANEL_BG;
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 2.5 / zoom;
			this.drawIsoRoundedPolygon(ctx, points, 0.15);
			ctx.fill();
			ctx.stroke();
			this.drawObjectTextLabel(ctx, item.name, cx, cy, size);
		});
		ctx.restore();
	}

	/**
	 * 區域標籤渲染管道 (Canvas 2D 畫布與 PNG 匯出共用)
	 * 包含邊界內向光暈 (Inset Glow)、外周虛線邊界與質心最近實體格投影法文字
	 */
	static drawZones(ctx, isoMath, layer, palette, zoom, currentProgress = 1.0) {
		const zoneGeometries = this.getZoneGeometries(isoMath, layer, palette, currentProgress);
		if (zoneGeometries.length === 0) return;

		zoneGeometries.forEach(({ item, polygons, borderEdges, labels, wallPolygons, wallBorderEdges, wallLabels }) => {
			// 1. 地面標籤光暈與外框
			if (polygons.length > 0) {
				ctx.save();
				ctx.beginPath();
				polygons.forEach(pts => {
					ctx.moveTo(pts[0].x, pts[0].y);
					ctx.lineTo(pts[1].x, pts[1].y);
					ctx.lineTo(pts[2].x, pts[2].y);
					ctx.lineTo(pts[3].x, pts[3].y);
					ctx.closePath();
				});

				if (CONFIG.ZONE_CENTER_ALPHA > 0) {
					ctx.globalAlpha = CONFIG.ZONE_CENTER_ALPHA;
					ctx.fillStyle = item.color;
					ctx.fill();
				}
				ctx.clip();

				if (CONFIG.ZONE_GLOW_WIDTH > 0 && CONFIG.ZONE_GLOW_ALPHA > 0) {
					const glowW = CONFIG.ZONE_GLOW_WIDTH / zoom;
					const steps = [
						{ wRatio: 2.0, aRatio: 0.25 },
						{ wRatio: 1.2, aRatio: 0.35 },
						{ wRatio: 0.5, aRatio: 0.40 },
					];
					ctx.strokeStyle = item.color;
					ctx.lineCap = 'round';
					ctx.lineJoin = 'round';
					steps.forEach(({ wRatio, aRatio }) => {
						ctx.lineWidth = glowW * wRatio;
						ctx.globalAlpha = CONFIG.ZONE_GLOW_ALPHA * aRatio;
						ctx.beginPath();
						borderEdges.forEach(({ p0, p1 }) => {
							ctx.moveTo(p0.x, p0.y);
							ctx.lineTo(p1.x, p1.y);
						});
						ctx.stroke();
					});
				}
				ctx.restore();

				ctx.save();
				ctx.lineWidth = Math.max(1, CONFIG.ZONE_BORDER_WIDTH / zoom);
				ctx.setLineDash(CONFIG.ZONE_BORDER_DASH.map(d => Math.max(1, d / zoom)));
				ctx.strokeStyle = item.color;
				ctx.beginPath();
				borderEdges.forEach(({ p0, p1 }) => {
					ctx.moveTo(p0.x, p0.y);
					ctx.lineTo(p1.x, p1.y);
				});
				ctx.stroke();
				ctx.restore();
			}

			// 2. 邊線標籤 (3D 透視懸空立面：中心填色、內向光暈與外周虛線外框)
			if (wallPolygons && wallPolygons.length > 0) {
				ctx.save();
				ctx.beginPath();
				wallPolygons.forEach(pts => {
					ctx.moveTo(pts[0].x, pts[0].y);
					ctx.lineTo(pts[1].x, pts[1].y);
					ctx.lineTo(pts[2].x, pts[2].y);
					ctx.lineTo(pts[3].x, pts[3].y);
					ctx.closePath();
				});

				if (CONFIG.ZONE_CENTER_ALPHA > 0) {
					ctx.globalAlpha = CONFIG.ZONE_CENTER_ALPHA;
					ctx.fillStyle = item.color;
					ctx.fill();
				}
				ctx.clip();

				if (CONFIG.ZONE_GLOW_WIDTH > 0 && CONFIG.ZONE_GLOW_ALPHA > 0) {
					const glowW = CONFIG.ZONE_GLOW_WIDTH / zoom;
					const steps = [
						{ wRatio: 2.0, aRatio: 0.25 },
						{ wRatio: 1.2, aRatio: 0.35 },
						{ wRatio: 0.5, aRatio: 0.40 },
					];
					ctx.strokeStyle = item.color;
					ctx.lineCap = 'round';
					ctx.lineJoin = 'round';
					steps.forEach(({ wRatio, aRatio }) => {
						ctx.lineWidth = glowW * wRatio;
						ctx.globalAlpha = CONFIG.ZONE_GLOW_ALPHA * aRatio;
						ctx.beginPath();
						wallBorderEdges.forEach(({ p0, p1 }) => {
							ctx.moveTo(p0.x, p0.y);
							ctx.lineTo(p1.x, p1.y);
						});
						ctx.stroke();
					});
				}
				ctx.restore();

				ctx.save();
				ctx.lineWidth = Math.max(1, CONFIG.ZONE_BORDER_WIDTH / zoom);
				ctx.setLineDash(CONFIG.ZONE_BORDER_DASH.map(d => Math.max(1, d / zoom)));
				ctx.strokeStyle = item.color;
				ctx.lineCap = 'round';
				ctx.beginPath();
				wallBorderEdges.forEach(({ p0, p1 }) => {
					ctx.moveTo(p0.x, p0.y);
					ctx.lineTo(p1.x, p1.y);
				});
				ctx.stroke();
				ctx.restore();
			}

			// 3. 文字置中 (地面島嶼 + 邊線連通島嶼)
			if (layer.isCurrent) {
				const allLabels = [...(labels || []), ...(wallLabels || [])];
				if (allLabels.length > 0) {
					const fontSize = Math.max(CONFIG.ZONE_FONT_MIN, 13 / zoom);
					ctx.save();
					ctx.font = `bold ${fontSize}px ${CONFIG.FONT_SANS}`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillStyle = '#ffffff';
					ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
					ctx.shadowBlur = 4;
					allLabels.forEach(({ text, x, y }) => ctx.fillText(text, x, y));
					ctx.restore();
				}
			}
		});
	}

	// ==========================================
	// SVG 向量標籤生成管道 (SVG 匯出專用)
	// ==========================================

	/**
	 * 3D 牆體 SVG 向量標籤生成管道
	 */
	static getWallSvgElements(isoMath, x, y, z, edge, colorId, color) {
		const quad = this.getWallQuad96Points(isoMath, x, y, edge, 1.0);
		if (!quad) return '';
		const [b0, b1, t1, t0] = quad;
		return `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall" data-edge="${edge}" data-color-id="${colorId}" points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" stroke="${color}" stroke-opacity="0.675" stroke-width="1.5" />\n` +
			`<polygon points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="url(#svg-wall-shading)" fill-opacity="${CONFIG.WALL_FILL_ALPHA}" />\n` +
			`<line x1="${t0.x}" y1="${t0.y}" x2="${t1.x}" y2="${t1.y}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1.5" />\n` +
			`<line x1="${b0.x}" y1="${b0.y}" x2="${b1.x}" y2="${b1.y}" stroke="#000000" stroke-opacity="0.6" stroke-width="1.5" />\n`;
	}

	/**
	 * 地塊物件 SVG 向量標籤生成管道
	 */
	static getFloorObjectsSvgElements(isoMath, x, y, z, objArray, palette) {
		const geometries = this.getFloorObjectGeometries(isoMath, x, y, objArray?.length || 0, 1.0);
		if (geometries.length === 0) return '';
		let str = '';
		geometries.forEach(({ points, cx, cy, size }, idx) => {
			const objId = objArray[idx];
			const item = palette[objId];
			if (!item || !item.color) return;
			const pts = points.map(p => `${p.x},${p.y}`).join(' ');
			const safeColorId = Utils.escapeXml(String(objId));
			str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="floor-object" data-color-id="${safeColorId}" points="${pts}" fill="${CONFIG.OBJECT_PANEL_BG}" stroke="${item.color}" stroke-width="2.5" />\n`;
			str += this._formatObjectSvgText(cx, cy, item.name, size);
		});
		return str;
	}

	/**
	 * 牆面物件 SVG 向量標籤生成管道
	 */
	static getWallObjectsSvgElements(isoMath, x, y, z, edge, objArray, palette, is3D = true) {
		const geometries = this.getWallObjectGeometries(isoMath, x, y, edge, objArray?.length || 0, 1.0, is3D);
		if (geometries.length === 0) return '';
		let str = '';
		geometries.forEach(({ is2D, points, cx, cy, size }, idx) => {
			const objId = objArray[idx];
			const item = palette[objId];
			if (!item || !item.color) return;
			const safeColorId = Utils.escapeXml(String(objId));
			if (is2D || !points) {
				str += `<rect data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall-object" data-edge="${edge}" data-color-id="${safeColorId}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="4" ry="4" fill="${CONFIG.OBJECT_PANEL_BG}" stroke="${item.color}" stroke-width="2" />\n`;
			} else {
				const pts = points.map(p => `${p.x},${p.y}`).join(' ');
				str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall-object" data-edge="${edge}" data-color-id="${safeColorId}" points="${pts}" fill="${CONFIG.OBJECT_PANEL_BG}" stroke="${item.color}" stroke-width="2.5" />\n`;
			}
			str += this._formatObjectSvgText(cx, cy, item.name, size);
		});
		return str;
	}

	/**
	 * 區域與標籤 SVG 向量標籤生成管道
	 */
	static getZoneSvgElements(isoMath, layer, palette) {
		const zoneGeometries = this.getZoneGeometries(isoMath, layer, palette, 1.0);
		if (zoneGeometries.length === 0) return '';
		const { isCurrent, z } = layer;
		const dashArray = CONFIG.ZONE_BORDER_DASH.join(',');
		let str = '';

		zoneGeometries.forEach(({ id, item, cells, polygons, borderEdges, labels, wallPolygons, wallBorderEdges, wallLabels }) => {
			if (polygons.length > 0) {
				const clipId = `zone-clip-${id}-${z}`;
				str += `<clipPath id="${clipId}">\n`;
				polygons.forEach(pts => {
					str += `<polygon points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" />\n`;
				});
				str += `</clipPath>\n<g clip-path="url(#${clipId})">\n`;

				if (CONFIG.ZONE_CENTER_ALPHA > 0) {
					cells.forEach(({ x, y }, i) => {
						const pts = polygons[i].map(p => `${p.x},${p.y}`).join(' ');
						str += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="zone-fill" points="${pts}" fill="${item.color}" fill-opacity="${CONFIG.ZONE_CENTER_ALPHA}" stroke="none" />\n`;
					});
				}

				if (CONFIG.ZONE_GLOW_WIDTH > 0 && CONFIG.ZONE_GLOW_ALPHA > 0) {
					const steps = [
						{ wRatio: 2.0, aRatio: 0.25 },
						{ wRatio: 1.2, aRatio: 0.35 },
						{ wRatio: 0.5, aRatio: 0.40 },
					];
					steps.forEach(({ wRatio, aRatio }) => {
						const strokeW = CONFIG.ZONE_GLOW_WIDTH * wRatio;
						const op = (CONFIG.ZONE_GLOW_ALPHA * aRatio).toFixed(3);
						borderEdges.forEach(({ p0, p1 }) => {
							str += `<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${item.color}" stroke-width="${strokeW}" stroke-opacity="${op}" stroke-linecap="round" stroke-linejoin="round" />\n`;
						});
					});
				}
				str += `</g>\n`;

				borderEdges.forEach(({ p0, p1 }) => {
					str += `<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${item.color}" stroke-width="${CONFIG.ZONE_BORDER_WIDTH}" stroke-dasharray="${dashArray}" />\n`;
				});
			}

			if (wallPolygons && wallPolygons.length > 0) {
				const wallClipId = `zone-wall-clip-${id}-${z}`;
				str += `<clipPath id="${wallClipId}">\n`;
				wallPolygons.forEach(pts => {
					str += `<polygon points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" />\n`;
				});
				str += `</clipPath>\n<g clip-path="url(#${wallClipId})">\n`;

				if (CONFIG.ZONE_CENTER_ALPHA > 0) {
					wallPolygons.forEach(pts => {
						str += `<polygon data-type="zone-wall-fill" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="${item.color}" fill-opacity="${CONFIG.ZONE_CENTER_ALPHA}" stroke="none" />\n`;
					});
				}

				if (CONFIG.ZONE_GLOW_WIDTH > 0 && CONFIG.ZONE_GLOW_ALPHA > 0) {
					const steps = [
						{ wRatio: 2.0, aRatio: 0.25 },
						{ wRatio: 1.2, aRatio: 0.35 },
						{ wRatio: 0.5, aRatio: 0.40 },
					];
					steps.forEach(({ wRatio, aRatio }) => {
						const strokeW = CONFIG.ZONE_GLOW_WIDTH * wRatio;
						const op = (CONFIG.ZONE_GLOW_ALPHA * aRatio).toFixed(3);
						wallBorderEdges.forEach(({ p0, p1 }) => {
							str += `<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${item.color}" stroke-width="${strokeW}" stroke-opacity="${op}" stroke-linecap="round" stroke-linejoin="round" />\n`;
						});
					});
				}
				str += `</g>\n`;

				wallBorderEdges.forEach(({ p0, p1 }) => {
					str += `<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${item.color}" stroke-width="${CONFIG.ZONE_BORDER_WIDTH}" stroke-dasharray="${dashArray}" stroke-linecap="round" />\n`;
				});
			}

			if (isCurrent) {
				const safeName = Utils.escapeXml(String(item.name || ''));
				const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');
				const allLabels = [...(labels || []), ...(wallLabels || [])];
				allLabels.forEach(({ x, y }) => {
					str += `<text data-type="zone-label" x="${x}" y="${y}" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke" font-size="13" font-family="${safeFont}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeName}</text>\n`;
				});
			}
		});

		return str;
	}

	/**
	 * 樓層鬼影去飽和度色號運算 (Canvas 2D 畫布與 PNG 匯出共用)
	 */
	static desaturateHex(hex, factor = 0.5) {
		if (!hex || hex.length < 7) return '#64748b';
		const r = parseInt(hex.substring(1, 3), 16);
		const g = parseInt(hex.substring(3, 5), 16);
		const b = parseInt(hex.substring(5, 7), 16);
		const gray = 0.299 * r + 0.587 * g + 0.114 * b;
		const toHex = v => Math.round(v + (gray - v) * factor).toString(16).padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

	/**
	 * 統一繪製地塊網格輔助線與外框
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {import("./IsoMath.js").IsoMath} isoMath
	 * @param {number} width 網格寬度 (格數)
	 * @param {number} height 網格高度 (格數)
	 * @param {number} currentProgress 視角過渡進度
	 * @param {number} zoom 視角縮放倍率
	 * @param {number} [zLevel=0] Z 軸層級
	 */
	static drawGrid(ctx, isoMath, width, height, currentProgress, zoom = 1.0, zLevel = 0) {
		const { dx, dy } = calcZTranslate(zLevel, currentProgress);

		ctx.save();
		ctx.translate(dx, dy);
		ctx.lineWidth = 1 / zoom;
		ctx.strokeStyle = CONFIG.COLOR_GRID_NORMAL;

		for (let x = 0; x <= width; x++) {
			const start = isoMath.gridToScreen(x, 0, currentProgress);
			const end = isoMath.gridToScreen(x, height, currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}

		for (let y = 0; y <= height; y++) {
			const start = isoMath.gridToScreen(0, y, currentProgress);
			const end = isoMath.gridToScreen(width, y, currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}

		ctx.strokeStyle = CONFIG.COLOR_GRID_BOUNDS;
		ctx.lineWidth = 2 / zoom;
		const p00 = isoMath.gridToScreen(0, 0, currentProgress);
		const p10 = isoMath.gridToScreen(width, 0, currentProgress);
		const p11 = isoMath.gridToScreen(width, height, currentProgress);
		const p01 = isoMath.gridToScreen(0, height, currentProgress);

		ctx.beginPath();
		ctx.moveTo(p00.x, p00.y);
		ctx.lineTo(p10.x, p10.y);
		ctx.lineTo(p11.x, p11.y);
		ctx.lineTo(p01.x, p01.y);
		ctx.closePath();
		ctx.stroke();
		ctx.restore();
	}

	static _formatObjectSvgText(px, py, name, boxSize) {
		const rawName = Utils.escapeXml(String(name || '').substring(0, 2));
		if (!rawName) return '';
		const fontSize = Math.max(CONFIG.OBJECT_FONT_MIN, boxSize * CONFIG.OBJECT_FONT_RATIO);
		const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');
		return `<text x="${px}" y="${py}" fill="${CONFIG.OBJECT_TEXT_COLOR}" stroke="${CONFIG.OBJECT_STROKE_COLOR}" stroke-width="${CONFIG.OBJECT_STROKE_WIDTH}" font-size="${fontSize}" font-family="${safeFont}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${rawName}</text>\n`;
	}

	static _escapeXml(unsafe) {
		return Utils.escapeXml(unsafe);
	}
}
