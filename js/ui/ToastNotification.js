/**
 * ToastNotification.js - 零原生彈窗之全站高質感 Toast 浮動提示元件
 */

import { CONFIG } from '../core/Config.js';

export class ToastNotification {
	/**
	 * @param {string} message 提示訊息
	 * @param {'info' | 'success' | 'warning' | 'error'} type
	 * @param {number} duration
	 */
	static show(message, type = 'info', duration = CONFIG.TOAST_DURATION_MS) {
		let container = document.getElementById('toast-container');
		if (!container) {
			container = document.createElement('div');
			container.id = 'toast-container';
			document.body.appendChild(container);
		}

		// 限制最多同時顯示上限，防範瞬間大量訊息塞滿 DOM
		while (container.children.length >= (CONFIG.TOAST_MAX_COUNT || 5)) {
			const oldest = container.firstChild;
			if (oldest) {
				oldest.remove();
			} else {
				break;
			}
		}

		const toast = document.createElement('div');
		toast.className = `toast-item toast-${type}`;
		toast.textContent = String(message ?? '');

		container.appendChild(toast);

		requestAnimationFrame(() => {
			toast.classList.add('show');
		});

		let hideTimer = null;
		let removeTimer = null;

		const clearTimers = () => {
			if (hideTimer) clearTimeout(hideTimer);
			if (removeTimer) clearTimeout(removeTimer);
		};

		hideTimer = setTimeout(() => {
			toast.classList.remove('show');
			removeTimer = setTimeout(() => {
				clearTimers();
				toast.remove();
			}, 250);
		}, duration);
	}
}

