/**
 * Time formatting helpers for Conversation Mode.
 * Uses moment.js from SillyTavern.libs.
 */

import { getCustomTime } from '../core/state.js';

/**
 * Get the current time — either custom game time or real time.
 * @returns {Date}
 */
export function getCurrentTime() {
    const customTime = getCustomTime();
    if (customTime?.enabled && customTime.currentDate) {
        return new Date(customTime.currentDate);
    }
    return new Date();
}

/**
 * Format a time value for display in message bubbles.
 * @param {Date|string|number} time
 * @returns {string} e.g. "3:42 PM"
 */
export function formatMessageTime(time) {
    const { moment } = SillyTavern.libs;
    return moment(time).format('h:mm A');
}

/**
 * Format a date for day separators.
 * @param {Date|string|number} date
 * @returns {string} "Today", "Yesterday", "February 14", "February 14, 2024"
 */
export function formatDayLabel(date) {
    const { moment } = SillyTavern.libs;
    const m = moment(date);
    const now = moment(getCurrentTime());

    if (m.isSame(now, 'day')) return 'Today';
    if (m.isSame(now.clone().subtract(1, 'day'), 'day')) return 'Yesterday';
    if (m.isSame(now, 'year')) return m.format('MMMM D');
    return m.format('MMMM D, YYYY');
}

/**
 * Check if two dates are on different days.
 * @param {Date|string|number} a
 * @param {Date|string|number} b
 * @returns {boolean}
 */
export function isDifferentDay(a, b) {
    const { moment } = SillyTavern.libs;
    return !moment(a).isSame(moment(b), 'day');
}

/**
 * Parse ST send_date string to Date.
 * @param {string} sendDate - e.g. "April 6, 2025 12:34pm"
 * @returns {Date}
 */
export function parseSendDate(sendDate) {
    if (!sendDate) return new Date();
    const d = new Date(sendDate);
    if (!isNaN(d.getTime())) return d;
    // Fallback: try moment parsing
    const { moment } = SillyTavern.libs;
    const m = moment(sendDate, [
        'MMMM D, YYYY h:mma',
        'MMMM D, YYYY h:mm A',
        'YYYY-MM-DDTHH:mm:ss',
        'YYYY-MM-DD HH:mm:ss',
    ]);
    return m.isValid() ? m.toDate() : new Date();
}

/**
 * Advance the custom game time by a random amount (autoAdvance).
 * @param {object} timeConfig - chatMetadata.conversationTime
 * @returns {Date} new current date
 */
export function advanceCustomTime(timeConfig) {
    if (!timeConfig?.enabled || !timeConfig.autoAdvanceOnMessage) return null;

    const { min, max } = timeConfig.autoAdvanceRange || { min: 5, max: 30 };
    const advanceMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
    const current = new Date(timeConfig.currentDate || timeConfig.baseDate);
    current.setMinutes(current.getMinutes() + advanceMinutes);
    timeConfig.currentDate = current.toISOString();

    return current;
}

/**
 * Format clock time for the status bar.
 * @param {Date} [date]
 * @returns {string} e.g. "12:34 PM"
 */
export function formatStatusBarTime(date) {
    const { moment } = SillyTavern.libs;
    return moment(date || getCurrentTime()).format('h:mm A');
}

/**
 * Format the current time as HH:MM for embedding into message text.
 * Used to prepend [HH:MM] to mes so the LLM sees timestamps.
 * @param {Date} [date]
 * @returns {string} e.g. "14:32"
 */
export function formatTimestampForMessage(date) {
    const d = date || getCurrentTime();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
