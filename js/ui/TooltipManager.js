/**
 * TooltipManager.js - 全站通用自訂懸浮提示管理器 (自動接管 title 屬性、防原生黑框、智慧邊界檢測)
 */

export class TooltipManager {
	constructor() {
		this.tooltipEl = null;
		this.currentTargetEl = null;
		this.rawTitleMap = new WeakMap(); // 儲存原生的 title 屬性備份
		this.init();
	}

	init() {
		// 建立全域唯一的 Tooltip 浮層
		this.tooltipEl = document.createElement('div');
		this.tooltipEl.id = 'global-tooltip';
		this.tooltipEl.className = 'custom-tooltip';
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
		const target = e.target.closest('[title], [data-tooltip-text]');
		if (!target || target === this.tooltipEl) return;

		// 若元素有原生的 title，先擷取並備份，然後拔掉 title 屬性防止瀏覽器原生黑框彈出
		let text = target.dataset.tooltipText;
		if (target.hasAttribute('title')) {
			const titleAttr = target.getAttribute('title');
			if (titleAttr && titleAttr.trim()) {
				text = titleAttr.trim();
				target.dataset.tooltipText = text;
				this.rawTitleMap.set(target, titleAttr);
			}
			target.removeAttribute('title');
		}

		if (!text || !text.trim()) return;

		this.currentTargetEl = target;
		this.tooltipEl.textContent = text;
		this.tooltipEl.classList.add('visible');
		this.tooltipEl.setAttribute('aria-hidden', 'false');
		this.positionTooltip(e);
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
		if (this.currentTargetEl) {
			// 離開時若原先有原生 title，恢復其屬性確保 Accessibility 無障礙相容
			const rawTitle = this.rawTitleMap.get(this.currentTargetEl);
			if (rawTitle && !this.currentTargetEl.hasAttribute('title')) {
				this.currentTargetEl.setAttribute('title', rawTitle);
			}
			this.currentTargetEl = null;
		}

		if (this.tooltipEl) {
			this.tooltipEl.classList.remove('visible');
			this.tooltipEl.setAttribute('aria-hidden', 'true');
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
