/**
 * StorageManager.js - 持久化與預設方案管理 (整合 SchemeSerializer 解碼與標準化)
 */

import { i18n } from './I18nManager.js';
import { SchemeSerializer } from './SchemeSerializer.js';
import { CONFIG } from './Config.js';

const STORAGE_KEY = 'planboid_data_v4';

export class StorageManager {
	/**
	 * 取得預設方案
	 */
	static getDefaultScheme() {
		return {
			id: 'scheme_' + Date.now(),
			name: i18n.t('defaults_scheme_name') || '預設地塊規劃',
			width: CONFIG.DEFAULT_SCHEME_WIDTH,
			height: CONFIG.DEFAULT_SCHEME_HEIGHT,
			currentLevel: 0,
			worldOriginX: CONFIG.DEFAULT_ORIGIN_X,
			worldOriginY: CONFIG.DEFAULT_ORIGIN_Y,
			tiles: {},
			palette: {
				'color_road': { color: '#334155', name: i18n.t('defaults_palette_road') || '道路' },
				'color_indoor': { color: '#B38147', name: i18n.t('defaults_palette_indoor') || '室內空間' },
			},
		};
	}

	static loadData() {
		try {
			const jsonStr = localStorage.getItem(STORAGE_KEY);
			if (!jsonStr) {
				const defaultScheme = this.getDefaultScheme();
				const initialData = {
					activeSchemeId: defaultScheme.id,
					schemes: [defaultScheme],
				};
				this.saveData(initialData);
				return initialData;
			}
			const data = JSON.parse(jsonStr);
			if (data && Array.isArray(data.schemes)) {
				data.schemes = data.schemes.map(s => SchemeSerializer.deserialize(s));
			}
			return data;
		} catch (e) {
			console.error('載入本地資料失敗，重置為預設方案:', e);
			const defaultScheme = this.getDefaultScheme();
			return {
				activeSchemeId: defaultScheme.id,
				schemes: [defaultScheme],
			};
		}
	}

	static saveData(data) {
		try {
			if (data && Array.isArray(data.schemes)) {
				const serializedData = {
					activeSchemeId: data.activeSchemeId,
					schemes: data.schemes.map(s => SchemeSerializer.serialize(s)),
				};
				localStorage.setItem(STORAGE_KEY, JSON.stringify(serializedData));
				return;
			}
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch (e) {
			console.error('寫入 localStorage 失敗:', e);
		}
	}
}
