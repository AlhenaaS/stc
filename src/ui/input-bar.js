/**
 * Input Bar: handles text input, send/stop, auto-grow, Enter key behavior, draft saving.
 */

import { getSettings, getState, setState } from '../core/state.js';
import { debounce } from '../utils/dom-helpers.js';

let textareaEl = null;
let sendBtnEl = null;

/** Callback set by conversation-view to handle sending */
let onSendCallback = null;
let onStopCallback = null;

/**
 * Initialize the input bar.
 * @param {object} callbacks
 * @param {Function} callbacks.onSend - Called with message text
 * @param {Function} callbacks.onStop - Called to stop generation
 */
export function initInputBar({ onSend, onStop }) {
    textareaEl = document.getElementById('conv-input-textarea');
    sendBtnEl = document.getElementById('conv-btn-send');
    onSendCallback = onSend;
    onStopCallback = onStop;

    if (!textareaEl || !sendBtnEl) return;

    // Auto-grow textarea
    textareaEl.addEventListener('input', () => {
        autoGrow();
        saveDraft();
    });

    // Send on Enter (if enabled)
    textareaEl.addEventListener('keydown', (e) => {
        const settings = getSettings();
        if (settings.enterToSend && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Send button click
    sendBtnEl.addEventListener('click', () => {
        if (getState('isGenerating')) {
            handleStop();
        } else {
            handleSend();
        }
    });
}

/**
 * Handle sending a message.
 */
function handleSend() {
    if (!textareaEl) return;
    const text = textareaEl.value.trim();
    if (!text) return;
    if (getState('isGenerating')) return;

    textareaEl.value = '';
    autoGrow();
    clearDraft();

    if (onSendCallback) {
        onSendCallback(text);
    }
}

/**
 * Handle stopping generation.
 */
function handleStop() {
    if (onStopCallback) {
        onStopCallback();
    }
}

/**
 * Switch the send button between send and stop modes.
 * @param {boolean} isGenerating
 */
export function updateSendButton(isGenerating) {
    if (!sendBtnEl) return;
    const icon = sendBtnEl.querySelector('i');
    if (icon) {
        icon.className = isGenerating
            ? 'fa-solid fa-stop'
            : 'fa-solid fa-arrow-up';
    }
    sendBtnEl.title = isGenerating ? 'Stop' : 'Send';
}

/**
 * Auto-grow the textarea based on content.
 */
function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = '0'; // Reset to measure true scrollHeight
    const minHeight = 36; // matches CSS min-height
    const maxHeight = 200; // ~6 lines
    const newHeight = Math.max(minHeight, Math.min(textareaEl.scrollHeight, maxHeight));
    textareaEl.style.height = `${newHeight}px`;
}

/**
 * Restore draft for the current chat.
 */
export function restoreDraft() {
    if (!textareaEl) return;
    const chatFile = getCurrentChatFile();
    if (!chatFile) return;

    const drafts = getState('drafts') || {};
    const draft = drafts[chatFile];
    if (draft) {
        textareaEl.value = draft;
        autoGrow();
    } else {
        textareaEl.value = '';
        autoGrow();
    }
}

/**
 * Save current draft.
 */
const saveDraft = debounce(() => {
    if (!textareaEl) return;
    const chatFile = getCurrentChatFile();
    if (!chatFile) return;

    const drafts = getState('drafts') || {};
    drafts[chatFile] = textareaEl.value;
    setState('drafts', drafts);

    // Also save to localStorage for persistence
    try {
        localStorage.setItem('conv_drafts', JSON.stringify(drafts));
    } catch { /* ignore */ }
}, 300);

/**
 * Clear the current chat's draft.
 */
function clearDraft() {
    const chatFile = getCurrentChatFile();
    if (!chatFile) return;
    const drafts = getState('drafts') || {};
    delete drafts[chatFile];
    setState('drafts', drafts);
    try {
        localStorage.setItem('conv_drafts', JSON.stringify(drafts));
    } catch { /* ignore */ }
}

/**
 * Load drafts from localStorage on init.
 */
export function loadDrafts() {
    try {
        const saved = localStorage.getItem('conv_drafts');
        if (saved) {
            setState('drafts', JSON.parse(saved));
        }
    } catch { /* ignore */ }
}

/**
 * Get current chat identifier for draft keying.
 * Uses characterId + groupId combination as a unique key,
 * since chatMetadata doesn't have a reliable chat_file property.
 * @returns {string|null}
 */
function getCurrentChatFile() {
    const context = SillyTavern.getContext();
    // Build a unique identifier for the current chat session
    if (context.groupId) {
        return `group_${context.groupId}`;
    }
    if (context.characterId !== undefined) {
        // Use character name + chat array length as a rough identifier
        const char = context.characters?.[context.characterId];
        const chatId = context.chatMetadata?.chat_id || context.chatMetadata?.chat_file || '';
        return `char_${char?.name || context.characterId}_${chatId}`;
    }
    return null;
}

/**
 * Focus the input textarea.
 */
export function focusInput() {
    if (textareaEl) {
        textareaEl.focus();
    }
}

/**
 * Get the current input text.
 * @returns {string}
 */
export function getInputText() {
    return textareaEl ? textareaEl.value : '';
}

/**
 * Set the input text.
 * @param {string} text
 */
export function setInputText(text) {
    if (textareaEl) {
        textareaEl.value = text;
        autoGrow();
    }
}
