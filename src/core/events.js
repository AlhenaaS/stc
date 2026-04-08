/**
 * Events module: subscribes to SillyTavern events and dispatches to extension handlers.
 */

import { getSettings, getState, setState, isConversationEnabled } from './state.js';
import { renderAllMessages, addMessage, updateMessageByIndex, removeMessageByIndex } from '../ui/conversation-view.js';
import { hideTypingIndicator } from '../ui/typing-indicator.js';
import { refreshHeader } from '../ui/header-bar.js';
import { restoreDraft } from '../ui/input-bar.js';
import { showPhone, hidePhone, minimizePhone, updateBadge } from '../ui/phone-window.js';
import { removeCustomPrompt, injectCustomPrompt } from '../features/custom-prompt.js';
import { cancelStagger } from '../features/stagger.js';
import { initCustomTime, stopRealtimeUpdates } from '../features/custom-time.js';
import { refreshStatus, startStatusPolling, stopStatusPolling } from '../features/status.js';
import { startAutonomousPolling, stopAutonomousPolling } from '../features/autonomous.js';
import { onBeforeCombinePrompts, onAfterGenerateData, injectContextBlock } from '../features/context-injection.js';

let eventsBound = false;

/**
 * Bind all SillyTavern event listeners.
 */
export function bindEvents() {
    if (eventsBound) return;

    const { eventSource, event_types } = SillyTavern.getContext();

    // App lifecycle
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Messages — kept for external triggers (ST native UI, other extensions)
    // Our own handleSendMessage renders directly, so these are fallback-only.
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);

    // Generation hooks for prompt injection
    // These are still needed: generateQuietPrompt runs the full Generate() pipeline
    // which fires GENERATION_AFTER_COMMANDS → we inject custom prompt + context block.
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);

    // Prompt composition hooks (suppress RP system prompt from presets)
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, onBeforeCombinePromptsHandler);
    eventSource.on(event_types.GENERATE_AFTER_DATA, onAfterGenerateDataHandler);

    eventsBound = true;
    console.log('[Conversation] Events bound');
}

/**
 * Unbind all SillyTavern event listeners.
 */
export function unbindEvents() {
    if (!eventsBound) return;

    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.removeListener(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.removeListener(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.removeListener(event_types.MESSAGE_EDITED, onMessageEdited);
    eventSource.removeListener(event_types.MESSAGE_DELETED, onMessageDeleted);
    eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
    eventSource.removeListener(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, onBeforeCombinePromptsHandler);
    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, onAfterGenerateDataHandler);

    eventsBound = false;
    console.log('[Conversation] Events unbound');
}

// --- Event Handlers ---

function onChatChanged() {
    console.log('[Conversation] Chat changed, conversationEnabled:', isConversationEnabled());
    cancelStagger();
    hideTypingIndicator();
    setState('isGenerating', false);
    setState('streamingBubble', null);
    stopRealtimeUpdates();
    stopStatusPolling();
    stopAutonomousPolling();

    if (isConversationEnabled()) {
        refreshHeader();
        renderAllMessages();
        restoreDraft();

        // Respect minimized state: if user had it minimized, keep it minimized.
        // Otherwise show the phone (on mobile, also start minimized first time).
        if (getState('isMinimized')) {
            minimizePhone();
        } else if (window.innerWidth <= 768 && !getState('isActive')) {
            minimizePhone();
        } else {
            showPhone();
        }

        // Phase 2: init time, status, autonomous for this chat
        initCustomTime();
        refreshStatus();
        startStatusPolling();

        const settings = getSettings();
        if (settings.autonomousEnabled) {
            startAutonomousPolling();
        }
    } else {
        hidePhone();
        removeCustomPrompt();
    }
}

/**
 * Handle MESSAGE_RECEIVED from ST.
 * This fires when messages are added through ST's native pipeline (e.g., from other extensions
 * or if the user uses ST's main chat UI directly). Our own handleSendMessage already renders
 * messages directly, so we skip rendering if the message is already in our view.
 */
function onMessageReceived(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;

    const context = SillyTavern.getContext();
    const stMsg = context.chat[messageIndex];
    if (!stMsg) return;

    // addMessage internally checks for duplicates (data-st-index), so this is safe
    addMessage(stMsg, messageIndex, { isNew: true });

    // Notifications for messages we didn't generate ourselves
    // (e.g., from other extensions or ST native UI)
    if (getState('isMinimized')) {
        setState('unreadCount', (getState('unreadCount') || 0) + 1);
        updateBadge();
    }
}

/**
 * Handle MESSAGE_SENT from ST.
 * Same as MESSAGE_RECEIVED — our pipeline already handles this, but this catches
 * messages sent through ST's native UI.
 */
function onMessageSent(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;

    const context = SillyTavern.getContext();
    const stMsg = context.chat[messageIndex];
    if (!stMsg) return;

    // addMessage checks for duplicates
    addMessage(stMsg, messageIndex, { isNew: false });
}

function onMessageEdited(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;
    updateMessageByIndex(messageIndex);
}

function onMessageDeleted(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;
    removeMessageByIndex(messageIndex);
}

function onBeforeGeneration() {
    // Inject custom prompt + context block before generation.
    // This fires for both our generateQuietPrompt calls and any other generation.
    injectCustomPrompt();
    injectContextBlock();
}

function onBeforeCombinePromptsHandler(data) {
    // Suppress RP system prompt from presets in conversation mode
    onBeforeCombinePrompts(data);
}

function onAfterGenerateDataHandler(generateData, dryRun) {
    // Disable reasoning in chat mode
    onAfterGenerateData(generateData, dryRun);
}
