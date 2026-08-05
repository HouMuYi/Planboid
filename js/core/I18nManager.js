/**
 * I18nManager.js - 多語言國際化管理器 (平鋪字典、無限退回鏈與 DOM 批次更新)
 */

export class I18nManager {
	constructor() {
		this.availableLangs = ['zh', 'en'];
		this.currentLang = this.detectLanguage();
	}

	/**
	 * 自動偵測初始語系 (優先讀取 localStorage，次選 navigator.language 前綴，預設 zh)
	 */
	detectLanguage() {
		const saved = localStorage.getItem('planboid_lang');
		if (saved && window.PLANBOID_LANGUAGES && window.PLANBOID_LANGUAGES[saved]) {
			return saved;
		}

		const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
		if (navLang.startsWith('en')) return 'en';
		return 'zh';
	}

	/**
	 * 切換語系並發送全域通知
	 */
	setLanguage(langKey) {
		if (!window.PLANBOID_LANGUAGES || !window.PLANBOID_LANGUAGES[langKey]) {
			console.warn(`[I18n] 未找到對應語系字典: ${langKey}`);
			return;
		}

		this.currentLang = langKey;
		localStorage.setItem('planboid_lang', langKey);
		this.updateDomTranslations();

		window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: langKey } }));
	}

	/**
	 * 核心翻譯查詢函數 (支援平鋪金鑰、點號相容與退回鏈)
	 * @param {string} key 金鑰，例如 "header_badge" 或 "modal_schemes_confirm_delete"
	 * @param {Object} [params] 例如 { name: "方案1" }
	 * @param {string} [startLang] 內部遞迴起點
	 * @returns {string}
	 */
	t(key, params = {}, startLang = this.currentLang) {
		if (!key || typeof key !== 'string') return String(key || '');
		if (!window.PLANBOID_LANGUAGES) return key;

		let langDict = window.PLANBOID_LANGUAGES[startLang];
		let val = this.lookupKey(langDict, key);

		// 退回鏈處理 (Fallback Chain)
		if ((val === null || val === undefined) && langDict && langDict['__FALLBACK__']) {
			const fallbackLang = langDict['__FALLBACK__'];
			if (fallbackLang !== startLang && window.PLANBOID_LANGUAGES[fallbackLang]) {
				val = this.lookupKey(window.PLANBOID_LANGUAGES[fallbackLang], key);
			}
		}

		// 極致退回父級 zh
		if ((val === null || val === undefined) && window.PLANBOID_LANGUAGES['zh']) {
			val = this.lookupKey(window.PLANBOID_LANGUAGES['zh'], key);
		}

		if (val === null || val === undefined) {
			return key;
		}

		// 動態變數插值 (使用 replaceAll 徹底排除 Regex 特殊字元引發的崩潰)
		if (params && typeof params === 'object') {
			Object.entries(params).forEach(([pK, pV]) => {
				val = val.replaceAll(`{${pK}}`, String(pV ?? ''));
			});
		}

		return val;
	}

	lookupKey(dict, key) {
		if (!dict || typeof key !== 'string') return null;

		// 1. 直接試平鋪 key (防範 Object 原型鏈屬性如 toString, constructor 穿透)
		if (Object.prototype.hasOwnProperty.call(dict, key) && typeof dict[key] === 'string') {
			return dict[key];
		}

		// 2. 試底線替換點號 (如 "header.badge" -> "header_badge")
		const flatKey = key.replace(/\./g, '_');
		if (Object.prototype.hasOwnProperty.call(dict, flatKey) && typeof dict[flatKey] === 'string') {
			return dict[flatKey];
		}

		return null;
	}

	/**
	 * 批次更新 HTML 頁面中帶有 data-i18n 的 DOM 元素
	 */
	updateDomTranslations() {
		document.querySelectorAll('[data-i18n]').forEach(el => {
			const key = el.dataset.i18n;
			if (key) el.textContent = this.t(key);
		});

		document.querySelectorAll('[data-i18n-title]').forEach(el => {
			const key = el.dataset.i18nTitle;
			if (key) el.title = this.t(key);
		});

		document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
			const key = el.dataset.i18nPlaceholder;
			if (key) el.placeholder = this.t(key);
		});

		document.documentElement.lang = this.currentLang;
	}
}

export const i18n = new I18nManager();
