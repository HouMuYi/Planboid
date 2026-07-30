/**
 * SvgExporter.js - 向量 SVG 圖片繪出器 (基於 ExportCanvasPipeline, 1.2x 放大與大色塊圖例)
 */

import { GeometryPipeline } from "./GeometryPipeline.js";
import { ExportCanvasPipeline } from "./ExportCanvasPipeline.js";

export class SvgExporter {
    /**
     * 將整張方案畫布 (0,0 ~ width,height) 匯出為完整向量 SVG 字串並下載
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    static exportToSvg(stateManager) {
        const scheme = stateManager.scheme;
        const currentZ = stateManager.currentZLevel;
        const palette = scheme.palette;

        const bounds = ExportCanvasPipeline.calculateExportBounds(scheme);
        const { width: svgWidth, height: svgHeight, offsetX, offsetY, isoMath, p00, p10, p11, p01 } = bounds;

        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">\n`;
        svgContent += `<rect width="100%" height="100%" fill="#0b0f19" />\n`;

        svgContent += `<g transform="translate(${offsetX}, ${offsetY})">\n`;

        // 繪製背景幾何網格
        svgContent += `<g stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.75">\n`;
        for (let x = 0; x <= scheme.width; x++) {
            const start = isoMath.gridToScreen(x, 0, 1.0);
            const end = isoMath.gridToScreen(x, scheme.height, 1.0);
            svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />\n`;
        }
        for (let y = 0; y <= scheme.height; y++) {
            const start = isoMath.gridToScreen(0, y, 1.0);
            const end = isoMath.gridToScreen(scheme.width, y, 1.0);
            svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />\n`;
        }
        svgContent += `</g>\n`;

        // 繪製地塊外框
        svgContent += `<polygon points="${p00.x},${p00.y} ${p10.x},${p10.y} ${p11.x},${p11.y} ${p01.x},${p01.y}" fill="none" stroke="rgba(99, 102, 241, 0.6)" stroke-width="2" />\n`;

        const tilesToRender = GeometryPipeline.getSortedTilesToRender(scheme.tiles, currentZ, true);

        // Pass 1: 地塊多邊形
        tilesToRender.forEach(item => {
            const { x, y, z, opacity = item.alpha, tile } = item;
            const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(isoMath, x, y, z, 1.0);

            if (tile.floorColorId && palette[tile.floorColorId]) {
                const color = palette[tile.floorColorId].color;
                svgContent += `<polygon points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${color}" opacity="${opacity}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />\n`;
            }
        });

        // Pass 2: 牆面面片
        tilesToRender.forEach(item => {
            const { x, y, z, opacity = item.alpha, tile } = item;
            if (tile.walls) {
                Object.entries(tile.walls).forEach(([edge, colorId]) => {
                    if (colorId && palette[colorId]) {
                        const color = palette[colorId].color;
                        const quad = GeometryPipeline.getWallQuad96Points(isoMath, x, y, z, edge, 1.0);
                        if (quad) {
                            const [b0, b1, t1, t0] = quad;
                            svgContent += `<polygon points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="${opacity * 0.45}" stroke="${color}" stroke-opacity="${opacity * 0.8}" stroke-width="1.5" />\n`;
                        }
                    }
                });
            }
        });

        // Pass 3: 區域文字標籤
        tilesToRender.forEach(item => {
            const { x, y, z, tile } = item;
            if (tile.label && z === currentZ) {
                const rX = x - 3 * z;
                const rY = y - 3 * z;
                const center = isoMath.gridToScreen(rX + 0.5, rY + 0.5, 1.0);
                const safeLabel = ExportCanvasPipeline.escapeXml(tile.label);
                svgContent += `<text x="${center.x}" y="${center.y}" fill="#ffffff" font-size="13" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${safeLabel}</text>\n`;
            }
        });

        svgContent += `</g>\n`;

        // Pass 4: 繪製全新 1.2x 放大之 [大色塊]: [名稱] 向量圖例 (Legend)
        const legendData = ExportCanvasPipeline.getLegendLayoutData(palette);
        if (legendData) {
            const { x: legX, y: legY, width: legWidth, height: legHeight, swWidth, swHeight, itemHeight, headerHeight, title, items } = legendData;
            const safeTitle = ExportCanvasPipeline.escapeXml(title);

            svgContent += `<g transform="translate(${legX}, ${legY})">\n`;
            svgContent += `<rect width="${legWidth}" height="${legHeight}" fill="rgba(17, 24, 39, 0.92)" stroke="rgba(255, 255, 255, 0.18)" stroke-width="1.2" rx="10" ry="10" />\n`;
            svgContent += `<text x="18" y="28" fill="#a5b4fc" font-size="14" font-family="Inter, sans-serif" font-weight="bold">${safeTitle}</text>\n`;
            svgContent += `<line x1="18" y1="38" x2="${legWidth - 18}" y2="38" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />\n`;

            items.forEach(item => {
                const itemY = headerHeight + item.index * itemHeight;
                const safeName = ExportCanvasPipeline.escapeXml(item.name);
                // 3em 大色塊
                svgContent += `<rect x="18" y="${itemY - 12}" width="${swWidth}" height="${swHeight}" fill="${item.color}" rx="3" ry="3" stroke="rgba(255,255,255,0.25)" stroke-width="1" />\n`;
                // 冒號與調色盤名稱
                svgContent += `<text x="${18 + swWidth + 10}" y="${itemY}" fill="#e2e8f0" font-size="13" font-family="Inter, sans-serif" font-weight="600">: ${safeName}</text>\n`;
            });

            svgContent += `</g>\n`;
        }

        svgContent += `</svg>`;

        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeFileName = ExportCanvasPipeline.getSafeFileName(scheme.name);
        a.download = `${safeFileName}_full_canvas_planboid.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
