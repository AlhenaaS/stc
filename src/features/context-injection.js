/**
 * Context Injection: manages what gets sent to the LLM in conversation mode.
 *
 * Responsibilities:
 * - Suppress the main RP system prompt from the preset
 * - Disable reasoning/thinking for chat mode
 * - Inject schedule/status/time context block
 * - Add timestamps to chat messages in the prompt
 */

import { getSettings, isConversationEnabled, getSchedule, getChatMeta } from '../core/state.js';
import { getCurrentTime, formatMessageTime } from '../utils/time-helpers.js';
import { getCurrentStatus, getStatusInfo } from './status.js';
import { getCurrentStatusFromSchedule } from './schedule.js';
import { resolvePrompt } from '../utils/prompt-helpers.js';

const CONTEXT_PROMPT_KEY = 'conversation_context_block';

/** Saved original values to restore when conversation mode is deactivated */
let savedMainPrompt = null;
let savedJailbreak = null;

/**
 * Hook into GENERATE_BEFORE_COMBINE_PROMPTS to modify prompt composition.
 * Called by events.js before each generation.
 * @param {object} data - The prompt data object (contains main, jailbreak, mesSendString, etc.)
 */
export function onBeforeCombinePrompts(data) {
    if (!isConversationEnabled()) return;

    const settings = getSettings();

    // 1. Suppress the main system prompt from the preset (replace with empty or our own)
    if (data.main !== undefined) {
        // Save for potential restore
        savedMainPrompt = data.main;

        // If custom prompt is enabled, it's already injected via setExtensionPrompt.
        // We just need to blank out the RP system prompt so it doesn't interfere.
        data.main = '';
    }

    // 2. Suppress jailbreak prompt (the "NSFW prompt" / "assistant prefill" from presets)
    if (data.jailbreak !== undefined) {
        savedJailbreak = data.jailbreak;
        data.jailbreak = '';
    }
}

/**
 * Hook into GENERATE_AFTER_DATA to modify the final request data.
 * Used to disable reasoning and inject timestamps.
 * @param {object} generateData - The final generation request data
 * @param {boolean} dryRun - Whether this is a dry run
 */
export function onAfterGenerateData(generateData, dryRun) {
    if (!isConversationEnabled()) return;
    if (dryRun) return;

    // 3. Disable reasoning/thinking in chat mode
    if (generateData.include_reasoning !== undefined) {
        generateData.include_reasoning = false;
    }

    // Also set reasoning_effort to 'none' / minimum if present
    if (generateData.reasoning_effort !== undefined) {
        generateData.reasoning_effort = 'none';
    }
}

/**
 * Inject the context block (schedule, status, time) as an extension prompt.
 * Should be called before generation (alongside custom prompt injection).
 */
export function injectContextBlock() {
    if (!isConversationEnabled()) {
        removeContextBlock();
        return;
    }

    const context = SillyTavern.getContext();
    const settings = getSettings();
    const schedule = getSchedule();
    const now = getCurrentTime();

    const promptTemplate = settings.prompts?.contextBlock;
    if (!promptTemplate) return;

    // Build extra macros for context block
    const extra = {};

    if (schedule?.weekly) {
        const charName = context.name2 || 'Character';
        const status = getCurrentStatusFromSchedule(schedule);
        const statusInfo = getStatusInfo(status);
        extra.currentStatus = statusInfo.label;

        // Find current activity from schedule
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[now.getDay()];
        const dayKey = dayName.toLowerCase();
        const daySchedule = schedule.weekly[dayKey] || [];
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${hours}:${minutes}`;
        let currentActivity = '';
        for (const block of daySchedule) {
            if (currentTimeStr >= block.from && currentTimeStr < block.to) {
                currentActivity = block.activity || '';
                break;
            }
        }
        extra.currentActivity = currentActivity ? ` (${currentActivity})` : '';

        // Today's schedule summary
        if (daySchedule.length > 0) {
            const schedSummary = daySchedule
                .map(b => `${b.from}-${b.to}: ${b.activity || b.status}`)
                .join(', ');
            extra.scheduleToday = `${charName}'s schedule today (${dayName}): ${schedSummary}.`;
        }
    }

    const contextBlock = resolvePrompt(promptTemplate, extra);
    if (!contextBlock.trim()) return;

    // Inject as extension prompt at depth 0 (right before the last message)
    context.setExtensionPrompt(
        CONTEXT_PROMPT_KEY,
        contextBlock,
        1,  // position: IN_CHAT
        0,  // depth: 0 = at the very end (right before last message)
        false, // scan: false (don't include in WI scan)
        0,  // role: system
    );
}

/**
 * Remove the context block prompt.
 */
export function removeContextBlock() {
    const context = SillyTavern.getContext();
    context.setExtensionPrompt(CONTEXT_PROMPT_KEY, '', 0, 0, false, 0);
}

/**
 * Build a message representation with timestamps for the prompt.
 * This modifies how messages appear in the chat history sent to the LLM.
 *
 * Called via GENERATE_BEFORE_COMBINE_PROMPTS on the mesSendString.
 * @param {object} data - The prompt data from the event
 */
export function injectTimestampsIntoMessages(data) {
    if (!isConversationEnabled()) return;

    const context = SillyTavern.getContext();
    if (!context.chat || !data.mesSendString) return;

    // Rebuild mesSendString with timestamps
    // mesSendString is a concatenation of chat messages — we need to prepend timestamps
    // However, the actual message format depends on the API (chat completion vs text completion).
    // For chat completions (OpenAI-style), individual messages are handled separately.
    // For text completions, it's a single string.
    //
    // The most reliable approach: modify data.finalMesSend which contains the final
    // combined messages array, OR modify mesSendString for text-completion mode.

    // For text completion APIs: modify mesSendString
    if (typeof data.mesSendString === 'string' && data.mesSendString.length > 0) {
        const lines = data.mesSendString.split('\n');
        const newLines = [];
        let msgIdx = 0;

        for (const line of lines) {
            // Try to detect message boundaries and prepend timestamps
            // ST format is usually "Name: message" or similar
            if (line.trim().length > 0 && msgIdx < context.chat.length) {
                const stMsg = context.chat[msgIdx];
                if (stMsg && stMsg.send_date) {
                    const time = formatTimestampForPrompt(stMsg.send_date);
                    if (time && !line.includes(`[${time}]`)) {
                        newLines.push(`[${time}] ${line}`);
                        msgIdx++;
                        continue;
                    }
                }
            }
            newLines.push(line);
        }

        data.mesSendString = newLines.join('\n');
    }
}

/**
 * Format a send_date value to a short timestamp for prompt injection.
 * @param {string} sendDate
 * @returns {string} e.g. "07:33"
 */
function formatTimestampForPrompt(sendDate) {
    if (!sendDate) return '';
    try {
        // ST uses humanizedDateTime format: "2025-04-07@12h34m56s789ms"
        const match = sendDate.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m/);
        if (match) {
            return `${match[4]}:${match[5]}`;
        }
        // Try ISO or other format
        const d = new Date(sendDate);
        if (!isNaN(d.getTime())) {
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
    } catch { /* fallback */ }
    return '';
}
