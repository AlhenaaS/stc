/**
 * Events module: subscribes to SillyTavern events and dispatches to extension handlers.
 */

import { getSettings, getState, setState, isConversationEnabled } from './state.js';
import { renderAllMessages, addMessage, updateStreamingMessage, finalizeStreamingMessage, updateMessageByIndex, removeMessageByIndex } from '../ui/conversation-view.js';
import { showTypingIndicator, hideTypingIndicator } from '../ui/typing-indicator.js';
import { updateSendButton } from '../ui/input-bar.js';
import { refreshHeader } from '../ui/header-bar.js';
import { restoreDraft } from '../ui/input-bar.js';
import { showPhone, hidePhone, minimizePhone, updateBadge } from '../ui/phone-window.js';
import { playNotificationSound, showBrowserNotification } from '../features/notifications.js';
import { injectCustomPrompt, removeCustomPrompt } from '../features/custom-prompt.js';
import { cancelStagger } from '../features/stagger.js';
import { advanceTimeOnMessage } from '../features/custom-time.js';
import { initCustomTime, stopRealtimeUpdates } from '../features/custom-time.js';
import { refreshStatus, startStatusPolling, stopStatusPolling } from '../features/status.js';
import { startAutonomousPolling, stopAutonomousPolling } from '../features/autonomous.js';
import { onBeforeCombinePrompts, onAfterGenerateData, injectContextBlock, removeContextBlock, injectTimestampsIntoMessages } from '../features/context-injection.js';
import { stampMessage, stampAllMessages } from '../utils/time-helpers.js';

let eventsBound = false;

/**
 * Bind all SillyTavern event listeners.
 */
export function bindEvents() {
    if (eventsBound) return;

    const { eventSource, event_types } = SillyTavern.getContext();

    // App lifecycle
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Messages
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);

    // Generation
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);

    // Streaming
    if (event_types.STREAM_TOKEN_RECEIVED) {
        eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamToken);
    }

    // Generation hooks for prompt injection
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);

    // Prompt composition hooks (suppress RP system prompt, inject context)
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
    eventSource.removeListener(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.removeListener(event_types.GENERATION_STOPPED, onGenerationStopped);

    if (event_types.STREAM_TOKEN_RECEIVED) {
        eventSource.removeListener(event_types.STREAM_TOKEN_RECEIVED, onStreamToken);
    }

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
        // Stamp any unstamped messages in the chat history
        const context = SillyTavern.getContext();
        const stamped = stampAllMessages(context.chat);
        if (stamped > 0) {
            console.log(`[Conversation] Stamped ${stamped} messages on chat load`);
            context.saveChat();
        }

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

function onMessageReceived(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;

    const context = SillyTavern.getContext();
    const stMsg = context.chat[messageIndex];
    if (!stMsg) return;

    console.log('[Conversation] Message received:', messageIndex);

    // Stamp the message: [HH:MM] in mes, clean text in extra.display_text
    if (stampMessage(stMsg)) {
        context.saveChat();
    }

    hideTypingIndicator();

    // If we were streaming this message, just finalize the streaming bubble
    // instead of adding a new one (prevents duplicate bubbles)
    if (getState('streamingBubble')) {
        finalizeStreamingMessage();
    } else {
        addMessage(stMsg, messageIndex, { isNew: true });
    }

    setState('isGenerating', false);
    updateSendButton(false);

    // Increment unread count if minimized
    if (getState('isMinimized')) {
        setState('unreadCount', (getState('unreadCount') || 0) + 1);
        updateBadge();
    }

    playNotificationSound();
    showBrowserNotification(
        stMsg.name || 'New message',
        (stMsg.extra?.display_text || stMsg.mes || '').substring(0, 100),
    );
}

function onMessageSent(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;

    const context = SillyTavern.getContext();
    const stMsg = context.chat[messageIndex];
    if (!stMsg) return;

    console.log('[Conversation] Message sent:', messageIndex);

    // Stamp the message: [HH:MM] in mes, clean text in extra.display_text
    if (stampMessage(stMsg)) {
        context.saveChat();
    }

    addMessage(stMsg, messageIndex, { isNew: false });

    setState('lastUserActivity', Date.now());

    // Phase 2: advance custom game time on user message
    advanceTimeOnMessage();
}

function onMessageEdited(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;
    updateMessageByIndex(messageIndex);
}

function onMessageDeleted(messageIndex) {
    if (!isConversationEnabled() || !getState('isActive')) return;
    removeMessageByIndex(messageIndex);
}

function onGenerationStarted() {
    if (!isConversationEnabled() || !getState('isActive')) return;

    // Delay the check slightly — GENERATION_STARTED may fire before ST updates its UI
    setTimeout(() => {
        // Double-check we're still active and conversation mode is on
        if (!isConversationEnabled() || !getState('isActive')) return;

        // Verify a real generation is happening — check if ST's stop button is visible
        const stopButton = document.getElementById('mes_stop');
        const isReallyGenerating = stopButton
            && getComputedStyle(stopButton).display !== 'none';

        if (!isReallyGenerating) {
            console.log('[Conversation] GENERATION_STARTED fired but no active generation detected, ignoring');
            return;
        }

        setState('isGenerating', true);
        updateSendButton(true);

        const context = SillyTavern.getContext();
        const charName = context.characterId !== undefined
            ? context.characters[context.characterId]?.name
            : '';
        showTypingIndicator(charName);
    }, 100);
}

function onGenerationEnded() {
    if (!isConversationEnabled()) return;

    setState('isGenerating', false);
    updateSendButton(false);
    hideTypingIndicator();
    finalizeStreamingMessage();
}

function onGenerationStopped() {
    if (!isConversationEnabled()) return;

    setState('isGenerating', false);
    updateSendButton(false);
    hideTypingIndicator();
    finalizeStreamingMessage();
    cancelStagger();
}

function onStreamToken(data) {
    if (!isConversationEnabled() || !getState('isActive')) return;

    // During streaming, update the last message bubble
    hideTypingIndicator();

    const context = SillyTavern.getContext();
    const lastMsg = context.chat[context.chat.length - 1];
    if (!lastMsg || lastMsg.is_user) return;

    // If no streaming bubble exists yet, create one
    if (!getState('streamingBubble')) {
        addMessage(lastMsg, context.chat.length - 1, { isNew: false, isStreaming: true });
    } else {
        updateStreamingMessage(lastMsg.mes || '');
    }
}

function onBeforeGeneration() {
    // Inject custom prompt + context block before generation
    injectCustomPrompt();
    injectContextBlock();
}

function onBeforeCombinePromptsHandler(data) {
    // Suppress RP system prompt and inject timestamps
    onBeforeCombinePrompts(data);
    injectTimestampsIntoMessages(data);
}

function onAfterGenerateDataHandler(generateData, dryRun) {
    // Disable reasoning in chat mode
    onAfterGenerateData(generateData, dryRun);
}
