/**
 * DOM utility helpers for Conversation Mode.
 */

/**
 * Sanitize HTML using DOMPurify from SillyTavern.libs.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
    const { DOMPurify } = SillyTavern.libs;
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br', 'p', 'span', 'div',
            'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'img', 'hr', 'del', 'sup', 'sub'],
        ALLOWED_ATTR: ['href', 'target', 'class', 'src', 'alt', 'title', 'style'],
    });
}

/**
 * Create an element with given tag, classes, and optional attributes.
 * @param {string} tag
 * @param {string|string[]} classes
 * @param {Object} [attrs]
 * @returns {HTMLElement}
 */
export function createElement(tag, classes = [], attrs = {}) {
    const el = document.createElement(tag);
    const classList = Array.isArray(classes) ? classes : [classes];
    classList.filter(Boolean).forEach(c => el.classList.add(c));
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'textContent') {
            el.textContent = v;
        } else if (k === 'innerHTML') {
            el.innerHTML = v;
        } else {
            el.setAttribute(k, v);
        }
    });
    return el;
}

/**
 * Scroll an element to the bottom.
 * @param {HTMLElement} el
 * @param {boolean} [smooth=true]
 */
export function scrollToBottom(el, smooth = true) {
    if (!el) return;
    el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
    });
}

/**
 * Check if an element is scrolled near the bottom.
 * @param {HTMLElement} el
 * @param {number} [threshold=50]
 * @returns {boolean}
 */
export function isNearBottom(el, threshold = 50) {
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

/**
 * Wait for given milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} waitMs
 * @returns {Function}
 */
export function debounce(fn, waitMs) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), waitMs);
    };
}
