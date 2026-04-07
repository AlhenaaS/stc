/**
 * Settings module: binds settings UI controls to extension settings.
 */

import { getSettings, saveSettings, isConversationEnabled, setConversationEnabled } from './state.js';
import { applyDisplayMode, showPhone, hidePhone } from '../ui/phone-window.js';
import { renderAllMessages } from '../ui/conversation-view.js';
import { getDefaultPromptText } from '../features/custom-prompt.js';
import { requestNotificationPermission } from '../features/notifications.js';
import { openScheduleEditor } from '../features/schedule-editor.js';
import { generateSchedule } from '../features/schedule.js';
import { openStatusPicker, refreshStatus } from '../features/status.js';
import { openTimeEditor } from '../features/custom-time.js';
import { startAutonomousPolling, stopAutonomousPolling, forceAutonomousMessage } from '../features/autonomous.js';
import { refreshHeader } from '../ui/header-bar.js';

/**
 * Initialize the settings panel: populate controls, bind change handlers.
 */
export function initSettingsPanel() {
    const settings = getSettings();

    // --- General ---
    bindCheckbox('conv_enabled', isConversationEnabled(), (val) => {
        setConversationEnabled(val);
        if (val) {
            refreshHeader();
            renderAllMessages();
            showPhone();
        } else {
            hidePhone();
        }
    });

    bindSelect('conv_display_mode', settings.displayMode, (val) => {
        settings.displayMode = val;
        saveSettings();
        applyDisplayMode();
    });

    bindCheckbox('conv_enter_to_send', settings.enterToSend, (val) => {
        settings.enterToSend = val;
        saveSettings();
    });

    bindCheckbox('conv_show_char_name', settings.showCharacterName, (val) => {
        settings.showCharacterName = val;
        saveSettings();
        renderAllMessages();
    });

    bindSelect('conv_theme', settings.theme, (val) => {
        settings.theme = val;
        saveSettings();
        applyDisplayMode();
        applyColors(); // Re-evaluate inline colors after theme class change
    });

    // --- Appearance ---
    bindColor('conv_user_bubble_color', settings.userBubbleColor, (val) => {
        settings.userBubbleColor = val;
        saveSettings();
        applyColors();
    });

    bindColor('conv_assistant_bubble_color', settings.assistantBubbleColor, (val) => {
        settings.assistantBubbleColor = val;
        saveSettings();
        applyColors();
    });

    bindColor('conv_bg_color', settings.backgroundColor, (val) => {
        settings.backgroundColor = val;
        saveSettings();
        applyColors();
    });

    bindSelect('conv_bubble_shape', settings.bubbleShape, (val) => {
        settings.bubbleShape = val;
        saveSettings();
        renderAllMessages();
    });

    bindNumber('conv_phone_width', settings.phoneWidth, (val) => {
        settings.phoneWidth = val;
        saveSettings();
        applyDisplayMode();
    });

    bindNumber('conv_phone_height', settings.phoneHeight, (val) => {
        settings.phoneHeight = val;
        saveSettings();
        applyDisplayMode();
    });

    // --- Stagger ---
    bindCheckbox('conv_stagger_enabled', settings.staggerEnabled, (val) => {
        settings.staggerEnabled = val;
        saveSettings();
    });

    bindRange('conv_stagger_delay', settings.staggerDelay, 'conv_stagger_delay_val', (val) => {
        settings.staggerDelay = val;
        saveSettings();
    });

    bindSelect('conv_stagger_split', settings.staggerSplitMode, (val) => {
        settings.staggerSplitMode = val;
        saveSettings();
    });

    // --- Notifications ---
    bindCheckbox('conv_sound_enabled', settings.soundEnabled, (val) => {
        settings.soundEnabled = val;
        saveSettings();
    });

    bindRange('conv_sound_volume', settings.soundVolume, 'conv_sound_volume_val', (val) => {
        settings.soundVolume = val;
        saveSettings();
    });

    bindCheckbox('conv_browser_notif', settings.browserNotifications, async (val) => {
        if (val) {
            const perm = await requestNotificationPermission();
            if (perm !== 'granted') {
                toastr.warning('Browser notification permission denied');
                val = false;
                const el = document.getElementById('conv_browser_notif');
                if (el) el.checked = false;
            }
        }
        settings.browserNotifications = val;
        saveSettings();
    });

    // --- Custom Prompt ---
    bindCheckbox('conv_custom_prompt_enabled', settings.customPrompt.enabled, (val) => {
        settings.customPrompt.enabled = val;
        saveSettings();
    });

    const promptTextEl = document.getElementById('conv_custom_prompt_text');
    if (promptTextEl) {
        promptTextEl.value = settings.customPrompt.text || '';
        promptTextEl.addEventListener('input', () => {
            settings.customPrompt.text = promptTextEl.value;
            saveSettings();
        });
    }

    bindSelect('conv_prompt_position', String(settings.customPrompt.position), (val) => {
        settings.customPrompt.position = parseInt(val, 10);
        saveSettings();
    });

    bindNumber('conv_prompt_depth', settings.customPrompt.depth, (val) => {
        settings.customPrompt.depth = val;
        saveSettings();
    });

    bindSelect('conv_prompt_role', String(settings.customPrompt.role), (val) => {
        settings.customPrompt.role = parseInt(val, 10);
        saveSettings();
    });

    const resetBtn = document.getElementById('conv_prompt_reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            settings.customPrompt.text = getDefaultPromptText();
            if (promptTextEl) promptTextEl.value = settings.customPrompt.text;
            saveSettings();
            toastr.info('Prompt reset to default');
        });
    }

    // --- Schedule & Status (Phase 2) ---
    const scheduleEditorBtn = document.getElementById('conv_open_schedule_editor');
    if (scheduleEditorBtn) {
        scheduleEditorBtn.addEventListener('click', () => {
            openScheduleEditor();
        });
    }

    const generateScheduleBtn = document.getElementById('conv_generate_schedule');
    if (generateScheduleBtn) {
        generateScheduleBtn.addEventListener('click', async () => {
            const result = await generateSchedule();
            if (result) {
                refreshStatus();
            }
        });
    }

    const setStatusBtn = document.getElementById('conv_set_status');
    if (setStatusBtn) {
        setStatusBtn.addEventListener('click', () => {
            openStatusPicker();
        });
    }

    // --- Custom Game Time (Phase 2) ---
    const timeEditorBtn = document.getElementById('conv_open_time_editor');
    if (timeEditorBtn) {
        timeEditorBtn.addEventListener('click', () => {
            openTimeEditor();
        });
    }

    // --- Autonomous Messaging (Phase 2) ---
    bindCheckbox('conv_autonomous_enabled', settings.autonomousEnabled ?? false, (val) => {
        settings.autonomousEnabled = val;
        saveSettings();
        if (val && isConversationEnabled()) {
            startAutonomousPolling();
        } else {
            stopAutonomousPolling();
        }
    });

    const forceAutoBtn = document.getElementById('conv_force_autonomous');
    if (forceAutoBtn) {
        forceAutoBtn.addEventListener('click', async () => {
            if (!isConversationEnabled()) {
                toastr.warning('Enable conversation mode first');
                return;
            }
            toastr.info('Triggering autonomous message...');
            await forceAutonomousMessage();
        });
    }
}

/**
 * Apply custom colors to CSS custom properties.
 * Only overrides colors that the user has explicitly customized away from theme defaults.
 * Otherwise, lets the CSS theme class control the colors.
 */
export function applyColors() {
    const settings = getSettings();
    const phone = document.getElementById('conv-phone');
    if (!phone) return;

    // Determine which theme is active
    const isDark = phone.classList.contains('conv-theme-dark');

    // Default colors per theme
    const lightDefaults = {
        userBubbleColor: '#007AFF',
        assistantBubbleColor: '#E9E9EB',
        backgroundColor: '#FFFFFF',
    };
    const darkDefaults = {
        userBubbleColor: '#007AFF',
        assistantBubbleColor: '#2C2C2E',
        backgroundColor: '#000000',
    };
    const defaults = isDark ? darkDefaults : lightDefaults;

    // For each color: if the user's setting matches the *opposite* theme default
    // (meaning they never customized it), remove the inline override so the
    // CSS class takes effect. If the user DID customize, set it inline.
    applyOrRemoveColor(phone, '--conv-user-bubble-color', settings.userBubbleColor, defaults.userBubbleColor, lightDefaults.userBubbleColor);
    applyOrRemoveColor(phone, '--conv-assistant-bubble-color', settings.assistantBubbleColor, defaults.assistantBubbleColor, lightDefaults.assistantBubbleColor);
    applyOrRemoveColor(phone, '--conv-bg-color', settings.backgroundColor, defaults.backgroundColor, lightDefaults.backgroundColor);
}

/**
 * Set an inline CSS variable only if the user's value differs from the theme default.
 * If the value equals the light-theme default and the user hasn't deliberately overridden it,
 * remove the inline style so the CSS class (dark/light) can take effect.
 */
function applyOrRemoveColor(el, prop, userValue, themeDefault, lightDefault) {
    const normalized = userValue?.toUpperCase();
    const normalizedLight = lightDefault?.toUpperCase();
    const normalizedTheme = themeDefault?.toUpperCase();

    // If user value is the light default, they probably haven't customized it —
    // let the CSS theme class control it
    if (normalized === normalizedLight || normalized === normalizedTheme) {
        el.style.removeProperty(prop);
    } else {
        // User explicitly set a custom color — apply inline
        el.style.setProperty(prop, userValue);
    }
}

// --- Binding helpers ---

function bindCheckbox(id, initialValue, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!initialValue;
    el.addEventListener('change', () => onChange(el.checked));
}

function bindSelect(id, initialValue, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = initialValue;
    el.addEventListener('change', () => onChange(el.value));
}

function bindColor(id, initialValue, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = initialValue;
    el.addEventListener('input', () => onChange(el.value));
}

function bindNumber(id, initialValue, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = initialValue;
    el.addEventListener('change', () => onChange(parseInt(el.value, 10)));
}

function bindRange(id, initialValue, labelId, onChange) {
    const el = document.getElementById(id);
    const label = document.getElementById(labelId);
    if (!el) return;
    el.value = initialValue;
    if (label) label.textContent = initialValue;
    el.addEventListener('input', () => {
        const val = parseInt(el.value, 10);
        if (label) label.textContent = val;
        onChange(val);
    });
}
