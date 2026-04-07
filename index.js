/**
 * SillyTavern-Conversation
 * iPhone Messages-style chat extension for SillyTavern.
 *
 * Entry point: loaded as ES module by SillyTavern extension system.
 */

import { getSettings, isConversationEnabled, MODULE_NAME } from './src/core/state.js';
import { bindEvents } from './src/core/events.js';
import { initSettingsPanel, applyColors } from './src/core/settings.js';
import { registerCommands } from './src/core/commands.js';
import { initPhoneWindow, showPhone, minimizePhone } from './src/ui/phone-window.js';
import { initConversationView, renderAllMessages } from './src/ui/conversation-view.js';
import { initHeaderBar, refreshHeader } from './src/ui/header-bar.js';
import { initInputBar, loadDrafts, restoreDraft } from './src/ui/input-bar.js';
import { initNotifications } from './src/features/notifications.js';
import { skipStagger } from './src/features/stagger.js';
import { initCustomTime } from './src/features/custom-time.js';
import { refreshStatus, startStatusPolling } from './src/features/status.js';
import { startAutonomousPolling } from './src/features/autonomous.js';
import { initMentionAutocomplete } from './src/ui/mention-autocomplete.js';
import { openEmojiPicker } from './src/ui/emoji-picker.js';

const extensionName = 'SillyTavern-Conversation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

/**
 * Main initialization — runs when the extension is loaded.
 */
async function init() {
    console.log('[Conversation] Initializing...');

    // Ensure settings are initialized
    getSettings();

    // Inject settings panel HTML
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
    } catch (e) {
        console.error('[Conversation] Failed to load settings HTML:', e);
    }

    // Inject phone frame HTML
    try {
        const phoneHtml = await $.get(`${extensionFolderPath}/phone-frame.html`);
        $('body').append(phoneHtml);
    } catch (e) {
        console.error('[Conversation] Failed to load phone frame HTML:', e);
    }

    // Initialize all components
    initPhoneWindow();
    initConversationView();
    initHeaderBar();
    initInputBar({
        onSend: handleSendMessage,
        onStop: handleStopGeneration,
    });
    initSettingsPanel();
    applyColors();

    // Load saved drafts from localStorage
    loadDrafts();

    // Register slash commands
    registerCommands();

    // Bind SillyTavern events
    bindEvents();

    // Initialize notification sounds
    initNotifications();

    // Setup typing indicator skip (click to skip stagger)
    const typingEl = document.getElementById('conv-typing');
    if (typingEl) {
        typingEl.addEventListener('click', skipStagger);
        typingEl.style.cursor = 'pointer';
        typingEl.title = 'Click to skip';
    }

    // Phase 2: Init mention autocomplete on the input textarea
    const textarea = document.getElementById('conv-input-textarea');
    if (textarea) {
        initMentionAutocomplete(textarea);
    }

    // Phase 2: Emoji picker button
    const emojiBtn = document.getElementById('conv-btn-emoji');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
            openEmojiPicker(emojiBtn, (emoji) => {
                if (textarea) {
                    const pos = textarea.selectionStart;
                    textarea.value = textarea.value.substring(0, pos) + emoji + textarea.value.substring(pos);
                    textarea.selectionStart = textarea.selectionEnd = pos + emoji.length;
                    textarea.focus();
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        });
    }

    // Check if conversation mode is already enabled for current chat
    if (isConversationEnabled()) {
        refreshHeader();
        renderAllMessages();
        restoreDraft();

        // On mobile start minimized (floating bubble) so user can tap to open
        if (window.innerWidth <= 768) {
            minimizePhone();
        } else {
            showPhone();
        }

        // Phase 2: init time, status, autonomous for current chat
        initCustomTime();
        refreshStatus();
        startStatusPolling();

        const settings = getSettings();
        if (settings.autonomousEnabled) {
            startAutonomousPolling();
        }
    }

    console.log('[Conversation] Initialized successfully');
}

/**
 * Handle sending a user message.
 * Uses jQuery to set the ST textarea value and trigger send,
 * because ST's internal handlers listen for jQuery events.
 * @param {string} text
 */
function handleSendMessage(text) {
    if (!text) return;

    // Use jQuery to set value (ST relies on jQuery events)
    const $textarea = $('#send_textarea');
    if ($textarea.length) {
        $textarea.val(text).trigger('input');
        // Trigger ST's send button via jQuery click
        $('#send_but').trigger('click');
    }
}

/**
 * Handle stopping generation.
 */
function handleStopGeneration() {
    // Trigger ST's stop button via jQuery
    $('#mes_stop').trigger('click');
}

// --- Lifecycle ---

// APP_READY auto-fires for late listeners, so this is safe even if
// the extension loads after APP_READY has already been emitted.
// We avoid wrapping in jQuery() to prevent unnecessary delays.
(function bootstrap() {
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.APP_READY, () => {
        init();
    });
})();
