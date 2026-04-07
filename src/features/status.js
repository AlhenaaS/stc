/**
 * Character status management.
 * Determines status from: manual override > schedule > default (online).
 * Integrates with header bar and autonomous messages.
 */

import { getChatMeta, getSchedule } from '../core/state.js';
import { getCurrentStatusFromSchedule } from './schedule.js';

/** Status update interval ID */
let statusInterval = null;

/** Status metadata: color, label, emoji */
const STATUS_MAP = {
    online:  { color: '#34C759', label: 'Online',           dot: 'online',  canMessage: true  },
    idle:    { color: '#FFCC00', label: 'Idle',             dot: 'idle',    canMessage: true  },
    dnd:     { color: '#FF3B30', label: 'Do Not Disturb',   dot: 'dnd',     canMessage: false },
    offline: { color: '#8E8E93', label: 'Offline',          dot: 'offline', canMessage: false },
};

/**
 * Get the current status of the character.
 * Priority: manual override > schedule > default (online).
 * @returns {string} 'online' | 'idle' | 'dnd' | 'offline'
 */
export function getCurrentStatus() {
    const meta = getChatMeta();

    // Manual override
    if (meta.conversationStatusOverride) {
        return meta.conversationStatusOverride;
    }

    // Schedule-based
    const schedule = meta.conversationSchedule;
    if (schedule?.weekly) {
        return getCurrentStatusFromSchedule(schedule);
    }

    return 'online';
}

/**
 * Get the current activity description from schedule.
 * @returns {string|null}
 */
export function getCurrentActivity() {
    const meta = getChatMeta();
    const schedule = meta.conversationSchedule;
    if (!schedule?.weekly) return null;

    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[now.getDay()];
    const daySchedule = schedule.weekly[dayName];
    if (!daySchedule || !Array.isArray(daySchedule)) return null;

    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const block of daySchedule) {
        if (currentTimeStr >= block.from && currentTimeStr < block.to) {
            return block.activity || null;
        }
    }
    return null;
}

/**
 * Set a manual status override.
 * @param {string|null} status - null to clear override
 */
export function setStatusOverride(status) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;

    if (status) {
        context.chatMetadata.conversationStatusOverride = status;
    } else {
        delete context.chatMetadata.conversationStatusOverride;
    }
    context.saveMetadataDebounced();
    refreshStatus();
}

/**
 * Get status display info.
 * @param {string} status
 * @returns {{ color: string, label: string, dot: string, canMessage: boolean }}
 */
export function getStatusInfo(status) {
    return STATUS_MAP[status] || STATUS_MAP.online;
}

/**
 * Refresh the header status indicator.
 * Reads current status and updates the header bar.
 */
export function refreshStatus() {
    const status = getCurrentStatus();
    const activity = getCurrentActivity();
    const info = getStatusInfo(status);

    // Update header status dot and text
    const statusDot = document.querySelector('.conv-status-dot');
    const statusText = document.querySelector('.conv-status-text');

    if (statusDot) {
        statusDot.className = `conv-status-dot ${info.dot}`;
    }
    if (statusText) {
        statusText.textContent = activity ? `${info.label} — ${activity}` : info.label;
    }
}

/**
 * Start periodic status refresh (every 60 seconds).
 * Updates header when schedule-based status might change.
 */
export function startStatusPolling() {
    stopStatusPolling();
    refreshStatus();
    statusInterval = setInterval(refreshStatus, 60000);
}

/**
 * Stop periodic status refresh.
 */
export function stopStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
}

/**
 * Check if the character can receive messages right now.
 * @returns {boolean}
 */
export function canReceiveMessages() {
    const status = getCurrentStatus();
    return getStatusInfo(status).canMessage;
}

/**
 * Open the status override popup.
 */
export async function openStatusPicker() {
    const current = getCurrentStatus();
    const meta = getChatMeta();
    const hasOverride = !!meta.conversationStatusOverride;

    const html = `
    <div class="conv-status-picker">
        <h3>Set Character Status</h3>
        <p style="color:var(--SmartThemeQuoteColor);font-size:13px;margin:0 0 12px">
            ${hasOverride ? 'Manual override is active. Clear to use schedule.' : 'Using schedule-based status.'}
        </p>
        <div class="flex-container flexFlowColumn gap10">
            ${Object.entries(STATUS_MAP).map(([key, info]) => `
                <label class="flex-container alignItemsCenter gap10" style="cursor:pointer;padding:6px 8px;border-radius:8px;
                    ${key === current ? 'background:rgba(0,122,255,0.1)' : ''}">
                    <input type="radio" name="conv_status_pick" value="${key}" ${key === current ? 'checked' : ''} />
                    <span style="color:${info.color};font-size:16px">&#9679;</span>
                    <span>${info.label}</span>
                </label>
            `).join('')}
            <hr style="margin:4px 0" />
            <label class="flex-container alignItemsCenter gap10" style="cursor:pointer;padding:6px 8px;border-radius:8px">
                <input type="radio" name="conv_status_pick" value="__clear__" />
                <span>Clear override (use schedule)</span>
            </label>
        </div>
    </div>`;

    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Apply',
        cancelButton: 'Cancel',
    });

    const result = await popup.show();
    if (result) {
        const selected = document.querySelector('input[name="conv_status_pick"]:checked')?.value;
        if (selected === '__clear__') {
            setStatusOverride(null);
        } else if (selected) {
            setStatusOverride(selected);
        }
    }
}
