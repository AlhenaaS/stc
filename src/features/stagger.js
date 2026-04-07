/**
 * Staggered Reveal: split assistant messages into multiple bubbles shown with delay.
 */

import { getSettings, getState, setState } from '../core/state.js';
import { splitForStagger } from '../utils/message-mapper.js';
import { scrollToBottom } from '../utils/dom-helpers.js';
import { createBubble } from '../ui/message-bubble.js';
import { showTypingIndicator, hideTypingIndicator } from '../ui/typing-indicator.js';
import { playNotificationSound } from './notifications.js';

/**
 * Apply staggered reveal to a message.
 * The first part is already shown in the initial bubble.
 * Additional parts are revealed one by one with typing indicator between them.
 *
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 * @param {HTMLElement} initialBubbleEl - The already-appended first bubble
 * @param {HTMLElement} messagesEl - The messages container
 */
export async function applyStagger(msg, initialBubbleEl, messagesEl) {
    const settings = getSettings();
    const parts = splitForStagger(msg.content, settings.staggerSplitMode);

    if (parts.length <= 1) {
        // No stagger needed
        if (!getState('userScrolledUp')) scrollToBottom(messagesEl);
        return;
    }

    setState('isStaggering', true);

    // Create an AbortController for skip functionality
    const abort = new AbortController();
    setState('staggerAbort', abort);

    // Update initial bubble to show only the first part
    const contentEl = initialBubbleEl.querySelector('.conv-msg-content');
    if (contentEl) {
        contentEl.innerHTML = formatPartHtml(parts[0]);
    }

    // Move timestamp from first bubble to last — hide it on the initial bubble
    const initialTimeEl = initialBubbleEl.querySelector('.conv-msg-time');
    if (initialTimeEl) initialTimeEl.remove();

    if (!getState('userScrolledUp')) scrollToBottom(messagesEl);

    const lastIdx = parts.length - 1;

    // Reveal remaining parts
    for (let i = 1; i < parts.length; i++) {
        if (abort.signal.aborted) {
            // Skip: show all remaining parts immediately
            showRemainingParts(msg, parts, i, messagesEl);
            break;
        }

        // Show typing indicator
        showTypingIndicator(msg.characterName);

        // Wait for delay (or abort)
        try {
            await waitWithAbort(settings.staggerDelay, abort.signal);
        } catch {
            // Aborted — show all remaining
            hideTypingIndicator();
            showRemainingParts(msg, parts, i, messagesEl);
            break;
        }

        hideTypingIndicator();

        // Create a new bubble for this part
        const partMsg = {
            ...msg,
            id: `${msg.id}_stagger_${i}`,
            content: parts[i],
            htmlContent: formatPartHtml(parts[i]),
            isGroupStart: false, // Grouped with previous
            showTime: i === lastIdx, // Timestamp on the last part only
        };

        const partBubble = createBubble(partMsg);
        messagesEl.appendChild(partBubble);

        playNotificationSound();

        if (!getState('userScrolledUp')) scrollToBottom(messagesEl);
    }

    setState('isStaggering', false);
    setState('staggerAbort', null);
}

/**
 * Cancel an in-progress stagger.
 */
export function cancelStagger() {
    const abort = getState('staggerAbort');
    if (abort) {
        abort.abort();
        setState('staggerAbort', null);
    }
    setState('isStaggering', false);
    hideTypingIndicator();
}

/**
 * Skip the current stagger (show all parts immediately).
 * Can be triggered by clicking the typing indicator.
 */
export function skipStagger() {
    cancelStagger();
}

/**
 * Show all remaining stagger parts at once.
 */
function showRemainingParts(msg, parts, fromIndex, messagesEl) {
    const lastIdx = parts.length - 1;
    for (let i = fromIndex; i < parts.length; i++) {
        const partMsg = {
            ...msg,
            id: `${msg.id}_stagger_${i}`,
            content: parts[i],
            htmlContent: formatPartHtml(parts[i]),
            isGroupStart: false,
            showTime: i === lastIdx,
        };
        const partBubble = createBubble(partMsg);
        messagesEl.appendChild(partBubble);
    }
    if (!getState('userScrolledUp')) scrollToBottom(messagesEl);
}

/**
 * Wait for a delay, but reject if abort signal fires.
 */
function waitWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

/** Cached showdown converter for stagger parts */
let staggerConverter = null;

/**
 * Format a single part's content to HTML.
 */
function formatPartHtml(text) {
    if (!text) return '';
    try {
        if (!staggerConverter) {
            const { showdown } = SillyTavern.libs;
            if (showdown) {
                staggerConverter = new showdown.Converter({
                    simpleLineBreaks: true,
                    literalMidWordUnderscores: true,
                });
            }
        }
        if (staggerConverter) {
            return staggerConverter.makeHtml(text);
        }
    } catch { /* fallback */ }
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
