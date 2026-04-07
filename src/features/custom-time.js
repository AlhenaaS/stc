/**
 * Custom game time system.
 * Allows characters to experience time differently from reality:
 * - manual: advance only when explicitly set
 * - per-message: auto-advance a random amount per message
 * - realtime: 1:1 with real clock
 * - accelerated: faster than real time
 *
 * Time is stored in chatMetadata.conversationTime.
 */

import { getChatMeta } from '../core/state.js';
import { advanceCustomTime, formatStatusBarTime, getCurrentTime } from '../utils/time-helpers.js';
import { updateStatusBarClock } from '../ui/phone-window.js';

let realtimeInterval = null;

/**
 * Default custom time config.
 * @returns {object}
 */
export function getDefaultTimeConfig() {
    return {
        enabled: false,
        baseDate: new Date().toISOString(),
        currentDate: new Date().toISOString(),
        flowMode: 'per-message', // 'manual' | 'per-message' | 'realtime' | 'accelerated'
        autoAdvanceOnMessage: true,
        autoAdvanceRange: { min: 1, max: 30 }, // minutes
        accelerationFactor: 10,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

/**
 * Initialize custom time system for the current chat.
 * Call on chat change and when config is updated.
 */
export function initCustomTime() {
    stopRealtimeUpdates();

    const meta = getChatMeta();
    const timeConfig = meta.conversationTime;

    if (!timeConfig?.enabled) return;

    // Ensure currentDate exists
    if (!timeConfig.currentDate) {
        timeConfig.currentDate = timeConfig.baseDate || new Date().toISOString();
    }

    if (timeConfig.flowMode === 'realtime') {
        startRealtimeUpdates(timeConfig);
    } else if (timeConfig.flowMode === 'accelerated') {
        startAcceleratedUpdates(timeConfig);
    }

    // Update the status bar clock immediately
    updateStatusBarClock();
}

/**
 * Enable custom time for the current chat.
 * @param {object} [overrides] - Optional config overrides
 */
export function enableCustomTime(overrides = {}) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;

    const config = { ...getDefaultTimeConfig(), ...overrides, enabled: true };
    context.chatMetadata.conversationTime = config;
    context.saveMetadataDebounced();
    initCustomTime();
}

/**
 * Disable custom time for the current chat.
 */
export function disableCustomTime() {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata?.conversationTime) return;

    context.chatMetadata.conversationTime.enabled = false;
    context.saveMetadataDebounced();
    stopRealtimeUpdates();
}

/**
 * Set the custom time configuration.
 * @param {object} config - Full or partial config to merge
 */
export function setCustomTimeConfig(config) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;

    const existing = context.chatMetadata.conversationTime || getDefaultTimeConfig();
    context.chatMetadata.conversationTime = { ...existing, ...config };
    context.saveMetadataDebounced();
    initCustomTime();
}

/**
 * Advance time on user message (if autoAdvance enabled).
 * Called from events.js on MESSAGE_SENT.
 */
export function advanceTimeOnMessage() {
    const context = SillyTavern.getContext();
    const timeConfig = context.chatMetadata?.conversationTime;
    if (!timeConfig?.enabled) return;
    if (timeConfig.flowMode !== 'per-message' || !timeConfig.autoAdvanceOnMessage) return;

    const newTime = advanceCustomTime(timeConfig);
    if (newTime) {
        context.saveMetadataDebounced();
        updateStatusBarClock();
    }
}

/**
 * Manually set the current custom time.
 * @param {string|Date} dateTime - ISO string or Date object
 */
export function setCurrentTime(dateTime) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata?.conversationTime) return;

    const iso = dateTime instanceof Date ? dateTime.toISOString() : dateTime;
    context.chatMetadata.conversationTime.currentDate = iso;
    context.saveMetadataDebounced();
    updateStatusBarClock();
}

/**
 * Jump time forward by N minutes.
 * @param {number} minutes
 */
export function jumpTimeForward(minutes) {
    const context = SillyTavern.getContext();
    const tc = context.chatMetadata?.conversationTime;
    if (!tc?.enabled) return;

    const current = new Date(tc.currentDate || tc.baseDate);
    current.setMinutes(current.getMinutes() + minutes);
    tc.currentDate = current.toISOString();
    context.saveMetadataDebounced();
    updateStatusBarClock();
}

/**
 * Get a formatted string of the current game time for display.
 * @returns {string}
 */
export function getFormattedGameTime() {
    return formatStatusBarTime(getCurrentTime());
}

/**
 * Get the current game date as ISO string.
 * @returns {string|null}
 */
export function getGameTimeISO() {
    const meta = getChatMeta();
    const tc = meta.conversationTime;
    if (!tc?.enabled) return null;
    return tc.currentDate || tc.baseDate || null;
}

// --- Clock tick implementations ---

/**
 * Start realtime clock updates (1:1 with real time).
 * @param {object} timeConfig
 */
function startRealtimeUpdates(timeConfig) {
    const startReal = Date.now();
    const startGame = new Date(timeConfig.currentDate || timeConfig.baseDate).getTime();

    realtimeInterval = setInterval(() => {
        const elapsed = Date.now() - startReal;
        timeConfig.currentDate = new Date(startGame + elapsed).toISOString();
        updateStatusBarClock();
    }, 1000);
}

/**
 * Start accelerated clock updates.
 * @param {object} timeConfig
 */
function startAcceleratedUpdates(timeConfig) {
    const factor = timeConfig.accelerationFactor || 10;
    const startReal = Date.now();
    const startGame = new Date(timeConfig.currentDate || timeConfig.baseDate).getTime();

    realtimeInterval = setInterval(() => {
        const elapsed = Date.now() - startReal;
        timeConfig.currentDate = new Date(startGame + elapsed * factor).toISOString();
        updateStatusBarClock();
    }, 1000);
}

/**
 * Stop realtime/accelerated updates.
 */
export function stopRealtimeUpdates() {
    if (realtimeInterval) {
        clearInterval(realtimeInterval);
        realtimeInterval = null;
    }
}

/**
 * Open the time editor popup using ST's Popup API.
 */
export async function openTimeEditor() {
    const meta = getChatMeta();
    const tc = meta.conversationTime || getDefaultTimeConfig();

    const html = `
    <div class="conv-time-editor">
        <h3>Custom Game Time</h3>

        <div class="flex-container alignItemsCenter gap10" style="margin-bottom:10px">
            <input id="conv-time-enabled" type="checkbox" ${tc.enabled ? 'checked' : ''} />
            <label for="conv-time-enabled"><b>Enable custom game time</b></label>
        </div>

        <div class="flex-container flexFlowColumn gap10">
            <label>Current game time:</label>
            <input id="conv-time-current" type="datetime-local"
                value="${toLocalInputValue(tc.currentDate || tc.baseDate)}" class="text_pole" />

            <label>Time flow mode:</label>
            <select id="conv-time-flow" class="text_pole">
                <option value="manual" ${tc.flowMode === 'manual' ? 'selected' : ''}>Manual only</option>
                <option value="per-message" ${tc.flowMode === 'per-message' ? 'selected' : ''}>Advance per message</option>
                <option value="realtime" ${tc.flowMode === 'realtime' ? 'selected' : ''}>Real-time (1:1)</option>
                <option value="accelerated" ${tc.flowMode === 'accelerated' ? 'selected' : ''}>Accelerated</option>
            </select>

            <div id="conv-time-advance-opts" style="${tc.flowMode === 'per-message' ? '' : 'display:none'}">
                <label>Random advance range (minutes):</label>
                <div class="flex-container alignItemsCenter gap10">
                    <input id="conv-time-adv-min" type="number" class="text_pole" min="0" max="1440"
                        value="${tc.autoAdvanceRange?.min ?? 1}" style="width:80px" />
                    <span>to</span>
                    <input id="conv-time-adv-max" type="number" class="text_pole" min="0" max="1440"
                        value="${tc.autoAdvanceRange?.max ?? 30}" style="width:80px" />
                </div>
            </div>

            <div id="conv-time-accel-opts" style="${tc.flowMode === 'accelerated' ? '' : 'display:none'}">
                <label>Acceleration factor: <b id="conv-time-accel-val">${tc.accelerationFactor || 10}</b>x</label>
                <input id="conv-time-accel" type="range" min="2" max="100" step="1"
                    value="${tc.accelerationFactor || 10}" />
            </div>

            <hr style="margin:8px 0" />

            <div class="flex-container gap10">
                <button id="conv-time-jump-1h" class="menu_button">+1 Hour</button>
                <button id="conv-time-jump-6h" class="menu_button">+6 Hours</button>
                <button id="conv-time-jump-1d" class="menu_button">+1 Day</button>
                <button id="conv-time-jump-now" class="menu_button">Set to Now</button>
            </div>
        </div>
    </div>`;

    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Save',
        cancelButton: 'Cancel',
        wide: false,
    });

    // Wire up dynamic UI after popup renders
    requestAnimationFrame(() => {
        const flowSelect = document.getElementById('conv-time-flow');
        const advOpts = document.getElementById('conv-time-advance-opts');
        const accelOpts = document.getElementById('conv-time-accel-opts');
        const accelSlider = document.getElementById('conv-time-accel');
        const accelVal = document.getElementById('conv-time-accel-val');

        if (flowSelect) {
            flowSelect.addEventListener('change', () => {
                if (advOpts) advOpts.style.display = flowSelect.value === 'per-message' ? '' : 'none';
                if (accelOpts) accelOpts.style.display = flowSelect.value === 'accelerated' ? '' : 'none';
            });
        }
        if (accelSlider && accelVal) {
            accelSlider.addEventListener('input', () => {
                accelVal.textContent = accelSlider.value;
            });
        }

        // Quick jump buttons
        const currentInput = document.getElementById('conv-time-current');
        const jumpBy = (min) => {
            if (!currentInput) return;
            const d = new Date(currentInput.value);
            d.setMinutes(d.getMinutes() + min);
            currentInput.value = toLocalInputValue(d.toISOString());
        };
        document.getElementById('conv-time-jump-1h')?.addEventListener('click', () => jumpBy(60));
        document.getElementById('conv-time-jump-6h')?.addEventListener('click', () => jumpBy(360));
        document.getElementById('conv-time-jump-1d')?.addEventListener('click', () => jumpBy(1440));
        document.getElementById('conv-time-jump-now')?.addEventListener('click', () => {
            if (currentInput) currentInput.value = toLocalInputValue(new Date().toISOString());
        });
    });

    const result = await popup.show();

    if (result) {
        // Read values from popup DOM
        const enabled = document.getElementById('conv-time-enabled')?.checked ?? false;
        const currentStr = document.getElementById('conv-time-current')?.value;
        const flowMode = document.getElementById('conv-time-flow')?.value || 'per-message';
        const advMin = parseInt(document.getElementById('conv-time-adv-min')?.value, 10) || 1;
        const advMax = parseInt(document.getElementById('conv-time-adv-max')?.value, 10) || 30;
        const accelFactor = parseInt(document.getElementById('conv-time-accel')?.value, 10) || 10;

        const currentDate = currentStr ? new Date(currentStr).toISOString() : new Date().toISOString();

        setCustomTimeConfig({
            enabled,
            currentDate,
            baseDate: tc.baseDate || currentDate,
            flowMode,
            autoAdvanceOnMessage: flowMode === 'per-message',
            autoAdvanceRange: { min: advMin, max: advMax },
            accelerationFactor: accelFactor,
        });
    }
}

/**
 * Convert ISO date string to datetime-local input value.
 * @param {string} iso
 * @returns {string}
 */
function toLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    // datetime-local format: YYYY-MM-DDTHH:MM
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
