/**
 * ExportCanvasPipeline.js - PNG 與 SVG 通用匯出計算管道與圖例 (Legend) 排版引擎
 * 專責邊界 Box、1.2x 尺寸放大與全新 [大色塊]: [調色盤名稱] 圖例數據導出
 */

import { i18n } from '../core/I18nManager.js';
import { Utils } from '../core/Utils.js';
import { IsoMath } from './IsoMath.js';

export class ExportCanvasPipeline {

	/**
	 * 產出帶有時間戳 (YYYYMMDD_HHmmss) 的共用安全匯出檔名 (委派至 Utils)
	 */
	static getExportFileName(rawName, suffix = '', ext = '') {
		return Utils.getExportFileName(rawName, suffix, ext);
	}

	/**
	 * 轉義 XML / SVG 特殊字元
	 * @param {string} str
	 * @returns {string}
	 */
	static escapeXml(str) {
		if (!str) return '';
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	/**
	 * 計算匯出全幅畫布的 BoundBox 尺寸與偏移
	 * @param {Object} scheme
	 * @returns {Object} { svgWidth, svgHeight, offsetX, offsetY, isoMath }
	 */
	static calculateExportBounds(scheme) {
		const isoMath = new IsoMath(32);
		const w = scheme?.width || 1;
		const h = scheme?.height || 1;

		const p00 = isoMath.gridToScreen(0, 0, 1.0);
		const p10 = isoMath.gridToScreen(w, 0, 1.0);
		const p11 = isoMath.gridToScreen(w, h, 1.0);
		const p01 = isoMath.gridToScreen(0, h, 1.0);

		const maxOffsetZ = 8;
		const topZOffsetPos = isoMath.gridToScreen(-3 * maxOffsetZ, -3 * maxOffsetZ, 1.0);

		const minX = Math.min(p00.x, p10.x, p11.x, p01.x, topZOffsetPos.x);
		const minY = Math.min(p00.y, p10.y, p11.y, p01.y - 96);
		const maxX = Math.max(p00.x, p10.x, p11.x, p01.x);
		const maxY = Math.max(p00.y, p10.y, p11.y, p01.y);

		const padding = 84; // 1.2x 放大後的頁面邊距
		const width = Math.ceil(maxX - minX + padding * 2);
		const height = Math.ceil(maxY - minY + padding * 2);
		const offsetX = -minX + padding;
		const offsetY = -minY + padding;

		return { width, height, offsetX, offsetY, isoMath, p00, p10, p11, p01 };
	}

	/**
	 * 計算全幅 ViewBox 與包覆相機 bounds (供 SvgExporter 與 PngExporter 通用呼叫)
	 * @param {Object} scheme
	 * @param {Object} isoMath
	 * @param {number} currentZ
	 * @returns {Object} { minX, minY, contentW, contentH, cameraX, cameraY, zoom }
	 */
	static calculateFitCamera(scheme, isoMath, currentZ = 0) {
		const bounds = this.calculateExportBounds(scheme);
		return {
			minX: -bounds.offsetX,
			minY: -bounds.offsetY,
			contentW: bounds.width,
			contentH: bounds.height,
			cameraX: bounds.offsetX,
			cameraY: bounds.offsetY,
			zoom: 1.0,
		};
	}

	/**
	 * 導出 1.2x 圖例 (Legend) 佈局數據與色塊 renderList
	 * @param {Object} palette
	 * @returns {Object} 圖例排版規格與 renderList
	 */
	static getLegendLayoutData(palette) {
		const paletteEntries = Object.values(palette || {});
		if (paletteEntries.length === 0) return null;

		const normalItems = paletteEntries.filter(item => !item.isObject);
		const objectItems = paletteEntries.filter(item => item.isObject);
		const hasDivider = normalItems.length > 0 && objectItems.length > 0;

		const scale = 1.2; // 1.2 倍整體尺寸放大
		const legendX = Math.round(28 * scale);
		const legendY = Math.round(28 * scale);
		const itemHeight = Math.round(30 * scale); // 36px 行高
		const dividerGap = Math.round(14 * scale); // 色塊分類分隔線間距 (17px)
		const legendWidth = Math.round(260 * scale); // 312px 寬度
		const headerHeight = Math.round(48 * scale); // 58px 標題區高度

		const swWidth = Math.round(38 * scale); // ~3em 寬的大色塊 (45px)
		const swHeight = Math.round(15 * scale); // 18px 高

		let currentY = headerHeight;
		const renderList = [];

		// 通用色塊
		normalItems.forEach(item => {
			renderList.push({
				type: 'item',
				color: item.color,
				name: item.name,
				y: currentY,
			});
			currentY += itemHeight;
		});

		// 若同時包含通用色塊與物件色塊，插入分隔線數據
		if (hasDivider) {
			renderList.push({
				type: 'divider',
				y: currentY - Math.round(itemHeight / 2) + Math.round(dividerGap / 2),
			});
			currentY += dividerGap;
		}

		// 物件色塊
		objectItems.forEach(item => {
			renderList.push({
				type: 'item',
				color: item.color,
				name: item.name,
				y: currentY,
			});
			currentY += itemHeight;
		});

		const legendHeight = Math.round(currentY + 12 * scale);

		return {
			scale,
			x: legendX,
			y: legendY,
			width: legendWidth,
			height: legendHeight,
			swWidth,
			swHeight,
			itemHeight,
			headerHeight,
			title: i18n.t('export_svg_legend_title') || '圖例',
			renderList,
		};
	}
}
