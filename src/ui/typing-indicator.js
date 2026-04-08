/**
 * Typing Indicator component: "Character is typing..." with bouncing dots.
 * Uses CSS class toggle instead of inline display style for reliability.
 */

/**
 * Show the typing indicator.
 * @param {string} [characterName]
 */
export function showTypingIndicator(characterName) {
    const el = document.getElementById('conv-typing');
    const textEl = document.getElementById('conv-typing-text');
    if (!el) return;

    // Debug: log who called this
    console.log('[Conversation] showTypingIndicator called for:', characterName, new Error().stack?.split('\n')[2]?.trim());

    el.classList.add('conv-typing-visible');
    if (textEl && characterName) {
        textEl.textContent = `${characterName} is typing...`;
    }

    // Scroll to bottom if near
    const messagesEl = document.getElementById('conv-messages');
    if (messagesEl) {
        const isNear = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 80;
        if (isNear) {
            messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
        }
    }
}

/**
 * Hide the typing indicator.
 */
export function hideTypingIndicator() {
    const el = document.getElementById('conv-typing');
    if (el) {
        el.classList.remove('conv-typing-visible');
        // Also force inline style as belt-and-suspenders
        el.style.display = '';
    }
}

/**
 * Check if typing indicator is visible.
 * @returns {boolean}
 */
export function isTypingVisible() {
    const el = document.getElementById('conv-typing');
    return el ? el.classList.contains('conv-typing-visible') : false;
}
