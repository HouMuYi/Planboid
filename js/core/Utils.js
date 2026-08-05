/**
 * Utils.js - 全站通用無狀態輔助工具箱 (輕量級深模組，原則：保持小體量，大就拆)
 * 負責：檔名安全處理、時間戳格式化、通用瀏覽器檔案下載觸發
 */

export class Utils {
	/**
	 * 清理檔名非法字元與控制字元
	 * @param {string} rawName
	 * @returns {string}
	 */
	static sanitizeFileName(rawName) {
		const strName = typeof rawName === 'string' ? rawName : String(rawName || 'planboid');
		const cleaned = strName
			.trim()
			.replace(/[\x00-\x1f\\/:*?"<>|\r\n]/g, '_')
			.replace(/^\.+/, '')
			.replace(/\.+$/, '');
		return cleaned || 'planboid';
	}

	/**
	 * HTML 特殊字元 XSS 防護轉義
	 * @param {any} str
	 * @returns {string}
	 */
	static escapeHtml(str) {
		if (str === null || str === undefined) return '';
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * 產出帶有時間戳 (YYYYMMDD_HHmmss) 的通用匯出檔名
	 * @param {string} rawName 方案名稱
	 * @param {string} suffix 檔名後綴 (如 'blueprint', 'full_canvas', 'scheme')
	 * @param {string} ext 副檔名 (如 'png', 'svg', 'json')
	 * @returns {string} 例如 "預設規劃方案_20260731_135504_blueprint.png"
	 */
	static getExportFileName(rawName, suffix = '', ext = '') {
		const safeName = Utils.sanitizeFileName(rawName);
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		const seconds = String(now.getSeconds()).padStart(2, '0');
		const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;

		const safeSuffix = typeof suffix === 'string' ? suffix.trim() : '';
		const safeExt = typeof ext === 'string' ? ext.trim() : '';

		const parts = [safeName, timestamp];
		if (safeSuffix) parts.push(safeSuffix);
		let filename = parts.join('_');
		if (safeExt) filename += `.${safeExt.replace(/^\./, '')}`;
		return filename;
	}

	/**
	 * 統一觸發瀏覽器下載 (支援 Blob, DataURL 與純字串)
	 * @param {string} filename 下載檔名
	 * @param {Blob|string} content 下載內容
	 * @param {string} mimeType MIME 類型 (例如 'image/svg+xml;charset=utf-8')
	 */
	static triggerDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
		let url;
		let shouldRevoke = false;

		if (content instanceof Blob) {
			url = URL.createObjectURL(content);
			shouldRevoke = true;
		} else if (typeof content === 'string' && (content.startsWith('data:') || content.startsWith('blob:'))) {
			url = content;
		} else {
			const blob = new Blob([content], { type: mimeType });
			url = URL.createObjectURL(blob);
			shouldRevoke = true;
		}

		const a = document.createElement('a');
		a.href = filename;
		a.download = Utils.sanitizeFileName(filename);
		a.href = url;
		document.body.appendChild(a);
		a.click();
		a.remove();

		if (shouldRevoke) {
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		}
	}
}
