/**
 * Conversation View: renders the full message list, handles message events,
 * streaming, and message actions.
 */

import { getSettings, getState, setState } from '../core/state.js';
import { mapAllMessages, mapSingleMessage, splitForStagger } from '../utils/message-mapper.js';
import { scrollToBottom, isNearBottom } from '../utils/dom-helpers.js';
import { isDifferentDay } from '../utils/time-helpers.js';
import { createBubble, updateBubbleContent, addStreamingCursor, removeStreamingCursor, showActionMenu } from './message-bubble.js';
import { createDaySeparator } from './day-separator.js';
import { showTypingIndicator, hideTypingIndicator } from './typing-indicator.js';
import { applyStagger, cancelStagger } from '../features/stagger.js';
import { sanitizeHtml } from '../utils/dom-helpers.js';

let messagesEl = null;

/** Cached showdown converter instance (reused across renders) */
let showdownConverter = null;

/**
 * Get or create the showdown converter (cached).
 * @returns {object|null}
 */
function getShowdownConverter() {
    if (showdownConverter) return showdownConverter;
    try {
        const { showdown } = SillyTavern.libs;
        if (showdown) {
            showdownConverter = new showdown.Converter({
                simpleLineBreaks: true,
                literalMidWordUnderscores: true,
                strikethrough: true,
                tables: true,
            });
            return showdownConverter;
        }
    } catch { /* fallback */ }
    return null;
}

/**
 * Initialize the conversation view.
 */
export function initConversationView() {
    messagesEl = document.getElementById('conv-messages');
    if (!messagesEl) return;

    // Track user scroll position
    messagesEl.addEventListener('scroll', () => {
        const nearBottom = isNearBottom(messagesEl);
        setState('userScrolledUp', !nearBottom);

        const newMsgBtn = document.getElementById('conv-new-messages-btn');
        if (newMsgBtn && nearBottom) {
            newMsgBtn.style.display = 'none';
        }
    });

    // New messages button
    const newMsgBtn = document.getElementById('conv-new-messages-btn');
    if (newMsgBtn) {
        newMsgBtn.addEventListener('click', () => {
            scrollToBottom(messagesEl);
            newMsgBtn.style.display = 'none';
        });
    }
}

/**
 * Full re-render of all messages from ST chat.
 */
export function renderAllMessages() {
    if (!messagesEl) return;

    cancelStagger(); // Cancel any in-progress stagger
    hideTypingIndicator(); // Reset typing state on full re-render
    setState('streamingBubble', null);
    setState('isGenerating', false);

    const context = SillyTavern.getContext();
    const messages = mapAllMessages(context.chat);
    setState('messages', messages);

    messagesEl.innerHTML = '';

    let lastDate = null;

    const settings = getSettings();

    messages.forEach((msg) => {
        // Day separator
        if (lastDate && isDifferentDay(lastDate, msg.timestamp)) {
            messagesEl.appendChild(createDaySeparator(msg.timestamp));
        } else if (!lastDate) {
            messagesEl.appendChild(createDaySeparator(msg.timestamp));
        }
        lastDate = msg.timestamp;

        // For assistant messages with stagger enabled, split into multiple bubbles
        // so that each paragraph/line appears as a separate bubble (same as during generation)
        if (msg.role === 'assistant' && settings.staggerEnabled) {
            const parts = splitForStagger(msg.content, settings.staggerSplitMode);
            if (parts.length > 1) {
                const lastIdx = parts.length - 1;

                // First part — uses the original message (inherits isGroupStart)
                // Hide time on first part; it goes on the last part
                const firstPartMsg = {
                    ...msg,
                    content: parts[0],
                    htmlContent: formatMessageContent(parts[0]),
                    showTime: false,
                };
                const firstBubble = createBubble(firstPartMsg);
                setupBubbleActions(firstBubble, msg); // actions reference the full message
                messagesEl.appendChild(firstBubble);

                // Remaining parts — grouped with the first (isGroupStart: false)
                for (let i = 1; i < parts.length; i++) {
                    const partMsg = {
                        ...msg,
                        id: `${msg.id}_stagger_${i}`,
                        content: parts[i],
                        htmlContent: formatMessageContent(parts[i]),
                        isGroupStart: false,
                        showTime: i === lastIdx, // time only on the last bubble
                    };
                    const partBubble = createBubble(partMsg);
                    setupBubbleActions(partBubble, msg);
                    messagesEl.appendChild(partBubble);
                }
                return; // Skip the default single-bubble render below
            }
        }

        // Format HTML content using ST's messageFormatting if available
        msg.htmlContent = formatMessageContent(msg.content);

        // Create and append bubble
        const bubbleEl = createBubble(msg);
        setupBubbleActions(bubbleEl, msg);
        messagesEl.appendChild(bubbleEl);
    });

    // Scroll to bottom (no animation for initial render)
    scrollToBottom(messagesEl, false);
}

/**
 * Add a new message to the view (not a full re-render).
 * @param {object} stMsg - The ST message object
 * @param {number} index - Index in context.chat
 * @param {object} [options]
 * @param {boolean} [options.isNew=false] - Whether this is a newly received message (apply stagger)
 * @param {boolean} [options.isStreaming=false] - Whether this is a streaming message
 */
export function addMessage(stMsg, index, options = {}) {
    if (!messagesEl) return;

    // Prevent duplicate rendering: check if this index already has a bubble
    const existing = messagesEl.querySelector(`[data-st-index="${index}"]`);
    if (existing && !options.isStreaming) return;
    // If streaming and bubble already exists, just update it
    if (existing && options.isStreaming) {
        setState('streamingBubble', existing);
        return;
    }

    const msg = mapSingleMessage(stMsg, index);
    if (!msg) return;

    // Check grouping with previous message
    const allMessages = getState('messages') || [];
    if (allMessages.length > 0) {
        const prev = allMessages[allMessages.length - 1];
        const sameAuthor = prev.characterName === msg.characterName && prev.role === msg.role;
        const withinThreshold = (msg.timestamp - prev.timestamp) < 5 * 60 * 1000;
        msg.isGroupStart = !(sameAuthor && withinThreshold);
    }

    msg.htmlContent = formatMessageContent(msg.content);
    allMessages.push(msg);
    setState('messages', allMessages);

    // Day separator if needed
    const prevMsg = allMessages.length > 1 ? allMessages[allMessages.length - 2] : null;
    if (prevMsg && isDifferentDay(prevMsg.timestamp, msg.timestamp)) {
        messagesEl.appendChild(createDaySeparator(msg.timestamp));
    }

    const bubbleEl = createBubble(msg);
    setupBubbleActions(bubbleEl, msg);

    if (options.isStreaming) {
        addStreamingCursor(bubbleEl);
        setState('streamingBubble', bubbleEl);
    }

    messagesEl.appendChild(bubbleEl);

    // Stagger for new assistant messages
    const settings = getSettings();
    if (options.isNew && msg.role === 'assistant' && settings.staggerEnabled && !options.isStreaming) {
        applyStagger(msg, bubbleEl, messagesEl);
    } else if (!getState('userScrolledUp')) {
        scrollToBottom(messagesEl);
    } else {
        showNewMessageIndicator();
    }
}

/**
 * Update a streaming message in progress.
 * @param {string} newContent
 */
export function updateStreamingMessage(newContent) {
    const bubbleEl = getState('streamingBubble');
    if (!bubbleEl) return;

    const htmlContent = formatMessageContent(newContent);
    updateBubbleContent(bubbleEl, htmlContent);
    addStreamingCursor(bubbleEl);

    if (!getState('userScrolledUp')) {
        scrollToBottom(messagesEl);
    }
}

/**
 * Finalize a streaming message (remove cursor, apply stagger if needed).
 */
export function finalizeStreamingMessage() {
    const bubbleEl = getState('streamingBubble');
    if (!bubbleEl) {
        setState('streamingBubble', null);
        return;
    }

    removeStreamingCursor(bubbleEl);
    setState('streamingBubble', null);

    // Apply stagger to the finalized message if enabled
    const settings = getSettings();
    if (settings.staggerEnabled && messagesEl) {
        const stIndex = bubbleEl.dataset?.stIndex;
        const allMessages = getState('messages') || [];
        const msg = allMessages.find(m => String(m.stIndex) === String(stIndex));
        if (msg && msg.role === 'assistant') {
            // Re-read the final content from ST chat (streaming may have updated it)
            const context = SillyTavern.getContext();
            const stMsg = context.chat[msg.stIndex];
            if (stMsg) {
                msg.content = stMsg.mes || '';
                msg.htmlContent = formatMessageContent(msg.content);
                updateBubbleContent(bubbleEl, msg.htmlContent);
            }
            applyStagger(msg, bubbleEl, messagesEl);
        }
    }
}

/**
 * Update a specific message bubble by ST index.
 * @param {number} stIndex
 */
export function updateMessageByIndex(stIndex) {
    if (!messagesEl) return;
    const context = SillyTavern.getContext();
    const stMsg = context.chat[stIndex];
    if (!stMsg) return;

    const bubbleEl = messagesEl.querySelector(`[data-st-index="${stIndex}"]`);
    if (!bubbleEl) {
        // Message not found, do full re-render
        renderAllMessages();
        return;
    }

    const htmlContent = formatMessageContent(stMsg.mes);
    updateBubbleContent(bubbleEl, htmlContent);
}

/**
 * Remove a message by ST index and re-render (indices may shift).
 * @param {number} stIndex
 */
export function removeMessageByIndex(stIndex) {
    // After deletion, indices shift, so full re-render is safest
    renderAllMessages();
}

/**
 * Show "new messages" indicator.
 */
function showNewMessageIndicator() {
    const btn = document.getElementById('conv-new-messages-btn');
    if (btn) btn.style.display = 'flex';
}

/**
 * Setup hover/long-press action menu for a bubble.
 * @param {HTMLElement} bubbleEl
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 */
function setupBubbleActions(bubbleEl, msg) {
    if (msg.role === 'system' || msg.role === 'narrator') return;

    // Desktop: right-click context menu
    bubbleEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showActionMenu(bubbleEl, msg, createActionCallbacks(msg));
    });

    // Desktop: long press with mouse (hold for 500ms)
    let mouseLongPressTimer = null;
    let mouseDidLongPress = false;
    bubbleEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left button
        mouseDidLongPress = false;
        mouseLongPressTimer = setTimeout(() => {
            mouseDidLongPress = true;
            showActionMenu(bubbleEl, msg, createActionCallbacks(msg));
        }, 500);
    });
    bubbleEl.addEventListener('mouseup', () => {
        clearTimeout(mouseLongPressTimer);
    });
    bubbleEl.addEventListener('mouseleave', () => {
        clearTimeout(mouseLongPressTimer);
    });

    // Mobile: long press via touch
    let longPressTimer = null;
    bubbleEl.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
            showActionMenu(bubbleEl, msg, createActionCallbacks(msg));
        }, 500);
    }, { passive: true });
    bubbleEl.addEventListener('touchend', () => clearTimeout(longPressTimer));
    bubbleEl.addEventListener('touchmove', () => clearTimeout(longPressTimer));
}

/**
 * Create callbacks for message actions.
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 * @returns {object}
 */
function createActionCallbacks(msg) {
    return {
        onCopy: () => {
            navigator.clipboard.writeText(msg.content).then(() => {
                toastr.info('Copied to clipboard');
            }).catch(() => {
                toastr.error('Failed to copy');
            });
        },
        onEdit: () => {
            editMessage(msg);
        },
        onRegenerate: () => {
            // Trigger ST's native regeneration via UI button (most reliable method)
            $('#option_regenerate').trigger('click');
        },
        onDelete: () => {
            deleteMessage(msg);
        },
        onSwipeLeft: () => {
            swipeMessage(msg, -1);
        },
        onSwipeRight: () => {
            swipeMessage(msg, 1);
        },
    };
}

/**
 * Edit a message inline.
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 */
function editMessage(msg) {
    const bubbleEl = messagesEl?.querySelector(`[data-st-index="${msg.stIndex}"]`);
    if (!bubbleEl) return;

    const contentEl = bubbleEl.querySelector('.conv-msg-content');
    if (!contentEl) return;

    const originalContent = msg.content;
    const textarea = document.createElement('textarea');
    textarea.className = 'conv-edit-textarea';
    textarea.value = originalContent;
    textarea.rows = 3;

    contentEl.replaceWith(textarea);
    textarea.focus();

    let saved = false;

    const save = () => {
        if (saved) return; // Prevent double-save from blur + Enter
        saved = true;

        const newText = textarea.value;
        const context = SillyTavern.getContext();
        if (context.chat[msg.stIndex]) {
            context.chat[msg.stIndex].mes = newText;
            // Also update swipes array to keep in sync
            if (context.chat[msg.stIndex].swipes) {
                context.chat[msg.stIndex].swipes[context.chat[msg.stIndex].swipe_id || 0] = newText;
            }
            // saveChat = saveChatConditional (async full save)
            context.saveChat();
        }

        msg.content = newText;
        msg.htmlContent = formatMessageContent(newText);

        const newContentEl = document.createElement('div');
        newContentEl.className = 'conv-msg-content';
        newContentEl.innerHTML = sanitizeHtml(msg.htmlContent);
        textarea.replaceWith(newContentEl);
    };

    const cancel = () => {
        if (saved) return;
        saved = true;

        const newContentEl = document.createElement('div');
        newContentEl.className = 'conv-msg-content';
        newContentEl.innerHTML = sanitizeHtml(formatMessageContent(originalContent));
        textarea.replaceWith(newContentEl);
    };

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            cancel();
        }
    });

    textarea.addEventListener('blur', save);
}

/**
 * Delete a message via ST's deleteMessage API.
 * This properly handles UI update, event emission, and chat save.
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 */
async function deleteMessage(msg) {
    const context = SillyTavern.getContext();
    if (!context.chat[msg.stIndex]) return;

    // Use ST's built-in deleteMessage (handles DOM, events, save)
    await context.deleteMessage(msg.stIndex);

    // Re-render our view (indices shifted after deletion)
    renderAllMessages();
}

/**
 * Swipe a message left or right using ST's swipe API.
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 * @param {number} direction - -1 for left, +1 for right
 */
async function swipeMessage(msg, direction) {
    const context = SillyTavern.getContext();
    const stMsg = context.chat[msg.stIndex];
    if (!stMsg || !stMsg.swipes) return;

    const newId = (stMsg.swipe_id || 0) + direction;
    if (newId < 0 || newId >= stMsg.swipes.length) return;

    // Use ST's swipe API — handles DOM, events, save
    try {
        await context.swipe.to(null, direction > 0 ? 'right' : 'left', {
            message: stMsg,
            forceSwipeId: newId,
        });
    } catch (e) {
        console.warn('[Conversation] Swipe via API failed, using manual fallback:', e);
        // Fallback: manual swipe
        stMsg.swipe_id = newId;
        stMsg.mes = stMsg.swipes[newId];
        context.saveChat();
    }

    // Update our internal state and re-render the bubble
    msg.swipeId = stMsg.swipe_id || 0;
    msg.content = stMsg.mes;
    msg.htmlContent = formatMessageContent(stMsg.mes);

    const bubbleEl = messagesEl?.querySelector(`[data-st-index="${msg.stIndex}"]`);
    if (bubbleEl) {
        updateBubbleContent(bubbleEl, msg.htmlContent);
        const swipeEl = bubbleEl.querySelector('.conv-msg-swipe');
        if (swipeEl) {
            swipeEl.textContent = `${msg.swipeId + 1}/${msg.swipeCount}`;
        }
    }
}

/**
 * Format message content (markdown -> HTML).
 * Uses cached showdown converter for efficiency.
 * @param {string} rawContent
 * @returns {string}
 */
function formatMessageContent(rawContent) {
    if (!rawContent) return '';

    const converter = getShowdownConverter();
    if (converter) {
        return converter.makeHtml(rawContent);
    }

    // Fallback: basic escaping + line breaks
    return rawContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}
