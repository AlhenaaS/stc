/**
 * Settings module: binds settings UI controls to extension settings.
 */

import { getSettings, saveSettings, isConversationEnabled, setConversationEnabled, DEFAULT_SETTINGS } from './state.js';
import { applyDisplayMode, showPhone, hidePhone } from '../ui/phone-window.js';
import { renderAllMessages } from '../ui/conversation-view.js';
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

    // --- Custom Prompt Injection ---
    bindCheckbox('conv_custom_prompt_enabled', settings.customPrompt.enabled, (val) => {
        settings.customPrompt.enabled = val;
        saveSettings();
    });

    // Sync customPrompt.text from prompts.conversationSystem if empty (migration)
    if (!settings.customPrompt.text && settings.prompts?.conversationSystem) {
        settings.customPrompt.text = settings.prompts.conversationSystem;
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

    // --- Prompt Templates ---
    initPromptEditors(settings);

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

// ================================================================
// Prompt Templates System
// ================================================================

const PROMPT_KEYS = [
    'conversationSystem',
    'scheduleGeneration',
    'autonomousMessage',
    'contextBlock',
    'sceneCreation',
    'crossMemoryConversation',
    'crossMemoryScene',
];

/**
 * Initialize prompt template editors and preset controls.
 */
function initPromptEditors(settings) {
    if (!settings.prompts) {
        settings.prompts = structuredClone(DEFAULT_SETTINGS.prompts);
    }

    // Populate each textarea with current value
    for (const key of PROMPT_KEYS) {
        const el = document.getElementById(`conv_prompt_${key}`);
        if (!el) continue;
        el.value = settings.prompts[key] ?? DEFAULT_SETTINGS.prompts[key] ?? '';
        el.addEventListener('input', () => {
            settings.prompts[key] = el.value;
            // Keep conversationSystem in sync with customPrompt.text
            if (key === 'conversationSystem') {
                settings.customPrompt.text = el.value;
            }
            settings.activePreset = null;
            updatePresetSelect(settings);
            saveSettings();
        });
    }

    // Individual reset buttons
    document.querySelectorAll('.conv-prompt-reset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.promptKey;
            if (!key || !DEFAULT_SETTINGS.prompts[key]) return;
            settings.prompts[key] = DEFAULT_SETTINGS.prompts[key];
            const el = document.getElementById(`conv_prompt_${key}`);
            if (el) el.value = settings.prompts[key];
            if (key === 'conversationSystem') {
                settings.customPrompt.text = settings.prompts[key];
            }
            saveSettings();
            toastr.info(`"${key}" reset to default`);
        });
    });

    // Preset controls
    initPresetControls(settings);
}

/**
 * Initialize preset save/load/delete/export/import controls.
 */
function initPresetControls(settings) {
    if (!settings.promptPresets) settings.promptPresets = {};

    const selectEl = document.getElementById('conv_prompt_preset_select');
    if (!selectEl) return;

    // Populate preset dropdown
    updatePresetSelect(settings);

    // Load preset on select change
    selectEl.addEventListener('change', () => {
        const name = selectEl.value;
        if (!name) {
            settings.activePreset = null;
            saveSettings();
            return;
        }
        const preset = settings.promptPresets[name];
        if (!preset) return;
        // Apply preset prompts
        for (const key of PROMPT_KEYS) {
            if (preset[key] !== undefined) {
                settings.prompts[key] = preset[key];
                const el = document.getElementById(`conv_prompt_${key}`);
                if (el) el.value = settings.prompts[key];
            }
        }
        settings.customPrompt.text = settings.prompts.conversationSystem;
        settings.activePreset = name;
        saveSettings();
        toastr.info(`Preset "${name}" loaded`);
    });

    // Save preset
    const saveBtn = document.getElementById('conv_prompt_preset_save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const name = prompt('Enter preset name:', settings.activePreset || '');
            if (!name) return;
            const presetData = {};
            for (const key of PROMPT_KEYS) {
                presetData[key] = settings.prompts[key];
            }
            settings.promptPresets[name] = presetData;
            settings.activePreset = name;
            updatePresetSelect(settings);
            saveSettings();
            toastr.success(`Preset "${name}" saved`);
        });
    }

    // Delete preset
    const deleteBtn = document.getElementById('conv_prompt_preset_delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const name = selectEl.value;
            if (!name) {
                toastr.warning('Select a preset to delete');
                return;
            }
            if (!confirm(`Delete preset "${name}"?`)) return;
            delete settings.promptPresets[name];
            if (settings.activePreset === name) settings.activePreset = null;
            updatePresetSelect(settings);
            saveSettings();
            toastr.info(`Preset "${name}" deleted`);
        });
    }

    // Export prompts as JSON
    const exportBtn = document.getElementById('conv_prompt_preset_export');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const data = {};
            for (const key of PROMPT_KEYS) {
                data[key] = settings.prompts[key];
            }
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conv-prompts-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Import prompts from JSON
    const importBtn = document.getElementById('conv_prompt_preset_import');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    let imported = 0;
                    for (const key of PROMPT_KEYS) {
                        if (typeof data[key] === 'string') {
                            settings.prompts[key] = data[key];
                            const el = document.getElementById(`conv_prompt_${key}`);
                            if (el) el.value = data[key];
                            imported++;
                        }
                    }
                    settings.customPrompt.text = settings.prompts.conversationSystem;
                    settings.activePreset = null;
                    updatePresetSelect(settings);
                    saveSettings();
                    toastr.success(`Imported ${imported} prompts`);
                } catch (e) {
                    toastr.error(`Import failed: ${e.message}`);
                }
            });
            input.click();
        });
    }
}

/**
 * Update the preset dropdown to reflect current state.
 */
function updatePresetSelect(settings) {
    const selectEl = document.getElementById('conv_prompt_preset_select');
    if (!selectEl) return;
    const current = settings.activePreset || '';
    selectEl.innerHTML = '<option value="">-- Custom (unsaved) --</option>';
    for (const name of Object.keys(settings.promptPresets || {})) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        selectEl.appendChild(opt);
    }
    selectEl.value = current;
}
