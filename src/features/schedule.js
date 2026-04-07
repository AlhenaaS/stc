/**
 * Schedule: LLM-generated character weekly schedules.
 *
 * The schedule is stored in chatMetadata.conversationSchedule and drives:
 * - Character status (online/idle/dnd/offline)
 * - Autonomous messaging triggers
 * - Response delay simulation
 */

import { getChatMeta, getSettings } from '../core/state.js';
import { getCurrentTime } from '../utils/time-helpers.js';
import { resolvePrompt } from '../utils/prompt-helpers.js';

/**
 * Generate a schedule for the current character using LLM.
 * @returns {Promise<object|null>} The generated schedule object
 */
export async function generateSchedule() {
    const context = SillyTavern.getContext();
    if (context.characterId === undefined) {
        toastr.error('No character selected');
        return null;
    }

    const char = context.characters[context.characterId];
    if (!char) return null;

    const settings = getSettings();
    const promptTemplate = settings.prompts?.scheduleGeneration;
    if (!promptTemplate) {
        toastr.error('Schedule generation prompt is empty');
        return null;
    }

    const prompt = resolvePrompt(promptTemplate);

    try {
        toastr.info('Generating schedule...');

        // generateRaw takes an options object per ST API docs
        const rawJSON = await context.generateRaw({ prompt });
        if (!rawJSON) throw new Error('Empty response');

        const schedule = JSON.parse(extractJSON(rawJSON));

        // Validate basic structure
        if (!schedule.weekly) throw new Error('Missing "weekly" in response');

        // Save to chat metadata
        context.chatMetadata.conversationSchedule = {
            generated: true,
            lastGenerated: new Date().toISOString(),
            characterName: char.name,
            ...schedule,
        };
        await context.saveMetadata();

        toastr.success('Schedule generated successfully');
        return context.chatMetadata.conversationSchedule;
    } catch (e) {
        console.error('[Conversation] Schedule generation failed:', e);
        toastr.error(`Failed to generate schedule: ${e.message}`);
        return null;
    }
}

/**
 * Save a schedule object to chat metadata.
 * @param {object} schedule
 */
export function saveSchedule(schedule) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;
    context.chatMetadata.conversationSchedule = {
        ...schedule,
        lastModified: new Date().toISOString(),
    };
    context.saveMetadataDebounced();
}

/**
 * Clear the current schedule.
 */
export function clearSchedule() {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;
    delete context.chatMetadata.conversationSchedule;
    context.saveMetadataDebounced();
}

/**
 * Extract JSON from a raw LLM response (may contain surrounding text or markdown).
 * @param {string} raw
 * @returns {string}
 */
function extractJSON(raw) {
    // Remove markdown code blocks if present
    let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

    // Try to find the outermost JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return match[0];
    throw new Error('No JSON object found in response');
}

/**
 * Get the current schedule for display.
 * @returns {object|null}
 */
export function getScheduleData() {
    const meta = getChatMeta();
    return meta.conversationSchedule || null;
}

/**
 * Export schedule as JSON string.
 * @returns {string}
 */
export function exportScheduleJSON() {
    const data = getScheduleData();
    if (!data) return '';
    return JSON.stringify(data, null, 2);
}

/**
 * Import schedule from JSON string.
 * @param {string} jsonStr
 * @returns {boolean} success
 */
export function importScheduleJSON(jsonStr) {
    try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed.weekly) throw new Error('Invalid schedule: missing "weekly"');

        // Merge with existing schedule to preserve autonomousMessaging and other fields
        const existing = getScheduleData() || {};
        const merged = {
            ...existing,
            ...parsed,
            weekly: parsed.weekly, // Weekly always comes from import
        };
        saveSchedule(merged);
        return true;
    } catch (e) {
        toastr.error(`Import failed: ${e.message}`);
        return false;
    }
}

/**
 * Get the current status based on schedule and time.
 * This is a pure function that reads schedule data and returns a status string.
 * Placed here (in schedule.js) to avoid circular dependency between status.js and autonomous.js.
 * @param {object} schedule
 * @returns {string} 'online' | 'idle' | 'dnd' | 'offline'
 */
export function getCurrentStatusFromSchedule(schedule) {
    if (!schedule?.weekly) return 'online';

    const now = getCurrentTime();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[now.getDay()];
    const daySchedule = schedule.weekly[dayName];

    if (!daySchedule || !Array.isArray(daySchedule)) return 'online';

    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (const block of daySchedule) {
        if (currentTimeStr >= block.from && currentTimeStr < block.to) {
            return block.status || 'online';
        }
    }

    return 'offline'; // Default if no block matches
}
