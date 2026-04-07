/**
 * Phone Window manager: handles drag, resize, dock modes, minimize/restore.
 */

import { getSettings, saveSettings, getState, setState } from '../core/state.js';
import { formatStatusBarTime, getCurrentTime } from '../utils/time-helpers.js';
import { hideTypingIndicator } from './typing-indicator.js';

let phoneEl = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let statusBarInterval = null;

/**
 * Set --conv-vh CSS custom property to actual viewport height.
 * On mobile browsers, window.innerHeight excludes the browser chrome,
 * unlike 100vh which includes it and causes the input bar to be hidden.
 */
function updateVhProperty() {
    document.documentElement.style.setProperty('--conv-vh', `${window.innerHeight}px`);
}

/**
 * Initialize the phone window (call once after DOM injection).
 */
export function initPhoneWindow() {
    phoneEl = document.getElementById('conv-phone');
    if (!phoneEl) return;

    // Set up viewport height tracking for mobile
    updateVhProperty();
    window.addEventListener('resize', updateVhProperty);

    setupDrag();
    setupResize();
    setupMinimize();
    applyDisplayMode();
    restorePosition();
    startStatusBarClock();

    // Ensure typing indicator is hidden on init (prevents stale state)
    hideTypingIndicator();
}

/**
 * Show the phone window.
 */
export function showPhone() {
    if (!phoneEl) return;
    phoneEl.style.display = 'flex';
    setIconVisible(false);
    setState('isMinimized', false);
    setState('isActive', true);
    applyDisplayMode();

    // Ensure typing indicator is hidden if not actually generating
    if (!getState('isGenerating')) {
        hideTypingIndicator();
    }
}

/**
 * Hide the phone window completely (conversation mode disabled).
 * Also hides the minimized icon.
 */
export function hidePhone() {
    if (!phoneEl) return;
    phoneEl.style.display = 'none';
    setIconVisible(false);
    setState('isMinimized', false);
    setState('isActive', false);
    stopStatusBarClock();
}

/**
 * Minimize the phone to a small icon with badge.
 */
export function minimizePhone() {
    if (!phoneEl) return;
    phoneEl.style.display = 'none';
    setIconVisible(true);
    setState('isMinimized', true);
    console.log('[Conversation] minimizePhone: icon should be visible now');
}

/**
 * Restore from minimized state.
 */
export function restorePhone() {
    console.log('[Conversation] restorePhone called');
    showPhone();
    setState('unreadCount', 0);
    updateBadge();
}

/**
 * Show or hide the minimized floating icon.
 * @param {boolean} visible
 */
function setIconVisible(visible) {
    const icon = document.getElementById('conv-minimized-icon');
    if (!icon) {
        console.error('[Conversation] setIconVisible: #conv-minimized-icon not found in DOM!');
        return;
    }
    icon.style.display = visible ? 'flex' : 'none';
    console.log('[Conversation] setIconVisible:', visible, '| actual display:', icon.style.display);
}

/**
 * Apply the current display mode (floating, docked, fullscreen).
 */
export function applyDisplayMode() {
    if (!phoneEl) return;
    const settings = getSettings();
    const mode = settings.displayMode;

    // Remove all mode classes
    phoneEl.classList.remove('conv-mode-floating', 'conv-mode-docked-left',
        'conv-mode-docked-right', 'conv-mode-fullscreen');
    phoneEl.classList.add(`conv-mode-${mode}`);

    if (mode === 'floating') {
        phoneEl.style.width = `${settings.phoneWidth}px`;
        phoneEl.style.height = `${settings.phoneHeight}px`;
    } else {
        phoneEl.style.width = '';
        phoneEl.style.height = '';
    }

    // Apply theme
    applyTheme(settings.theme);
}

/**
 * Apply theme to the phone element.
 * For 'auto' mode, detect ST's current theme by sampling --SmartThemeBodyColor luminance.
 * @param {string} theme - 'auto' | 'light' | 'dark'
 */
function applyTheme(theme) {
    if (!phoneEl) return;

    phoneEl.classList.remove('conv-theme-light', 'conv-theme-dark', 'conv-theme-auto');

    if (theme === 'auto') {
        phoneEl.classList.add('conv-theme-auto');
        // Detect dark/light from ST's CSS custom property
        const isDark = isSTDarkTheme();
        phoneEl.classList.toggle('conv-theme-dark', isDark);
    } else {
        phoneEl.classList.add(`conv-theme-${theme}`);
    }
}

/**
 * Detect if SillyTavern is currently using a dark theme.
 * Samples --SmartThemeBodyColor luminance or falls back to background color sampling.
 * @returns {boolean}
 */
function isSTDarkTheme() {
    try {
        const root = document.documentElement;
        const bodyColor = getComputedStyle(root).getPropertyValue('--SmartThemeBodyColor').trim();
        if (bodyColor) {
            return isColorDark(bodyColor);
        }
        // Fallback: sample body background
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        if (bodyBg) {
            return isColorDark(bodyBg);
        }
    } catch { /* ignore */ }
    return false;
}

/**
 * Check if a CSS color string is dark (luminance < 0.5).
 * @param {string} colorStr - CSS color string (hex, rgb, etc.)
 * @returns {boolean}
 */
function isColorDark(colorStr) {
    // Parse rgb(r,g,b) or #hex
    let r = 128, g = 128, b = 128;

    const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
    } else if (colorStr.startsWith('#')) {
        const hex = colorStr.replace('#', '');
        if (hex.length >= 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        } else if (hex.length >= 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
        }
    }

    // Relative luminance (sRGB)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
}

/**
 * Update the header with character info.
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.avatarUrl
 * @param {string} [options.status]
 */
export function updateHeader({ name, avatarUrl, status }) {
    const nameEl = document.getElementById('conv-header-name');
    const avatarImg = document.querySelector('#conv-header-avatar img');
    const statusDot = document.querySelector('.conv-status-dot');
    const statusText = document.querySelector('.conv-status-text');

    if (nameEl) nameEl.textContent = name || '';
    if (avatarImg) {
        avatarImg.src = avatarUrl || '';
        avatarImg.alt = name || '';
    }
    if (statusDot && status) {
        statusDot.className = `conv-status-dot ${status}`;
    }
    if (statusText && status) {
        const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };
        statusText.textContent = labels[status] || status;
    }
}

/**
 * Update the status bar clock.
 */
export function updateStatusBarClock() {
    const timeEl = document.querySelector('.conv-status-bar-time');
    if (timeEl) {
        timeEl.textContent = formatStatusBarTime(getCurrentTime());
    }
}

/**
 * Update the minimized badge count.
 */
export function updateBadge() {
    const badge = document.getElementById('conv-badge');
    const count = getState('unreadCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

// --- Drag logic ---

function setupDrag() {
    const header = document.getElementById('conv-header');
    if (!header || !phoneEl) return;

    const onStart = (e) => {
        const settings = getSettings();
        if (settings.displayMode !== 'floating') return;

        // Don't start drag if the touch/click is on a button inside the header
        const target = e.target.closest('button, a, .conv-header-btn');
        if (target) return;

        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = phoneEl.getBoundingClientRect();
        dragOffset.x = clientX - rect.left;
        dragOffset.y = clientY - rect.top;

        phoneEl.style.transition = 'none';
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let newX = clientX - dragOffset.x;
        let newY = clientY - dragOffset.y;

        // Keep within viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - phoneEl.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - phoneEl.offsetHeight));

        phoneEl.style.left = `${newX}px`;
        phoneEl.style.top = `${newY}px`;
        phoneEl.style.right = 'auto';
        phoneEl.style.bottom = 'auto';
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        phoneEl.style.transition = '';
        savePosition();
    };

    header.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    header.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
}

function setupResize() {
    const handle = document.getElementById('conv-resize-handle');
    if (!handle || !phoneEl) return;

    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
        const settings = getSettings();
        if (settings.displayMode !== 'floating') return;

        isResizing = true;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const rect = phoneEl.getBoundingClientRect();
        const newW = Math.max(300, Math.min(800, e.clientX - rect.left));
        const newH = Math.max(400, Math.min(1200, e.clientY - rect.top));
        phoneEl.style.width = `${newW}px`;
        phoneEl.style.height = `${newH}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        const rect = phoneEl.getBoundingClientRect();
        const settings = getSettings();
        settings.phoneWidth = Math.round(rect.width);
        settings.phoneHeight = Math.round(rect.height);
        saveSettings();
    });
}

function setupMinimize() {
    const minimizeBtn = document.getElementById('conv-btn-minimize');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', minimizePhone);
    }

    const minimizedIcon = document.getElementById('conv-minimized-icon');
    if (minimizedIcon) {
        setupIconDrag(minimizedIcon);
    }
}

/**
 * Setup drag + tap behaviour for the minimized bubble icon.
 * Short taps open the conversation; drags move the icon around.
 */
function setupIconDrag(icon) {
    let iconDragging = false;
    let iconDragOffset = { x: 0, y: 0 };
    let iconMoved = false;
    let startPos = { x: 0, y: 0 };
    const MOVE_THRESHOLD = 8; // px — below this is a tap, above is a drag

    const onStart = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = icon.getBoundingClientRect();
        iconDragOffset.x = clientX - rect.left;
        iconDragOffset.y = clientY - rect.top;
        startPos.x = clientX;
        startPos.y = clientY;
        iconDragging = true;
        iconMoved = false;
        icon.style.transition = 'none';

        if (e.type === 'mousedown') {
            e.preventDefault();
        }
    };

    const onMove = (e) => {
        if (!iconDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;
        if (!iconMoved && Math.sqrt(dx * dx + dy * dy) < MOVE_THRESHOLD) return;
        iconMoved = true;

        let newX = clientX - iconDragOffset.x;
        let newY = clientY - iconDragOffset.y;

        // Keep within viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - icon.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - icon.offsetHeight));

        icon.style.left = `${newX}px`;
        icon.style.top = `${newY}px`;
        icon.style.right = 'auto';
        icon.style.bottom = 'auto';
    };

    const onEnd = () => {
        if (!iconDragging) return;
        iconDragging = false;
        icon.style.transition = '';

        if (!iconMoved) {
            // Short tap — open conversation
            restorePhone();
        } else {
            // Save icon position
            const settings = getSettings();
            const rect = icon.getBoundingClientRect();
            settings.iconX = Math.round(rect.left);
            settings.iconY = Math.round(rect.top);
            saveSettings();
        }
    };

    icon.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    icon.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

    // Restore saved position
    restoreIconPosition(icon);
}

/**
 * Restore the minimized icon's saved position (clamped to viewport).
 */
function restoreIconPosition(icon) {
    const settings = getSettings();
    if (settings.iconX != null && settings.iconY != null) {
        // Clamp to current viewport so the icon is never off-screen
        const maxX = Math.max(0, window.innerWidth - (icon.offsetWidth || 56));
        const maxY = Math.max(0, window.innerHeight - (icon.offsetHeight || 56));
        const x = Math.max(0, Math.min(settings.iconX, maxX));
        const y = Math.max(0, Math.min(settings.iconY, maxY));
        icon.style.left = `${x}px`;
        icon.style.top = `${y}px`;
        icon.style.right = 'auto';
        icon.style.bottom = 'auto';
    }
}

function savePosition() {
    if (!phoneEl) return;
    const settings = getSettings();
    const rect = phoneEl.getBoundingClientRect();
    settings.phoneX = Math.round(rect.left);
    settings.phoneY = Math.round(rect.top);
    saveSettings();
}

function restorePosition() {
    if (!phoneEl) return;
    const settings = getSettings();

    if (settings.displayMode === 'floating') {
        // Clear any leftover transform from centering
        phoneEl.style.transform = '';

        if (settings.phoneX != null && settings.phoneY != null) {
            phoneEl.style.left = `${settings.phoneX}px`;
            phoneEl.style.top = `${settings.phoneY}px`;
            phoneEl.style.right = 'auto';
            phoneEl.style.bottom = 'auto';
        } else {
            // Center using calculated position (not CSS transform,
            // which would conflict with drag positioning)
            const x = Math.max(0, (window.innerWidth - (settings.phoneWidth || 375)) / 2);
            const y = Math.max(0, (window.innerHeight - (settings.phoneHeight || 670)) / 2);
            phoneEl.style.left = `${x}px`;
            phoneEl.style.top = `${y}px`;
            phoneEl.style.right = 'auto';
            phoneEl.style.bottom = 'auto';
        }
    }
}

function startStatusBarClock() {
    updateStatusBarClock();
    statusBarInterval = setInterval(updateStatusBarClock, 30000);
}

function stopStatusBarClock() {
    if (statusBarInterval) {
        clearInterval(statusBarInterval);
        statusBarInterval = null;
    }
}
