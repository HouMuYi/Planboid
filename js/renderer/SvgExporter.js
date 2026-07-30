/**
 * SvgExporter.js - 帶有自解碼 data- 數據標籤的 SVG 向量導出器 (圖片與數據雙重載體)
 * 架構原則：按樓層分組 <g> 統一套用 transform 偏移，子元素使用純邏輯座標。
 */

import { IsoMath } from "./IsoMath.js";
import { GeometryPipeline, calcZTranslate } from "./GeometryPipeline.js";
import { ExportCanvasPipeline } from "./ExportCanvasPipeline.js";

export class SvgExporter {
    /**
     * 導出並下載 SVG (供 Toolbar 呼叫之權威入口)
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    static exportToSvg(stateManager) {
        if (!stateManager || !stateManager.scheme) return;
        const scheme = stateManager.scheme;
        const isoMath = new IsoMath(32);
        this.downloadSvg(scheme, isoMath, stateManager.currentZLevel, stateManager.ghostLayerEnabled);
    }

    /**
     * 匯出帶有包覆相機與自解碼 data- 標籤的向量 SVG
     * @param {Object} scheme 
     * @param {Object} isoMath 
     * @param {number} currentZ 
     * @param {boolean} ghostEnabled 
     * @returns {string} XML SVG 字串
     */
    static exportSvg(scheme, isoMath, currentZ = 0, ghostEnabled = true) {
        const fit = ExportCanvasPipeline.calculateFitCamera(scheme, isoMath, currentZ);
        const palette = scheme.palette || {};

        const viewBoxX = Math.floor(fit.minX - 40);
        const viewBoxY = Math.floor(fit.minY - 40);
        const viewBoxW = Math.ceil(fit.contentW + 80);
        const viewBoxH = Math.ceil(fit.contentH + 80);

        let svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">\n`;
        svgContent += `<rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="#0b0f19" />\n`;

        svgContent += `<g id="planboid-map-layer">\n`;

        // 按樓層分組：每層一個 <g> 套用 transform 與 opacity，子元素使用純邏輯座標
        const layers = GeometryPipeline.getSortedLayersToRender(scheme.tiles, currentZ, ghostEnabled);

        layers.forEach(layer => {
            const { z, isCurrent, alpha, items } = layer;
            const { dx, dy } = calcZTranslate(z, 1.0);

            svgContent += `<g id="layer-z${z}" data-z="${z}" transform="translate(${dx}, ${dy})" opacity="${alpha}">\n`;

            // Pass 1: 地塊多邊形
            items.forEach(({ x, y, tile }) => {
                if (tile.floorColorId && palette[tile.floorColorId]) {
                    const color = palette[tile.floorColorId].color;
                    const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(isoMath, x, y, 1.0);
                    svgContent += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="floor" data-color-id="${tile.floorColorId}" points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${color}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />\n`;
                }
            });

            // Pass 2: 牆面面片
            items.forEach(({ x, y, tile }) => {
                if (tile.walls) {
                    Object.entries(tile.walls).forEach(([edge, colorId]) => {
                        if (colorId && palette[colorId]) {
                            const color = palette[colorId].color;
                            const quad = GeometryPipeline.getWallQuad96Points(isoMath, x, y, edge, 1.0);
                            if (quad) {
                                const [b0, b1, t1, t0] = quad;
                                svgContent += `<polygon data-x="${x}" data-y="${y}" data-z="${z}" data-type="wall" data-edge="${edge}" data-color-id="${colorId}" points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="0.45" stroke="${color}" stroke-opacity="0.8" stroke-width="1.5" />\n`;
                            }
                        }
                    });
                }
            });

            // Pass 3: 文字標籤 (僅當前樓層)
            if (isCurrent) {
                items.forEach(({ x, y, tile }) => {
                    if (tile.label) {
                        const center = isoMath.gridToScreen(x + 0.5, y + 0.5, 1.0);
                        const safeLabel = ExportCanvasPipeline.escapeXml(tile.label);
                        svgContent += `<text data-x="${x}" data-y="${y}" data-z="${z}" data-type="label" x="${center.x}" y="${center.y}" fill="#ffffff" font-size="13" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeLabel}</text>\n`;
                    }
                });
            }

            svgContent += `</g>\n`;
        });

        svgContent += `</g>\n`;

        // Pass 4: 繪製全新 1.2x 放大之 [大色塊]: [名稱] 向量圖例 (固定於 SVG 圖片絕對左上角)
        const legendData = ExportCanvasPipeline.getLegendLayoutData(palette);
        if (legendData) {
            const { x: legX, y: legY, width: legWidth, height: legHeight, swWidth, swHeight, itemHeight, headerHeight, title, items } = legendData;
            const safeTitle = ExportCanvasPipeline.escapeXml(title);

            const actualLegX = viewBoxX + legX;
            const actualLegY = viewBoxY + legY;

            svgContent += `<g id="planboid-legend-layer" transform="translate(${actualLegX}, ${actualLegY})">\n`;
            svgContent += `<rect width="${legWidth}" height="${legHeight}" fill="rgba(17, 24, 39, 0.92)" stroke="rgba(255, 255, 255, 0.18)" stroke-width="1.2" rx="10" ry="10" />\n`;
            svgContent += `<text x="18" y="28" fill="#a5b4fc" font-size="14" font-family="Inter, sans-serif" font-weight="bold">${safeTitle}</text>\n`;
            svgContent += `<line x1="18" y1="38" x2="${legWidth - 18}" y2="38" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />\n`;

            items.forEach(item => {
                const itemY = headerHeight + item.index * itemHeight;
                const safeName = ExportCanvasPipeline.escapeXml(item.name);
                svgContent += `<rect x="18" y="${itemY - 12}" width="${swWidth}" height="${swHeight}" fill="${item.color}" rx="3" ry="3" stroke="rgba(255,255,255,0.25)" stroke-width="1" />\n`;
                svgContent += `<text x="${18 + swWidth + 10}" y="${itemY}" fill="#e2e8f0" font-size="13" font-family="Inter, sans-serif" font-weight="600">: ${safeName}</text>\n`;
            });

            svgContent += `</g>\n`;
        }

        svgContent += `</svg>`;
        return svgContent;
    }

    /**
     * 觸發瀏覽器下載 SVG
     */
    static downloadSvg(scheme, isoMath, currentZ = 0, ghostEnabled = true) {
        const svgContent = this.exportSvg(scheme, isoMath, currentZ, ghostEnabled);
        const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeName = ExportCanvasPipeline.getSafeFileName(scheme.name);
        a.download = `${safeName}_full_canvas_planboid.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
}
