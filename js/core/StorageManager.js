/**
 * StorageManager.js - 持久化與預設方案管理 (整合 SchemeSerializer 解碼與標準化)
 */

import { CONFIG } from './Config.js';
import { i18n } from './I18nManager.js';
import { SchemeSerializer } from './SchemeSerializer.js';

const STORAGE_KEY = 'planboid_data_v4';
const LEGACY_STORAGE_KEYS = ['planboid_data_v3', 'planboid_data_v2', 'planboid_data'];

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
				'obj_door': { color: '#e11d48', name: '🚪', isObject: true },
				'obj_window': { color: '#f59e0b', name: '🪟', isObject: true },
				'obj_sink': { color: '#38bdf8', name: '🚰', isObject: true },
				'obj_bucket': { color: '#1e40af', name: '🪣', isObject: true },
				'obj_ladder': { color: '#991b1b', name: '🪜', isObject: true },
			},
		};
	}

	static loadData() {
		try {
			let jsonStr = localStorage.getItem(STORAGE_KEY);
			// 自動相容遷移：若 v4 無資料，嘗試讀取舊版 Storage Keys
			if (!jsonStr) {
				for (const legacyKey of LEGACY_STORAGE_KEYS) {
					const legacyDataStr = localStorage.getItem(legacyKey);
					if (legacyDataStr) {
						jsonStr = legacyDataStr;
						console.log(`[StorageManager] 成功由舊版 Key (${legacyKey}) 遷移資料至 v4`);
						break;
					}
				}
			}

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
			if (data && Array.isArray(data.schemes) && data.schemes.length > 0) {
				// 透過權威門面解析器 100% 同步穩健解析所有載體（PZB1 / 明文 JSON / 舊版物件）
				const deserializedSchemes = data.schemes
					.map(s => SchemeSerializer.parse(s))
					.filter(Boolean);

				if (deserializedSchemes.length > 0) {
					data.schemes = deserializedSchemes;
				} else {
					const defaultScheme = this.getDefaultScheme();
					data.schemes = [defaultScheme];
					data.activeSchemeId = defaultScheme.id;
				}

				// 確保 activeSchemeId 有效
				if (!data.activeSchemeId || !data.schemes.some(s => s.id === data.activeSchemeId)) {
					data.activeSchemeId = data.schemes[0].id;
				}

				return data;
			}

			const defaultScheme = this.getDefaultScheme();
			const fallbackData = {
				activeSchemeId: defaultScheme.id,
				schemes: [defaultScheme],
			};
			this.saveData(fallbackData);
			return fallbackData;
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

	/**
	 * 計算單一方案經過 Tuple 序列化後的字節數 (UTF-16 雙位元組算數)
	 */
	static getSchemeSizeBytes(scheme) {
		if (!scheme) return 0;
		const serialized = SchemeSerializer.serialize(scheme);
		const jsonStr = JSON.stringify(serialized);
		return jsonStr.length * 2;
	}

	/**
	 * 計算全站 localStorage 已用容量與 5MB 標準配額使用率
	 */
	static getStorageUsage() {
		let totalBytes = 0;
		let planboidBytes = 0;
		let otherBytes = 0;

		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (!key) continue;
				const val = localStorage.getItem(key) || '';
				const itemBytes = (key.length + val.length) * 2;
				totalBytes += itemBytes;
				if (key === STORAGE_KEY) {
					planboidBytes = itemBytes;
				} else {
					otherBytes += itemBytes;
				}
			}
		} catch (e) {
			console.error('[StorageManager] 讀取容量失敗:', e);
		}

		const quotaBytes = 5 * 1024 * 1024; // 5 MiB 標準配額 (5,242,880 Bytes)
		const percentNumber = Math.min(100, (totalBytes / quotaBytes) * 100);

		return {
			totalBytes,
			planboidBytes,
			otherBytes,
			totalKiB: (totalBytes / 1024).toFixed(1),
			planboidKiB: (planboidBytes / 1024).toFixed(1),
			otherKiB: (otherBytes / 1024).toFixed(1),
			percent: percentNumber.toFixed(1),
			percentNumber,
			isWarning: percentNumber >= 70 && percentNumber < 85,
			isDanger: percentNumber >= 85,
		};
	}
}
