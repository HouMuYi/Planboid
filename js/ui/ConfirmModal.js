/**
 * ConfirmModal.js - 零原生 confirm() 之全站專屬二次確認對話框
 */

export class ConfirmModal {
    /**
     * @param {string} message 提示訊息
     * @returns {Promise<boolean>} 使用者點擊確定回傳 true，點擊取消/關閉回傳 false
     */
    static show(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById("modal-confirm");
            const msgEl = document.getElementById("confirm-modal-message");
            const btnOk = document.getElementById("btn-confirm-ok");
            const btnCancel = document.getElementById("btn-confirm-cancel");
            const btnClose = document.getElementById("btn-close-confirm-modal");

            if (!modal || !msgEl || !btnOk) {
                resolve(false);
                return;
            }

            msgEl.textContent = message;

            const cleanup = (result) => {
                modal.close();
                btnOk.removeEventListener("click", onOk);
                btnCancel?.removeEventListener("click", onCancel);
                btnClose?.removeEventListener("click", onCancel);
                resolve(result);
            };

            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);

            btnOk.addEventListener("click", onOk);
            btnCancel?.addEventListener("click", onCancel);
            btnClose?.addEventListener("click", onCancel);

            modal.showModal();
        });
    }
}
