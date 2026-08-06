/**
 * SvgExporter.js - 帶有自解碼 data- 數據標籤的 SVG 向量導出器 (圖片與數據雙重載體)
 * 架構原則：按樓層分組 <g> 統一套用 transform 偏移，子元素使用純邏輯座標。
 */

import { CONFIG } from '../core/Config.js';
import { Utils } from '../core/Utils.js';
import { ExportCanvasPipeline } from './ExportCanvasPipeline.js';
import { calcZTranslate, GeometryPipeline } from './GeometryPipeline.js';
import { IsoMath } from './IsoMath.js';

export class SvgExporter {
	/**
	 * 導出並下載 SVG (供 Toolbar 呼叫之權威入口)
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 */
	static exportToSvg(stateManager) {
		if (!stateManager || !stateManager.scheme) return;
		const scheme = stateManager.scheme;
		const isoMath = new IsoMath(32);
		this.downloadSvg(scheme, isoMath, stateManager.currentZLevel, stateManager.otherFloorsMode);
	}

	/**
	 * 匯出帶有包覆相機與自解碼 data- 標籤的向量 SVG
	 * @param {Object} scheme
	 * @param {Object} isoMath
	 * @param {number} currentZ
	 * @param {string|boolean} otherFloorsMode
	 * @returns {string} XML SVG 字串
	 */
	static exportSvg(scheme, isoMath, currentZ = 0, otherFloorsMode = 'ghost') {
		if (!scheme) return '';
		const fit = ExportCanvasPipeline.calculateFitCamera(scheme, isoMath, currentZ);
		const palette = scheme.palette || {};

		const viewBoxX = Math.floor(fit.minX - 40);
		const viewBoxY = Math.floor(fit.minY - 40);
		const viewBoxW = Math.ceil(fit.contentW + 80);
		const viewBoxH = Math.ceil(fit.contentH + 80);

		let svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
		svgContent +=
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">\n`;
		svgContent += `<defs>\n`;
		svgContent += `  <linearGradient id="svg-wall-shading" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
		svgContent += `    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />\n`;
		svgContent += `    <stop offset="100%" stop-color="#000000" stop-opacity="0.32" />\n`;
		svgContent += `  </linearGradient>\n`;
		svgContent += `</defs>\n`;
		svgContent += `<rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="#0b0f19" />\n`;

		svgContent += `<g id="planboid-map-layer">\n`;

		// 按樓層分組：每層一個 <g> 套用 transform 與 opacity，子元素使用純邏輯座標
		const layers = GeometryPipeline.getSortedLayersToRender(scheme.tiles, currentZ, otherFloorsMode);

		layers.forEach(layer => {
			const { z, alpha } = layer;
			const { dx, dy } = calcZTranslate(z, 1.0);

			svgContent += `<g id="layer-z${z}" data-z="${z}" transform="translate(${dx}, ${dy})" opacity="${alpha}">\n`;

			GeometryPipeline.traverseLayerPasses(layer, palette, {
				onFloor: (x, y, floorColorId) => {
					const color = palette[floorColorId].color;
					const safeColorId = ExportCanvasPipeline.escapeXml(floorColorId);
					const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(isoMath, x, y, 1.0);
					svgContent +=
						`<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="floor" data-color-id="${safeColorId}" points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${color}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />\n`;
				},
				onFloorObjects: (x, y, objArray) => {
					svgContent += GeometryPipeline.getFloorObjectsSvgElements(isoMath, x, y, z, objArray, palette);
				},
				onWall: (x, y, edge, colorId) => {
					const color = palette[colorId].color;
					const safeColorId = ExportCanvasPipeline.escapeXml(colorId);
					svgContent += GeometryPipeline.getWallSvgElements(isoMath, x, y, z, edge, safeColorId, color);
				},
				onWallObjects: (x, y, edge, objArray) => {
					svgContent += GeometryPipeline.getWallObjectsSvgElements(isoMath, x, y, z, edge, objArray, palette);
				},
				onLabel: (x, y, label) => {
					const center = isoMath.gridToScreen(x + 0.5, y + 0.5, 1.0);
					const safeLabel = ExportCanvasPipeline.escapeXml(label);
					const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');
					svgContent +=
						`<text data-x="${x}" data-y="${y}" data-z="${z}" data-type="label" x="${center.x}" y="${center.y}" fill="#ffffff" font-size="13" font-family="${safeFont}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeLabel}</text>\n`;
				},
			});

			svgContent += `</g>\n`;
		});

		svgContent += `</g>\n`;

		// Pass 4: 繪製圖例 (Legend)
		const legendData = ExportCanvasPipeline.getLegendLayoutData(palette);
		if (legendData) {
			const { x: legX, y: legY, width: legWidth, height: legHeight, swWidth, swHeight, title, renderList } = legendData;
			const safeTitle = ExportCanvasPipeline.escapeXml(title);
			const safeFont = CONFIG.FONT_SANS.replace(/"/g, '&quot;');

			const actualLegX = viewBoxX + legX;
			const actualLegY = viewBoxY + legY;

			svgContent += `<g id="planboid-legend-layer" transform="translate(${actualLegX}, ${actualLegY})">\n`;
			svgContent +=
				`<rect width="${legWidth}" height="${legHeight}" fill="rgba(17, 24, 39, 0.92)" stroke="rgba(255, 255, 255, 0.18)" stroke-width="1.2" rx="10" ry="10" />\n`;
			svgContent += `<text x="18" y="28" fill="#a5b4fc" font-size="14" font-family="${safeFont}" font-weight="bold">${safeTitle}</text>\n`;
			svgContent += `<line x1="18" y1="38" x2="${legWidth - 18}" y2="38" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />\n`;

			renderList.forEach(entry => {
				if (entry.type === 'divider') {
					svgContent += `<line x1="18" y1="${entry.y}" x2="${legWidth - 18}" y2="${entry.y}" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />\n`;
				} else if (entry.type === 'item') {
					const safeName = ExportCanvasPipeline.escapeXml(entry.name);
					svgContent += `<rect x="18" y="${
						entry.y - 12
					}" width="${swWidth}" height="${swHeight}" fill="${entry.color}" rx="3" ry="3" stroke="rgba(255,255,255,0.25)" stroke-width="1" />\n`;
					svgContent += `<text x="${
						18 + swWidth + 10
					}" y="${entry.y}" fill="#e2e8f0" font-size="13" font-family="${safeFont}" font-weight="600">: ${safeName}</text>\n`;
				}
			});

			svgContent += `</g>\n`;
		}

		svgContent += `</svg>`;
		return svgContent;
	}

	/**
	 * 觸發瀏覽器下載 SVG
	 */
	static downloadSvg(scheme, isoMath, currentZ = 0, otherFloorsMode = 'ghost') {
		const svgContent = this.exportSvg(scheme, isoMath, currentZ, otherFloorsMode);
		const filename = Utils.getExportFileName(scheme.name, 'full_canvas', 'svg');
		Utils.triggerDownload(filename, svgContent, 'image/svg+xml;charset=utf-8');
	}
}
