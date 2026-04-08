/**
 * SillyTavern-Conversation
 * iPhone Messages-style chat extension for SillyTavern.
 *
 * Entry point: loaded as ES module by SillyTavern extension system.
 */

import { getSettings, getState, setState, isConversationEnabled, MODULE_NAME } from './src/core/state.js';
import { bindEvents } from './src/core/events.js';
import { initSettingsPanel, applyColors } from './src/core/settings.js';
import { registerCommands } from './src/core/commands.js';
import { initPhoneWindow, showPhone, minimizePhone, updateBadge } from './src/ui/phone-window.js';
import { initConversationView, renderAllMessages, addMessage } from './src/ui/conversation-view.js';
import { initHeaderBar, refreshHeader } from './src/ui/header-bar.js';
import { initInputBar, loadDrafts, restoreDraft, updateSendButton } from './src/ui/input-bar.js';
import { showTypingIndicator, hideTypingIndicator } from './src/ui/typing-indicator.js';
import { initNotifications, playNotificationSound, showBrowserNotification } from './src/features/notifications.js';
import { skipStagger } from './src/features/stagger.js';
import { initCustomTime, advanceTimeOnMessage } from './src/features/custom-time.js';
import { refreshStatus, startStatusPolling } from './src/features/status.js';
import { startAutonomousPolling } from './src/features/autonomous.js';
import { initMentionAutocomplete } from './src/ui/mention-autocomplete.js';
import { openEmojiPicker } from './src/ui/emoji-picker.js';
import { injectCustomPrompt } from './src/features/custom-prompt.js';
import { injectContextBlock } from './src/features/context-injection.js';
import { formatTimestampForMessage } from './src/utils/time-helpers.js';

const extensionName = 'SillyTavern-Conversation';

// Derive folder path from module URL — works regardless of actual folder name on disk.
// import.meta.url gives us e.g. "https://host/scripts/extensions/third-party/FolderName/index.js"
const extensionFolderPath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

/**
 * Main initialization — runs when the extension is loaded.
 */
async function init() {
    console.log('[Conversation] Initializing...', 'Path:', extensionFolderPath);

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
 *
 * New approach: we bypass ST's native send pipeline entirely.
 * Instead we:
 * 1. Create a user message with [HH:MM] timestamp in `mes` (visible to LLM)
 *    and clean text in `extra.display_text` (visible in UI).
 * 2. Push to chat, render in both ST main view and conversation view.
 * 3. Call generateQuietPrompt to get the response (includes lorebooks, WI, char card,
 *    but NOT the main RP system prompt from presets).
 * 4. Create an assistant message with the same timestamp pattern.
 * 5. Push to chat, render, apply stagger.
 *
 * @param {string} text
 */
async function handleSendMessage(text) {
    if (!text) return;
    if (getState('isGenerating')) return;

    const context = SillyTavern.getContext();
    if (context.characterId === undefined) return;

    const char = context.characters[context.characterId];
    if (!char) return;

    setState('isGenerating', true);
    updateSendButton(true);

    try {
        // --- 1. Create and add user message ---
        const timeStr = formatTimestampForMessage();
        const userMessage = {
            name: context.name1 || 'User',
            is_user: true,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: `[${timeStr}] ${text}`,
            extra: {
                display_text: text,
            },
        };

        // Push to ST chat array
        context.chat.push(userMessage);
        const userIndex = context.chat.length - 1;

        // Render in ST main view
        context.addOneMessage(userMessage, { scroll: true });

        // Render in our conversation view
        addMessage(userMessage, userIndex, { isNew: false });

        // Emit MESSAGE_SENT event for other extensions
        const { eventSource, event_types } = context;
        await eventSource.emit(event_types.MESSAGE_SENT, userIndex);

        // Save chat
        await context.saveChat();

        // Advance custom game time on user message
        advanceTimeOnMessage();

        // Update last user activity for autonomous messages
        setState('lastUserActivity', Date.now());

        // --- 2. Inject our prompts before generation ---
        injectCustomPrompt();
        injectContextBlock();

        // --- 3. Show typing indicator ---
        console.log('[Conversation] About to show typing indicator for:', char.name);
        showTypingIndicator(char.name);
        console.log('[Conversation] Typing indicator shown, starting generation...');

        // --- 4. Generate response via generateQuietPrompt ---
        // This runs the full Generate pipeline (lorebooks, WI, char card, extension prompts)
        // but does NOT add to chat and does NOT stream.
        const settings = getSettings();
        const result = await context.generateQuietPrompt({
            quietPrompt: '',  // No extra quiet prompt — our conversationSystem prompt is already
                              // injected via setExtensionPrompt, and contextBlock is injected too.
            quietToLoud: true, // Character mode — response will be formatted as character speech
            removeReasoning: true,
        });

        console.log('[Conversation] Generation complete, hiding typing indicator');
        hideTypingIndicator();

        if (!result) {
            console.warn('[Conversation] generateQuietPrompt returned empty result');
            setState('isGenerating', false);
            updateSendButton(false);
            return;
        }

        // --- 5. Create and add assistant message ---
        const responseTimeStr = formatTimestampForMessage();
        const responseText = typeof result === 'string' ? result : String(result);

        const assistantMessage = {
            name: char.name,
            is_user: false,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: `[${responseTimeStr}] ${responseText}`,
            extra: {
                display_text: responseText,
            },
            swipe_id: 0,
            swipes: [`[${responseTimeStr}] ${responseText}`],
        };

        // Push to ST chat array
        context.chat.push(assistantMessage);
        const assistantIndex = context.chat.length - 1;

        // Render in ST main view
        context.addOneMessage(assistantMessage, { scroll: true });

        // Render in our conversation view (with stagger)
        addMessage(assistantMessage, assistantIndex, { isNew: true });

        // Emit MESSAGE_RECEIVED event for other extensions
        await eventSource.emit(event_types.MESSAGE_RECEIVED, assistantIndex);

        // Save chat
        await context.saveChat();

        // Increment unread count if minimized
        if (getState('isMinimized')) {
            setState('unreadCount', (getState('unreadCount') || 0) + 1);
            updateBadge();
        }

        // Notifications
        playNotificationSound();
        showBrowserNotification(
            char.name,
            responseText.substring(0, 100),
            char.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}` : undefined,
        );

    } catch (e) {
        console.error('[Conversation] Message send/generate failed:', e);
        hideTypingIndicator();
    } finally {
        setState('isGenerating', false);
        updateSendButton(false);
    }
}

/**
 * Handle stopping generation.
 */
function handleStopGeneration() {
    // Trigger ST's stop button via jQuery (this aborts the ongoing generation)
    $('#mes_stop').trigger('click');
    setState('isGenerating', false);
    updateSendButton(false);
    hideTypingIndicator();
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
