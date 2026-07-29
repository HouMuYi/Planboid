/**
 * SvgExporter.js - 向量 SVG 圖片繪出器 (輸出完整 64x64 畫布地圖網格)
 */

import { IsoMath } from "./IsoMath.js";

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

        // 計算完整整張畫布四個頂點的螢幕座標 (含 Z 軸最高可能偏移)
        const p00 = isoMath.gridToScreen(0, 0, 1.0);
        const p10 = isoMath.gridToScreen(w, 0, 1.0);
        const p11 = isoMath.gridToScreen(w, h, 1.0);
        const p01 = isoMath.gridToScreen(0, h, 1.0);

        // 考量最高樓層視覺偏移與 96px 牆高
        const maxOffsetZ = 8;
        const topZOffsetPos = isoMath.gridToScreen(-3 * maxOffsetZ, -3 * maxOffsetZ, 1.0);

        const minX = Math.min(p00.x, p10.x, p11.x, p01.x, topZOffsetPos.x);
        const minY = Math.min(p00.y, p10.y, p11.y, p01.y, topZOffsetPos.y - 96);
        const maxX = Math.max(p00.x, p10.x, p11.x, p01.x);
        const maxY = Math.max(p00.y, p10.y, p11.y, p01.y);

        const padding = 60;
        const svgWidth = Math.ceil(maxX - minX + padding * 2);
        const svgHeight = Math.ceil(maxY - minY + padding * 2);
        const offsetX = -minX + padding;
        const offsetY = -minY + padding;

        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">\n`;
        svgContent += `<rect width="100%" height="100%" fill="#0b0f19" />\n`;
        svgContent += `<g transform="translate(${offsetX}, ${offsetY})">\n`;

        // 1. 繪製全畫布底層網格 (Grid lines for 0,0 ~ w,h)
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

        // 畫布主邊框
        svgContent += `<polygon points="${p00.x},${p00.y} ${p10.x},${p10.y} ${p11.x},${p11.y} ${p01.x},${p01.y}" fill="none" stroke="rgba(99, 102, 241, 0.6)" stroke-width="2" />\n`;

        // 2. 收集地塊並依 Z 軸低到高繪製 (目前樓層與鬼影層)
        const tilesToDraw = Object.entries(scheme.tiles).filter(([key]) => {
            const { z } = IsoMath.parseTileKey(key);
            return z <= currentZ;
        });

        const sortedTiles = tilesToDraw.sort((a, b) => {
            const zA = IsoMath.parseTileKey(a[0]).z;
            const zB = IsoMath.parseTileKey(b[0]).z;
            return zA - zB;
        });

        sortedTiles.forEach(([key, tile]) => {
            const { x, y, z } = IsoMath.parseTileKey(key);
            const isGhost = (z !== currentZ);
            const opacity = isGhost ? 0.25 : 1.0;

            const [p0, p1, p2, p3] = isoMath.getTilePolyScreen(x, y, z, 1.0);

            // 地板 Polygon
            if (tile.floorColorId && palette[tile.floorColorId]) {
                const color = palette[tile.floorColorId].color;
                svgContent += `<polygon points="${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${color}" opacity="${opacity}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5" />\n`;
            }

            // 立體牆面 96px Quads
            if (tile.walls) {
                Object.entries(tile.walls).forEach(([edge, colorId]) => {
                    if (colorId && palette[colorId]) {
                        const color = palette[colorId].color;
                        const quad = isoMath.getWallQuad96Screen(x, y, z, edge, 1.0);
                        if (quad) {
                            const [b0, b1, t1, t0] = quad;
                            svgContent += `<polygon points="${b0.x},${b0.y} ${b1.x},${b1.y} ${t1.x},${t1.y} ${t0.x},${t0.y}" fill="${color}" fill-opacity="${opacity * 0.45}" stroke="${color}" stroke-opacity="${opacity * 0.8}" stroke-width="1.5" />\n`;
                        }
                    }
                });
            }

            // 區域標籤 Text
            if (tile.label && z === currentZ) {
                const rX = x - 3 * z;
                const rY = y - 3 * z;
                const center = isoMath.gridToScreen(rX + 0.5, rY + 0.5, 1.0);
                svgContent += `<text x="${center.x}" y="${center.y}" fill="#ffffff" font-size="12" font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${tile.label}</text>\n`;
            }
        });

        svgContent += `</g>\n</svg>`;

        // 下載檔案
        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${scheme.name}_full_canvas_planboid.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
