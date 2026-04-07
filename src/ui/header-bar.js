/**
 * Header Bar: manages back button, avatar, name, status, and action buttons.
 */

import { minimizePhone, updateHeader } from './phone-window.js';
import { getCurrentStatus, getStatusInfo, openStatusPicker, refreshStatus } from '../features/status.js';

/**
 * Initialize the header bar event handlers.
 */
export function initHeaderBar() {
    const backBtn = document.getElementById('conv-btn-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // Minimize (show restore bubble) instead of hiding completely,
            // so the user can reopen the conversation on mobile
            minimizePhone();
        });
    }

    const sceneBtn = document.getElementById('conv-btn-scene');
    if (sceneBtn) {
        sceneBtn.addEventListener('click', () => {
            // Will be implemented in scene system (Phase 3)
            console.log('[Conversation] Scene button clicked');
        });
    }

    // Click on status to open status picker
    const statusEl = document.getElementById('conv-header-status');
    if (statusEl) {
        statusEl.style.cursor = 'pointer';
        statusEl.title = 'Click to change status';
        statusEl.addEventListener('click', () => {
            openStatusPicker();
        });
    }
}

/**
 * Update the header with current character info from ST context.
 * Integrates with status system (Phase 2).
 */
export function refreshHeader() {
    const context = SillyTavern.getContext();
    if (context.characterId === undefined) return;

    const char = context.characters[context.characterId];
    if (!char) return;

    const avatarUrl = char.avatar
        ? `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}`
        : '/img/ai4.png';

    // Get current status from status system
    const status = getCurrentStatus();

    updateHeader({
        name: char.name || 'Character',
        avatarUrl,
        status,
    });

    // Also refresh the detailed status display
    refreshStatus();

    // Update placeholder text
    const textarea = document.getElementById('conv-input-textarea');
    if (textarea) {
        textarea.placeholder = `Message @${char.name}...`;
    }
}
