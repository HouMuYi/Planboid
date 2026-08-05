/**
 * AboutModal.js - 關於 Modal (直接載入預先內嵌編譯的 ABOUT_HTML，支援事件相容)
 */

import { ABOUT_HTML } from './AboutContent.js';

export class AboutModal {
	constructor() {
		this.modal = document.getElementById('modal-about');
		this.contentContainer = document.getElementById('about-markdown-body');
		this.init();
	}

	init() {
		const btnOpen = document.getElementById('btn-about');
		const btnClose = document.getElementById('btn-close-about-modal');

		btnOpen?.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.contentContainer && !this.contentContainer.innerHTML) {
				this.contentContainer.innerHTML = ABOUT_HTML;
			}
			if (this.modal) {
				if (typeof this.modal.showModal === 'function') {
					this.modal.showModal();
				} else {
					this.modal.setAttribute('open', 'true');
				}
			}
		});

		btnClose?.addEventListener('click', () => {
			if (this.modal) {
				if (typeof this.modal.close === 'function') {
					this.modal.close();
				} else {
					this.modal.removeAttribute('open');
				}
			}
		});

		this.modal?.addEventListener('click', (e) => {
			if (e.target === this.modal) {
				if (typeof this.modal.close === 'function') {
					this.modal.close();
				} else {
					this.modal.removeAttribute('open');
				}
			}
		});
	}
}
