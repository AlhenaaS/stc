/**
 * Notification sounds and browser notifications.
 * Handles:
 * - Audio playback via Web Audio API (with fallback tone generation)
 * - Browser Notification API
 * - Sound debouncing (prevent spam during stagger)
 */

import { getSettings } from '../core/state.js';

let audioContext = null;
let notificationBuffer = null;
let lastSoundTime = 0;

/** Minimum interval between notification sounds (ms) */
const SOUND_DEBOUNCE_MS = 800;

/**
 * Initialize the notification system.
 * Pre-load the notification sound, generate fallback if file not found.
 */
export async function initNotifications() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Try to load the notification sound file
        const extensionPath = getExtensionPath();
        try {
            const response = await fetch(`${extensionPath}/assets/notification.mp3`);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                notificationBuffer = await audioContext.decodeAudioData(arrayBuffer);
                console.log('[Conversation] Notification sound loaded');
                return;
            }
        } catch { /* file not found, use fallback */ }

        // Also try .ogg
        try {
            const response = await fetch(`${extensionPath}/assets/notification.ogg`);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                notificationBuffer = await audioContext.decodeAudioData(arrayBuffer);
                console.log('[Conversation] Notification sound loaded (ogg)');
                return;
            }
        } catch { /* file not found */ }

        // Generate a simple synth notification tone as fallback
        notificationBuffer = generateSynthTone(audioContext);
        console.log('[Conversation] Using synthesized notification sound');
    } catch (e) {
        console.warn('[Conversation] Failed to initialize audio:', e);
    }
}

/**
 * Play the notification sound (debounced).
 */
export function playNotificationSound() {
    const settings = getSettings();
    if (!settings.soundEnabled) return;
    if (!audioContext || !notificationBuffer) return;

    // Debounce: don't play sounds too close together
    const now = Date.now();
    if (now - lastSoundTime < SOUND_DEBOUNCE_MS) return;
    lastSoundTime = now;

    try {
        // Resume AudioContext if suspended (browser autoplay policy)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const source = audioContext.createBufferSource();
        source.buffer = notificationBuffer;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = settings.soundVolume / 100;

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start(0);
    } catch (e) {
        console.warn('[Conversation] Failed to play sound:', e);
    }
}

/**
 * Show a browser notification (if enabled and tab is not focused).
 * @param {string} title
 * @param {string} body
 * @param {string} [icon]
 */
export function showBrowserNotification(title, body, icon) {
    const settings = getSettings();
    if (!settings.browserNotifications) return;
    if (document.hasFocus()) return;
    if (typeof Notification === 'undefined') return;

    if (Notification.permission === 'granted') {
        try {
            const notification = new Notification(title, {
                body: body || '',
                icon: icon || '/img/ai4.png',
                tag: 'conv-message', // Replace previous notification
            });

            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);

            // Focus window on click
            notification.addEventListener('click', () => {
                window.focus();
                notification.close();
            });
        } catch (e) {
            console.warn('[Conversation] Browser notification failed:', e);
        }
    }
}

/**
 * Request browser notification permission.
 * @returns {Promise<string>} permission state
 */
export async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
}

/**
 * Generate a simple synthesized notification tone (iMessage-like).
 * Used as fallback when no audio file is available.
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function generateSynthTone(ctx) {
    const sampleRate = ctx.sampleRate;
    const duration = 0.15; // 150ms — short ping
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Two-tone ding: E6 (1318 Hz) then G6 (1568 Hz)
    const freq1 = 1318;
    const freq2 = 1568;
    const halfLen = Math.floor(length / 2);

    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const freq = i < halfLen ? freq1 : freq2;
        const envelope = Math.exp(-t * 12); // Quick decay
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3;
    }

    return buffer;
}

/**
 * Get the extension folder path for loading assets.
 * @returns {string}
 */
function getExtensionPath() {
    return 'scripts/extensions/third-party/SillyTavern-Conversation';
}
