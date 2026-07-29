/**
 * StorageManager.js - 簡化預設調色盤 (道路 / 室內空間)
 */

const STORAGE_KEY = "planboid_data_v4";

export class StorageManager {
    /**
     * 取得預設方案
     * 道路: 深灰 (#334155)
     * 室內空間: 淺灰 (#94a3b8)
     */
    static getDefaultScheme() {
        return {
            id: "scheme_" + Date.now(),
            name: "預設地塊規劃",
            width: 64,
            height: 64,
            currentLevel: 0,
            worldOriginX: 10500,
            worldOriginY: 9200,
            tiles: {},
            palette: {
                "color_road": { color: "#334155", name: "道路" },
                "color_indoor": { color: "#94a3b8", name: "室內空間" }
            }
        };
    }

    static loadData() {
        try {
            const jsonStr = localStorage.getItem(STORAGE_KEY);
            if (!jsonStr) {
                const defaultScheme = this.getDefaultScheme();
                const initialData = {
                    activeSchemeId: defaultScheme.id,
                    schemes: [defaultScheme]
                };
                this.saveData(initialData);
                return initialData;
            }
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("載入本地資料失敗，重置為預設方案:", e);
            const defaultScheme = this.getDefaultScheme();
            return {
                activeSchemeId: defaultScheme.id,
                schemes: [defaultScheme]
            };
        }
    }

    static saveData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error("寫入 localStorage 失敗:", e);
        }
    }
}
