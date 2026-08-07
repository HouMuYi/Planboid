import { i18n } from '../core/I18nManager.js';

export class TooltipManager {
	constructor() {
		this.tooltipEl = null;
		this.currentTargetEl = null;
		this.rawTitleMap = new WeakMap(); // 僅在記憶體中暫存挪動後的靜態 title 文字
		this.init();
	}

	init() {
		// 建立全域唯一的 Tooltip 浮層 (啟用 HTML5 Popover 原生 Top Layer 特權)
		this.tooltipEl = document.createElement('div');
		this.tooltipEl.id = 'global-tooltip';
		this.tooltipEl.className = 'custom-tooltip';
		this.tooltipEl.setAttribute('popover', 'manual');
		this.tooltipEl.setAttribute('role', 'tooltip');
		this.tooltipEl.setAttribute('aria-hidden', 'true');
		document.body.appendChild(this.tooltipEl);

		// 全域事件委派監聽
		document.addEventListener('mouseover', (e) => this.handleMouseOver(e), true);
		document.addEventListener('mousemove', (e) => this.handleMouseMove(e), true);
		document.addEventListener('mouseout', (e) => this.handleMouseOut(e), true);
		document.addEventListener('click', () => this.hide(), true);
		window.addEventListener('scroll', () => this.hide(), true);
	}

	handleMouseOver(e) {
		const target = e.target.closest('[data-i18n-title], [title]');
		if (!target || target === this.tooltipEl) return;

		let text = '';

		// 1. 若有 data-i18n-title，優先即時查詢動態字典 (保證切換語言 100% 即時反應)
		if (target.dataset.i18nTitle) {
			text = i18n.t(target.dataset.i18nTitle);
			if (target.hasAttribute('title')) {
				target.removeAttribute('title'); // 拔掉原生 title 防醜黑框
			}
		} else if (target.hasAttribute('title')) {
			// 2. 若為普通靜態 title，將內容「挪」至記憶體 WeakMap 中，並從 DOM 拔除 title 屬性
			const rawVal = target.getAttribute('title').trim();
			if (rawVal) {
				text = rawVal;
				this.rawTitleMap.set(target, rawVal);
			}
			target.removeAttribute('title');
		} else if (this.rawTitleMap.has(target)) {
			// 3. 從記憶體中取出先前已挪動的靜態文字
			text = this.rawTitleMap.get(target);
		}

		if (!text || !text.trim()) return;

		this.currentTargetEl = target;
		this.tooltipEl.textContent = text;
		this.tooltipEl.classList.add('visible');
		this.tooltipEl.setAttribute('aria-hidden', 'false');
		this.positionTooltip(e);

		try {
			if (this.tooltipEl.showPopover && !this.tooltipEl.matches(':popover-open')) {
				this.tooltipEl.showPopover();
			}
		} catch (err) {
			// Fallback for browsers without popover
		}
	}

	handleMouseMove(e) {
		if (this.currentTargetEl) {
			this.positionTooltip(e);
		}
	}

	handleMouseOut(e) {
		if (!this.currentTargetEl) return;

		const related = e.relatedTarget;
		if (related && (this.currentTargetEl.contains(related) || related === this.currentTargetEl)) {
			return;
		}

		this.hide();
	}

	hide() {
		this.currentTargetEl = null;

		if (this.tooltipEl) {
			this.tooltipEl.classList.remove('visible');
			this.tooltipEl.setAttribute('aria-hidden', 'true');
			try {
				if (this.tooltipEl.hidePopover && this.tooltipEl.matches(':popover-open')) {
					this.tooltipEl.hidePopover();
				}
			} catch (err) {
				// Fallback
			}
		}
	}

	positionTooltip(e) {
		if (!this.tooltipEl || !this.currentTargetEl) return;

		const offset = 12;
		let x = e.clientX + offset;
		let y = e.clientY + offset;

		// 邊界溢出智慧算術 (Bound Check)
		const rect = this.tooltipEl.getBoundingClientRect();
		const winW = window.innerWidth;
		const winH = window.innerHeight;

		if (x + rect.width > winW - 12) {
			x = e.clientX - rect.width - offset;
		}
		if (y + rect.height > winH - 12) {
			y = e.clientY - rect.height - offset;
		}

		if (x < 12) x = 12;
		if (y < 12) y = 12;

		this.tooltipEl.style.left = `${x}px`;
		this.tooltipEl.style.top = `${y}px`;
	}
}
