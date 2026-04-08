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
 * Handles multiple formats including SillyTavern's humanizedDateTime
 * format: "2025-04-07@12h34m56s789ms"
 * @param {string} sendDate
 * @returns {Date}
 */
export function parseSendDate(sendDate) {
    if (!sendDate) return new Date();

    // 1. Handle ST humanizedDateTime format: "2025-04-07@12h34m56s789ms"
    const stMatch = sendDate.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
    if (stMatch) {
        return new Date(
            parseInt(stMatch[1]),
            parseInt(stMatch[2]) - 1, // months are 0-indexed
            parseInt(stMatch[3]),
            parseInt(stMatch[4]),
            parseInt(stMatch[5]),
            parseInt(stMatch[6]),
        );
    }

    // 2. Try native Date parsing (ISO, RFC, etc.)
    const d = new Date(sendDate);
    if (!isNaN(d.getTime())) return d;

    // 3. Fallback: try moment parsing with common formats
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

/** Regex to detect an already-stamped message: starts with [HH:MM] */
const STAMP_RE = /^\[\d{1,2}:\d{2}\]\s/;

/**
 * Stamp a SillyTavern chat message in-place:
 *  - Saves the clean text into `extra.display_text` (what the user sees in ST UI)
 *  - Prepends `[HH:MM] ` to `mes` (what the LLM sees)
 *  - Also updates the `swipes` array to keep it in sync
 *
 * No-ops if the message is already stamped or has no content.
 *
 * @param {object} stMsg - A message object from context.chat[]
 * @returns {boolean} true if the message was modified
 */
export function stampMessage(stMsg) {
    if (!stMsg || !stMsg.mes) return false;

    // Skip system messages (narrator, hidden system injections, etc.)
    if (stMsg.is_system) return false;

    // Already stamped — nothing to do
    if (STAMP_RE.test(stMsg.mes)) return false;

    // Determine the timestamp to use
    const date = parseSendDate(stMsg.send_date);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const stamp = `[${hh}:${mm}]`;

    const cleanText = stMsg.mes;

    // Preserve the clean text for the ST UI via extra.display_text
    if (!stMsg.extra) stMsg.extra = {};
    stMsg.extra.display_text = cleanText;

    // Prepend the stamp to mes (what goes into context / what LLM sees)
    stMsg.mes = `${stamp} ${cleanText}`;

    // Keep the swipes array in sync
    if (Array.isArray(stMsg.swipes)) {
        const swipeIdx = stMsg.swipe_id ?? 0;
        if (stMsg.swipes[swipeIdx] === cleanText) {
            stMsg.swipes[swipeIdx] = stMsg.mes;
        }
    }

    return true;
}

/**
 * Batch-stamp all unstamped messages in the chat array.
 * Intended to be called once on chat load so that historical
 * messages also carry timestamps.
 *
 * @param {object[]} chat - context.chat array
 * @returns {number} number of messages that were modified
 */
export function stampAllMessages(chat) {
    if (!Array.isArray(chat)) return 0;
    let count = 0;
    for (const msg of chat) {
        if (stampMessage(msg)) count++;
    }
    return count;
}
