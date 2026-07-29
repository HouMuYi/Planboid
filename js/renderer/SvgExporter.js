/**
 * SvgExporter.js - 向量 SVG 圖片繪出器 (共享 GeometryPipeline 幾何投影與圖例繪製)
 */

import { IsoMath } from "./IsoMath.js";
import { GeometryPipeline } from "./GeometryPipeline.js";

export class SvgExporter {
    /**
     * 將整張方案畫布 (0,0 ~ width,height) 匯出為完整向量 SVG 字串並下載
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    static exportToSvg(stateManager) {
        const scheme = stateManager.scheme;
        const currentZ = stateManager.currentZLevel;
        const palette = scheme.palette;
        const isoMath = new IsoMath(32);

        const w = scheme.width;
        const h = scheme.height;

        const p00 = isoMath.gridToScreen(0, 0, 1.0);
        const p10 = isoMath.gridToScreen(w, 0, 1.0);
        const p11 = isoMath.gridToScreen(w, h, 1.0);
        const p01 = isoMath.gridToScreen(0, h, 1.0);

        const maxOffsetZ = 8;
        const topZOffsetPos = isoMath.gridToScreen(-3 * maxOffsetZ, -3 * maxOffsetZ, 1.0);

        const minX = Math.min(p00.x, p10.x, p11.x, p01.x, topZOffsetPos.x);
        const minY = Math.min(p00.y, p10.y, p11.y, p01.y, topZOffsetPos.y - 96);
        const maxX = Math.max(p00.x, p10.x, p11.x, p01.x);
        const maxY = Math.max(p00.y, p10.y, p11.y, p01.y);

        const padding = 70;
        const svgWidth = Math.ceil(maxX - minX + padding * 2);
        const svgHeight = Math.ceil(maxY - minY + padding * 2);
        const offsetX = -minX + padding;
        const offsetY = -minY + padding;

        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">\n`;
        svgContent += `<rect width="100%" height="100%" fill="#0b0f19" />\n`;

        // 1. 地圖網格與圖形群組
        svgContent += `<g transform="translate(${offsetX}, ${offsetY})">\n`;

        svgContent += `<g stroke="rgba(255, 255, 255, 0.08)" stroke-width="0.75">\n`;
        for (let x = 0; x <= w; x++) {
            const start = isoMath.gridToScreen(x, 0, 1.0);
            const end = isoMath.gridToScreen(x, h, 1.0);
            svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />\n`;
        }
        for (let y = 0; y <= h; y++) {
            const start = isoMath.gridToScreen(0, y, 1.0);
            const end = isoMath.gridToScreen(w, y, 1.0);
            svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />\n`;
        }
        svgContent += `</g>\n`;

        svgContent += `<polygon points="${p00.x},${p00.y} ${p10.x},${p10.y} ${p11.x},${p11.y} ${p01.x},${p01.y}" fill="none" stroke="rgba(99, 102, 241, 0.6)" stroke-width="2" />\n`;

        // 共享 GeometryPipeline 過濾與排序
        const tilesToRender = GeometryPipeline.getSortedTilesToRender(scheme.tiles, currentZ, true);

        // Pass 1: 先繪製所有地塊 (塊)
        tilesToRender.forEach(item => {
            const { x, y, z, opacity = item.alpha, tile } = item;
            const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(isoMath, x, y, z, 1.0);

            if (tile.floorColorId && palette[tile.floorColorId]) {
                const color = palette[tile.floorColorId].color;
                svgContent += `<polygon points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${color}" opacity="${opacity}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />\n`;
            }
        });

        // Pass 2: 將所有邊線牆體 (線) 繪製於地塊之上
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

        // Pass 3: 繪製所有區域標籤
        tilesToRender.forEach(item => {
            const { x, y, z, tile } = item;
            if (tile.label && z === currentZ) {
                const rX = x - 3 * z;
                const rY = y - 3 * z;
                const center = isoMath.gridToScreen(rX + 0.5, rY + 0.5, 1.0);
                svgContent += `<text x="${center.x}" y="${center.y}" fill="#ffffff" font-size="12" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${tile.label}</text>\n`;
            }
        });

        svgContent += `</g>\n`;

        // 2. 調色盤圖例
        const paletteEntries = Object.values(palette);
        if (paletteEntries.length > 0) {
            const legendX = 24;
            const legendY = 24;
            const itemHeight = 24;
            const legendWidth = 230;
            const legendHeight = 44 + paletteEntries.length * itemHeight;

            svgContent += `<g transform="translate(${legendX}, ${legendY})">\n`;
            svgContent += `<rect width="${legendWidth}" height="${legendHeight}" fill="rgba(17, 24, 39, 0.88)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" rx="8" ry="8" />\n`;
            svgContent += `<text x="12" y="22" fill="#a5b4fc" font-size="12" font-family="Inter, sans-serif" font-weight="bold">圖例 (地塊/塊 • 邊線/線)</text>\n`;
            svgContent += `<line x1="12" y1="30" x2="${legendWidth - 12}" y2="30" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" />\n`;

            paletteEntries.forEach((item, index) => {
                const itemY = 48 + index * itemHeight;
                svgContent += `<rect x="14" y="${itemY - 10}" width="12" height="12" fill="${item.color}" rx="2" ry="2" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" />\n`;
                svgContent += `<text x="29" y="${itemY}" fill="#64748b" font-size="9" font-family="Inter, sans-serif">塊</text>\n`;
                svgContent += `<line x1="42" y1="${itemY - 4}" x2="56" y2="${itemY - 4}" stroke="${item.color}" stroke-width="3" stroke-linecap="round" />\n`;
                svgContent += `<text x="60" y="${itemY}" fill="#64748b" font-size="9" font-family="Inter, sans-serif">線</text>\n`;
                svgContent += `<text x="76" y="${itemY}" fill="#e2e8f0" font-size="11" font-family="Inter, sans-serif">${item.name}</text>\n`;
            });

            svgContent += `</g>\n`;
        }

        svgContent += `</svg>`;

        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${scheme.name}_full_canvas_planboid.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
