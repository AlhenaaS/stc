/**
 * Prompt helpers: macro substitution for customizable prompt templates.
 *
 * Available macros:
 *   {{charName}}, {{char}}     — character name
 *   {{charDescription}}        — character description
 *   {{charPersonality}}        — character personality field
 *   {{scenario}}               — character scenario (prefixed with "Scenario: " if non-empty)
 *   {{user}}                   — user display name
 *   {{timeOfDay}}              — "morning" / "afternoon" / "evening"
 *   {{currentTime}}            — "HH:MM"
 *   {{currentDate}}            — "DD.MM.YYYY"
 *   {{dayName}}                — "Monday", "Tuesday", etc.
 *   {{currentStatus}}          — current status label from schedule
 *   {{currentActivity}}        — current activity string (with " (activity)" wrapping if non-empty)
 *   {{scheduleToday}}          — today's schedule summary line, or empty
 *   {{sceneDescription}}       — user-provided scene idea
 *   {{messages}}               — formatted message list (for cross-memory)
 *   {{sceneTitle}}             — scene title (for cross-memory)
 *   {{summary}}                — scene summary (for cross-memory)
 */

import { getCurrentTime } from './time-helpers.js';

/**
 * Resolve all macros in a prompt template.
 * @param {string} template — the prompt template with {{macro}} placeholders
 * @param {object} [extra={}] — additional key-value pairs for custom macros
 * @returns {string}
 */
export function resolvePrompt(template, extra = {}) {
    if (!template) return '';

    const context = SillyTavern.getContext();
    const char = (context.characterId !== undefined)
        ? context.characters?.[context.characterId]
        : null;

    const now = getCurrentTime();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const scenario = char?.scenario || '';

    const macros = {
        charName: char?.name || 'Character',
        char: char?.name || 'Character',
        charDescription: char?.description || char?.personality || '',
        charPersonality: char?.personality || '',
        scenario: scenario ? `Scenario: ${scenario}` : '',
        user: context.name1 || 'User',
        timeOfDay: getTimeOfDay(now.getHours()),
        currentTime: `${hours}:${minutes}`,
        currentDate: `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`,
        dayName: dayNames[now.getDay()],
        // These can be overridden by extra:
        currentStatus: '',
        currentActivity: '',
        scheduleToday: '',
        sceneDescription: '',
        messages: '',
        sceneTitle: '',
        summary: '',
        ...extra,
    };

    let result = template;
    for (const [key, value] of Object.entries(macros)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }

    // Clean up: remove lines that are entirely empty after macro substitution
    // (e.g., "{{scenario}}" on its own line when scenario is empty)
    result = result.replace(/^\s*\n/gm, '');

    return result;
}

/**
 * Determine the time-of-day label from hour.
 * @param {number} hour - 0..23
 * @returns {string}
 */
function getTimeOfDay(hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night'; // 21:00–04:59
}
