/**
 * Message mapper: converts ST chat messages to internal format and back.
 */

import { parseSendDate, formatMessageTime } from './time-helpers.js';

/**
 * @typedef {Object} InternalMessage
 * @property {number} stIndex - Index in context.chat
 * @property {string} id - Unique ID ("msg_<index>")
 * @property {'user'|'assistant'|'system'|'narrator'} role
 * @property {string} characterName
 * @property {string} content - Raw markdown content
 * @property {string} htmlContent - After formatting
 * @property {Date} timestamp
 * @property {string} displayTime - Formatted time string
 * @property {string} avatarUrl
 * @property {boolean} isGroupStart - First in a group (show avatar+name)
 * @property {number} swipeId
 * @property {number} swipeCount
 * @property {string[]} staggerParts - Split parts for stagger
 * @property {boolean} isSceneMemory - System message from scene system
 */

const GROUP_TIME_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map the entire ST chat array to internal messages.
 * @param {object[]} stChat - SillyTavern context.chat array
 * @returns {InternalMessage[]}
 */
export function mapAllMessages(stChat) {
    if (!stChat || !Array.isArray(stChat)) return [];

    const messages = stChat
        .map((msg, index) => mapSingleMessage(msg, index))
        .filter(Boolean);

    // Calculate grouping
    applyGrouping(messages);

    return messages;
}

/**
 * Map a single ST message to internal format.
 * @param {object} stMsg
 * @param {number} index
 * @returns {InternalMessage|null}
 */
export function mapSingleMessage(stMsg, index) {
    if (!stMsg) return null;

    // Skip hidden/system messages that shouldn't be rendered
    if (stMsg.is_system && !stMsg.mes) return null;

    const role = determineRole(stMsg);
    const timestamp = parseSendDate(stMsg.send_date);
    const avatarUrl = getAvatarUrl(stMsg, role);

    return {
        stIndex: index,
        id: `msg_${index}`,
        role,
        characterName: stMsg.name || '',
        content: stMsg.mes || '',
        htmlContent: '', // Will be set by renderer
        timestamp,
        displayTime: formatMessageTime(timestamp),
        avatarUrl,
        isGroupStart: true, // Will be recalculated in applyGrouping
        swipeId: stMsg.swipe_id || 0,
        swipeCount: stMsg.swipes ? stMsg.swipes.length : 1,
        staggerParts: [],
        isSceneMemory: !!(stMsg.extra?.isSceneMemory),
    };
}

/**
 * Determine the role of a message.
 * @param {object} stMsg
 * @returns {'user'|'assistant'|'system'|'narrator'}
 */
function determineRole(stMsg) {
    if (stMsg.is_user) return 'user';
    if (stMsg.is_system) return 'system';
    if (stMsg.extra?.type === 'narrator') return 'narrator';
    return 'assistant';
}

/**
 * Get the avatar URL for a message.
 * @param {object} stMsg
 * @param {string} role
 * @returns {string}
 */
function getAvatarUrl(stMsg, role) {
    if (role === 'user') {
        // User avatar
        return '/img/user-default.png'; // Placeholder, updated in renderer
    }
    if (role === 'assistant') {
        // Try to get character avatar
        const context = SillyTavern.getContext();
        if (context.characterId !== undefined) {
            const char = context.characters[context.characterId];
            if (char?.avatar) {
                return `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}`;
            }
        }
    }
    return '';
}

/**
 * Apply grouping logic to sequential messages.
 * Sequential messages from the same author within 5 minutes are grouped.
 * @param {InternalMessage[]} messages
 */
function applyGrouping(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (i === 0) {
            messages[i].isGroupStart = true;
            continue;
        }

        const prev = messages[i - 1];
        const curr = messages[i];

        const sameAuthor = prev.characterName === curr.characterName && prev.role === curr.role;
        const withinThreshold = (curr.timestamp - prev.timestamp) < GROUP_TIME_THRESHOLD_MS;

        curr.isGroupStart = !(sameAuthor && withinThreshold);
    }
}

/**
 * Split message content into parts for stagger reveal.
 * @param {string} content
 * @param {'paragraphs'|'lines'} mode
 * @returns {string[]}
 */
export function splitForStagger(content, mode = 'paragraphs') {
    if (!content) return [content];

    let parts;
    if (mode === 'paragraphs') {
        parts = content.split(/\n\n+/).filter(p => p.trim());
    } else {
        parts = content.split(/\n/).filter(p => p.trim());
    }

    return parts.length > 0 ? parts : [content];
}
