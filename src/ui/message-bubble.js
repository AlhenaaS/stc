/**
 * Message Bubble component: renders a single message in iPhone style.
 */

import { sanitizeHtml, createElement } from '../utils/dom-helpers.js';
import { getSettings } from '../core/state.js';

/**
 * Create a message bubble DOM element.
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 * @returns {HTMLElement}
 */
export function createBubble(msg) {
    const settings = getSettings();
    const wrapper = createElement('div', ['conv-msg', `conv-msg-${msg.role}`], {
        'data-msg-id': msg.id,
        'data-st-index': String(msg.stIndex),
    });

    if (msg.isGroupStart) {
        wrapper.classList.add('conv-msg-group-start');
    }

    // System/narrator messages: centered, no bubble
    if (msg.role === 'system' || msg.role === 'narrator') {
        const systemEl = createElement('div', 'conv-msg-system', {
            innerHTML: sanitizeHtml(msg.htmlContent || msg.content),
        });
        wrapper.appendChild(systemEl);
        return wrapper;
    }

    // Avatar (only for group start on assistant side)
    if (msg.isGroupStart && msg.role === 'assistant') {
        const avatarWrapper = createElement('div', 'conv-msg-avatar');
        const avatarImg = createElement('img', [], {
            src: msg.avatarUrl || '',
            alt: msg.characterName,
        });
        avatarWrapper.appendChild(avatarImg);
        wrapper.appendChild(avatarWrapper);
    } else if (msg.role === 'assistant') {
        // Spacer for alignment
        wrapper.appendChild(createElement('div', 'conv-msg-avatar-spacer'));
    }

    // Bubble container
    const bubbleCol = createElement('div', 'conv-msg-bubble-col');

    // Character name (group start only, if setting enabled)
    if (msg.isGroupStart && msg.role === 'assistant' && settings.showCharacterName) {
        const nameEl = createElement('span', 'conv-msg-name', {
            textContent: msg.characterName,
        });
        bubbleCol.appendChild(nameEl);
    }

    // Bubble
    const bubble = createElement('div', ['conv-msg-bubble', `conv-bubble-${settings.bubbleShape}`]);

    // Content
    const contentEl = createElement('div', 'conv-msg-content', {
        innerHTML: sanitizeHtml(msg.htmlContent || msg.content),
    });
    bubble.appendChild(contentEl);

    bubbleCol.appendChild(bubble);

    // Timestamp (shown when msg.showTime is set; defaults to isGroupStart for non-stagger messages)
    if (msg.showTime !== false && (msg.showTime || msg.isGroupStart)) {
        const timeEl = createElement('span', 'conv-msg-time', {
            textContent: msg.displayTime,
        });
        bubbleCol.appendChild(timeEl);
    }

    wrapper.appendChild(bubbleCol);

    // Swipe indicator
    if (msg.swipeCount > 1) {
        const swipeEl = createElement('div', 'conv-msg-swipe', {
            textContent: `${msg.swipeId + 1}/${msg.swipeCount}`,
        });
        bubbleCol.appendChild(swipeEl);
    }

    return wrapper;
}

/**
 * Update the content of an existing bubble element (e.g., during streaming).
 * @param {HTMLElement} bubbleEl
 * @param {string} htmlContent
 */
export function updateBubbleContent(bubbleEl, htmlContent) {
    const contentEl = bubbleEl.querySelector('.conv-msg-content');
    if (contentEl) {
        contentEl.innerHTML = sanitizeHtml(htmlContent);
    }
}

/**
 * Add a streaming cursor to a bubble.
 * @param {HTMLElement} bubbleEl
 */
export function addStreamingCursor(bubbleEl) {
    const contentEl = bubbleEl.querySelector('.conv-msg-content');
    if (contentEl && !contentEl.querySelector('.conv-streaming-cursor')) {
        const cursor = createElement('span', 'conv-streaming-cursor', {
            textContent: '\u2588', // ▊ block cursor
        });
        contentEl.appendChild(cursor);
    }
}

/**
 * Remove the streaming cursor from a bubble.
 * @param {HTMLElement} bubbleEl
 */
export function removeStreamingCursor(bubbleEl) {
    const cursor = bubbleEl?.querySelector('.conv-streaming-cursor');
    if (cursor) cursor.remove();
}

/**
 * Show the action menu for a message bubble.
 * Menu is positioned above the bubble using fixed positioning
 * to avoid clipping by the scrollable messages container.
 * @param {HTMLElement} bubbleEl
 * @param {import('../utils/message-mapper.js').InternalMessage} msg
 * @param {object} callbacks - { onCopy, onEdit, onRegenerate, onDelete, onSwipeLeft, onSwipeRight }
 */
export function showActionMenu(bubbleEl, msg, callbacks) {
    // Remove any existing action menu
    hideActionMenu();

    const menu = createElement('div', 'conv-action-menu');
    const actions = [];

    actions.push({ icon: 'fa-copy', label: 'Copy', fn: callbacks.onCopy });
    actions.push({ icon: 'fa-pen', label: 'Edit', fn: callbacks.onEdit });

    if (msg.role === 'assistant') {
        actions.push({ icon: 'fa-rotate', label: 'Regenerate', fn: callbacks.onRegenerate });
    }

    actions.push({ icon: 'fa-trash', label: 'Delete', fn: callbacks.onDelete });

    if (msg.swipeCount > 1) {
        if (msg.swipeId > 0) {
            actions.push({ icon: 'fa-chevron-left', label: 'Swipe Left', fn: callbacks.onSwipeLeft });
        }
        if (msg.swipeId < msg.swipeCount - 1) {
            actions.push({ icon: 'fa-chevron-right', label: 'Swipe Right', fn: callbacks.onSwipeRight });
        }
    }

    actions.forEach(({ icon, label, fn }) => {
        const btn = createElement('button', 'conv-action-btn', { title: label });
        btn.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${label}</span>`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideActionMenu();
            if (fn) fn(msg);
        });
        menu.appendChild(btn);
    });

    // Append to the phone container (not the bubble) to avoid scroll clipping
    const phoneEl = document.getElementById('conv-phone');
    const container = phoneEl || document.body;
    container.appendChild(menu);

    // Position using fixed coordinates relative to the bubble
    const bubbleRect = bubbleEl.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${bubbleRect.left + bubbleRect.width / 2}px`;
    menu.style.top = `${bubbleRect.top - 8}px`;
    menu.style.transform = 'translate(-50%, -100%)';

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', hideActionMenu, { once: true });
    }, 10);
}

/**
 * Hide any visible action menu.
 */
export function hideActionMenu() {
    document.querySelectorAll('.conv-action-menu').forEach(el => el.remove());
}
