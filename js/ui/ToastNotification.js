/**
 * ToastNotification.js - 零原生彈窗之全站高質感 Toast 浮動提示元件
 */

export class ToastNotification {
    static show(message, type = "info", duration = 2500) {
        let container = document.getElementById("toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            container.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = `toast-item toast-${type}`;
        toast.style.cssText = `
            background: var(--bg-card, #1e293b);
            color: var(--text-primary, #f8fafc);
            border: 1px solid var(--border-color, rgba(255,255,255,0.15));
            border-left: 4px solid ${type === "error" ? "var(--accent-danger, #ef4444)" : "var(--accent-primary, #6366f1)"};
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
            pointer-events: auto;
            opacity: 0;
            transform: translateY(-10px);
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            white-space: nowrap;
        `;
        toast.textContent = message;

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
        });

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(-10px)";
            setTimeout(() => {
                toast.remove();
            }, 250);
        }, duration);
    }
}
