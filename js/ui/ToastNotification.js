/**
 * ToastNotification.js - 零原生彈窗之全站高質感 Toast 浮動提示元件
 */

export class ToastNotification {
	static show(message, type = 'info', duration = 2500) {
		let container = document.getElementById('toast-container');
		if (!container) {
			container = document.createElement('div');
			container.id = 'toast-container';
			document.body.appendChild(container);
		}

		const toast = document.createElement('div');
		toast.className = `toast-item toast-${type}`;
		toast.textContent = message;

		container.appendChild(toast);

		requestAnimationFrame(() => {
			toast.classList.add('show');
		});

		setTimeout(() => {
			toast.classList.remove('show');
			setTimeout(() => {
				toast.remove();
			}, 250);
		}, duration);
	}
}
