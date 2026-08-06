/**
 * PngExporter.js - 帶全包覆視角與質感圖例的 PNG 圖片快照匯出器 (100% 離線純靜態相容)
 * 架構原則：按樓層分組 ctx.translate 統一套用位移，子元素使用純邏輯座標繪製。
 */

import { CONFIG } from '../core/Config.js';
import { i18n } from '../core/I18nManager.js';
import { Utils } from '../core/Utils.js';
import { ExportCanvasPipeline } from './ExportCanvasPipeline.js';
import { calcZTranslate, GeometryPipeline } from './GeometryPipeline.js';
import { IsoMath } from './IsoMath.js';

export class PngExporter {
	/**
	 * 匯出全自動包覆縮放、無互動 UI 雜點且帶有質感圖例的 PNG 快照
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 * @param {import("./CanvasRenderer.js").CanvasRenderer} renderer
	 */
	static exportToPng(stateManager, renderer) {
		if (!stateManager || !stateManager.scheme) return;
		const mainCanvas = document.getElementById('main-canvas');
		if (!mainCanvas) return;

		const scheme = stateManager.scheme;
		const currentZ = stateManager.currentZLevel;
		const palette = scheme.palette || {};
		const isoMath = new IsoMath(32);

		// 離屏 Canvas 尺寸同目前主畫布
		const offCanvas = document.createElement('canvas');
		offCanvas.width = mainCanvas.width;
		offCanvas.height = mainCanvas.height;
		const ctx = offCanvas.getContext('2d');

		const viewportW = mainCanvas.width / (window.devicePixelRatio || 1);
		const viewportH = mainCanvas.height / (window.devicePixelRatio || 1);
		const currentProgress = renderer ? renderer.currentProgress : 1.0;

		// 全自動計算恰恰好包覆全畫布與地塊的最佳 Zoom 與 Camera 位移
		const fit = GeometryPipeline.calculateFitCameraPos(
			isoMath,
			scheme,
			currentProgress,
			viewportW,
			viewportH,
			CONFIG.FIT_VIEW_PADDING,
		);

		ctx.save();
		ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

		// 1. 純黑背景
		ctx.fillStyle = '#0b0f19';
		ctx.fillRect(0, 0, viewportW, viewportH);

		// 套用全包覆相機矩陣
		ctx.save();
		ctx.translate(fit.cameraX, fit.cameraY);
		ctx.scale(fit.zoom, fit.zoom);

		// 2. 繪製底層網格 (Grid) (在當前 Z 層的座標系下)
		const { dx: gridDx, dy: gridDy } = calcZTranslate(currentZ, currentProgress);
		ctx.save();
		ctx.translate(gridDx, gridDy);
		ctx.lineWidth = 1 / fit.zoom;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
		for (let x = 0; x <= scheme.width; x++) {
			const start = isoMath.gridToScreen(x, 0, currentProgress);
			const end = isoMath.gridToScreen(x, scheme.height, currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}
		for (let y = 0; y <= scheme.height; y++) {
			const start = isoMath.gridToScreen(0, y, currentProgress);
			const end = isoMath.gridToScreen(scheme.width, y, currentProgress);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
		}

		// 外邊界紫線
		ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
		ctx.lineWidth = 2 / fit.zoom;
		const p00 = isoMath.gridToScreen(0, 0, currentProgress);
		const p10 = isoMath.gridToScreen(scheme.width, 0, currentProgress);
		const p11 = isoMath.gridToScreen(scheme.width, scheme.height, currentProgress);
		const p01 = isoMath.gridToScreen(0, scheme.height, currentProgress);
		ctx.beginPath();
		ctx.moveTo(p00.x, p00.y);
		ctx.lineTo(p10.x, p10.y);
		ctx.lineTo(p11.x, p11.y);
		ctx.lineTo(p01.x, p01.y);
		ctx.closePath();
		ctx.stroke();
		ctx.restore();

		// 3. 渲染所有樓層 (按層分組 ctx.translate 統一偏置)
		const layers = GeometryPipeline.getSortedLayersToRender(scheme.tiles, currentZ, stateManager.otherFloorsMode);

		layers.forEach(layer => {
			const { z, isCurrent, alpha, desatFactor } = layer;
			const { dx, dy } = calcZTranslate(z, currentProgress);

			ctx.save();
			ctx.translate(dx, dy);
			ctx.globalAlpha = alpha;

			GeometryPipeline.traverseLayerPasses(layer, palette, {
				onFloor: (x, y, floorColorId) => {
					const rawColor = palette[floorColorId].color;
					const finalColor = isCurrent ? rawColor : GeometryPipeline.desaturateHex(rawColor, desatFactor);

					ctx.save();
					ctx.globalAlpha = alpha;
					GeometryPipeline.drawTilePoly(ctx, isoMath, x, y, finalColor, currentProgress);
					ctx.restore();
				},
				onFloorObjects: (x, y, objArray) => {
					GeometryPipeline.drawFloorObjects(ctx, isoMath, x, y, objArray, palette, fit.zoom, currentProgress);
				},
				onWall: (x, y, edge, colorId) => {
					const rawColor = palette[colorId].color;
					const finalColor = isCurrent ? rawColor : GeometryPipeline.desaturateHex(rawColor, desatFactor);
					if (stateManager.is3DWallsEnabled && currentProgress > 0) {
						GeometryPipeline.drawWallQuad96px(ctx, isoMath, x, y, edge, finalColor, fit.zoom, currentProgress, CONFIG.WALL_FILL_ALPHA);
					} else {
						GeometryPipeline.drawWallLine2D(ctx, isoMath, x, y, edge, finalColor, fit.zoom, currentProgress);
					}
				},
				onWallObjects: (x, y, edge, objArray) => {
					if (stateManager.is3DWallsEnabled && currentProgress > 0) {
						GeometryPipeline.drawWallObjects3D(ctx, isoMath, x, y, edge, objArray, palette, fit.zoom, currentProgress);
					} else {
						GeometryPipeline.drawWallObjects2D(ctx, isoMath, x, y, edge, objArray, palette, fit.zoom, currentProgress);
					}
				},
				onLabel: (x, y, label) => {
					GeometryPipeline.drawTileText(ctx, isoMath, x, y, label, fit.zoom, currentProgress);
				},
			});

			ctx.restore();
		});

		ctx.restore();

		// Pass 4: 繪製圖例 (Legend)
		const legendData = ExportCanvasPipeline.getLegendLayoutData(palette);
		if (legendData) {
			const { x: legendX, y: legendY, width: legendWidth, height: legendHeight, swWidth, swHeight, title, renderList } = legendData;

			ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
			ctx.lineWidth = 1.2;

			if (ctx.roundRect) {
				ctx.beginPath();
				ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 10);
				ctx.fill();
				ctx.stroke();
			} else {
				ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
				ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);
			}

			ctx.fillStyle = '#a5b4fc';
			ctx.font = `bold 14px ${CONFIG.FONT_SANS}`;
			ctx.textBaseline = 'middle';
			ctx.fillText(title, legendX + 18, legendY + 24);

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(legendX + 18, legendY + 38);
			ctx.lineTo(legendX + legendWidth - 18, legendY + 38);
			ctx.stroke();

			renderList.forEach(entry => {
				const itemY = legendY + entry.y;

				if (entry.type === 'divider') {
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(legendX + 18, itemY);
					ctx.lineTo(legendX + legendWidth - 18, itemY);
					ctx.stroke();
				} else if (entry.type === 'item') {
					// 3em 大色塊
					ctx.fillStyle = entry.color;
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
					ctx.lineWidth = 1;
					if (ctx.roundRect) {
						ctx.beginPath();
						ctx.roundRect(legendX + 18, itemY - 7, swWidth, swHeight, 3);
						ctx.fill();
						ctx.stroke();
					} else {
						ctx.fillRect(legendX + 18, itemY - 7, swWidth, swHeight);
						ctx.strokeRect(legendX + 18, itemY - 7, swWidth, swHeight);
					}

					// 冒號與名稱
					ctx.fillStyle = '#e2e8f0';
					ctx.font = `600 13px ${CONFIG.FONT_SANS}`;
					ctx.fillText(`: ${entry.name}`, legendX + 18 + swWidth + 10, itemY);
				}
			});
		}

		// 5. 匯出 PNG 並下載
		const url = offCanvas.toDataURL('image/png');
		const filename = Utils.getExportFileName(scheme.name, 'blueprint', 'png');
		Utils.triggerDownload(filename, url);
	}
}
