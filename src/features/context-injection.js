/**
 * Context Injection: manages what gets sent to the LLM in conversation mode.
 *
 * Responsibilities:
 * - Suppress built-in RP preset prompts (main, nsfw, jailbreak, enhance definitions)
 *   for Chat Completion APIs by temporarily disabling them in prompt_order
 * - Preserve all other prompts (character card, WI, user custom prompts)
 * - Suppress main + jailbreak for text completion APIs via GENERATE_BEFORE_COMBINE_PROMPTS
 * - Disable reasoning/thinking for chat mode
 * - Inject schedule/status/time context block
 *
 * Note: Timestamps in messages are now handled at message creation time.
 * Each message has [HH:MM] prepended in its `mes` field (visible to LLM),
 * while `extra.display_text` contains the clean text (visible in UI).
 */

import { getSettings, isConversationEnabled, getSchedule, getChatMeta } from '../core/state.js';
import { getCurrentTime } from '../utils/time-helpers.js';
import { getCurrentStatus, getStatusInfo } from './status.js';
import { getCurrentStatusFromSchedule } from './schedule.js';
import { resolvePrompt } from '../utils/prompt-helpers.js';

const CONTEXT_PROMPT_KEY = 'conversation_context_block';

/**
 * Built-in preset prompt identifiers that should be suppressed in conversation mode.
 * These are the standard RP instruction prompts from the prompt manager.
 * Only suppress prompts that contain roleplay-specific instructions —
 * everything else (character card, WI, user custom prompts) is preserved.
 */
const PRESET_PROMPT_IDS = new Set([
    'main',                // Main system prompt (RP instructions from preset)
    'nsfw',                // NSFW / content prompt
    'jailbreak',           // Jailbreak / post-history instructions
    'enhanceDefinitions',  // Enhance definitions prompt
]);

/**
 * Saved prompt_order enabled states for restoration after generation.
 * Maps identifier → original enabled value.
 * @type {Map<string, boolean>|null}
 */
let savedPromptStates = null;

/**
 * Global dummy character ID used by prompt manager for the global prompt order.
 * ST hardcodes this to 100001 in openai.js setupChatCompletionPromptManager().
 */
const GLOBAL_PROMPT_ORDER_ID = 100001;

/**
 * Get the global prompt order entries array from ST settings.
 * @returns {Array<{identifier: string, enabled: boolean}>}
 */
function getGlobalPromptOrder() {
    const context = SillyTavern.getContext();
    const promptOrder = context.chatCompletionSettings?.prompt_order;
    if (!Array.isArray(promptOrder)) return [];

    const globalEntry = promptOrder.find(
        entry => String(entry.character_id) === String(GLOBAL_PROMPT_ORDER_ID),
    );
    return globalEntry?.order ?? [];
}

/**
 * Check whether a prompt_order entry should be suppressed.
 *
 * CONSERVATIVE APPROACH: Only suppress the known built-in preset prompts
 * (main, nsfw, jailbreak, enhanceDefinitions). All other prompts — including
 * user-created custom prompts — are preserved.
 *
 * Rationale: Complex presets like FrankenBUDDY reorganize character card content
 * into custom prompt entries. Suppressing all user-created prompts would remove
 * essential character information. It's safer to only suppress the well-known
 * RP instruction prompts and leave everything else intact.
 *
 * @param {string} identifier - The prompt identifier from prompt_order
 * @returns {boolean} true if this prompt should be suppressed
 */
function shouldSuppressPrompt(identifier) {
    return PRESET_PROMPT_IDS.has(identifier);
}

/**
 * Temporarily disable preset prompts in prompt_order.
 * Called BEFORE the Chat Completion prompt assembly (prepareOpenAIMessages).
 *
 * This works because prepareOpenAIMessages → getPromptCollection() reads
 * prompt_order[].enabled to decide which prompts to include. By flipping
 * enabled=false on preset prompts, they get excluded from the final chat array.
 *
 * The 'main' prompt is special-cased by ST's PromptManager: when disabled,
 * it's still included but with empty content (as a positional anchor for
 * relative inserts). This is fine — empty content messages are filtered out
 * by getChat() and squashSystemMessages().
 */
export function suppressPresetPrompts() {
    if (!isConversationEnabled()) return;

    const order = getGlobalPromptOrder();
    if (order.length === 0) return;

    // Don't double-suppress if already active
    if (savedPromptStates !== null) return;

    savedPromptStates = new Map();

    for (const entry of order) {
        if (entry.enabled && shouldSuppressPrompt(entry.identifier)) {
            savedPromptStates.set(entry.identifier, true);
            entry.enabled = false;
        }
    }

    if (savedPromptStates.size > 0) {
        const suppressed = [...savedPromptStates.keys()].join(', ');
        console.log(`[Conversation] Temporarily disabled preset prompts: ${suppressed}`);
    } else {
        // Nothing was suppressed (all already disabled or not present)
        savedPromptStates = null;
    }
}

/**
 * Restore preset prompts to their original enabled state.
 * Called AFTER prompt assembly completes (or on generation failure/stop).
 *
 * IMPORTANT: This must always be called to avoid permanently disabling
 * preset prompts. Multiple restore points are registered for safety:
 * - CHAT_COMPLETION_PROMPT_READY (normal completion)
 * - GENERATION_ENDED (generation finished)
 * - GENERATION_STOPPED (user clicked stop)
 */
export function restorePresetPrompts() {
    if (savedPromptStates === null) return;

    const order = getGlobalPromptOrder();

    for (const entry of order) {
        if (savedPromptStates.has(entry.identifier)) {
            entry.enabled = savedPromptStates.get(entry.identifier);
        }
    }

    const restored = [...savedPromptStates.keys()].join(', ');
    savedPromptStates = null;
    console.log(`[Conversation] Restored preset prompts: ${restored}`);
}

/** Saved original values for text completion API path */
let savedMainPrompt = null;
let savedJailbreak = null;

/**
 * Hook into GENERATE_BEFORE_COMBINE_PROMPTS to modify prompt composition.
 * This handles text completion APIs (non-OpenAI) where the prompt is combined
 * into a single string. For Chat Completion APIs, this hook has no effect
 * because getCombinedPrompt() returns '' early.
 *
 * @param {object} data - The prompt data object (contains main, jailbreak, etc.)
 */
export function onBeforeCombinePrompts(data) {
    if (!isConversationEnabled()) return;

    // 1. Suppress the main system prompt from the preset
    if (data.main !== undefined) {
        savedMainPrompt = data.main;
        data.main = '';
    }

    // 2. Suppress jailbreak prompt
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

    // Disable reasoning/thinking in chat mode
    if (generateData.include_reasoning !== undefined) {
        generateData.include_reasoning = false;
    }

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
 * Hook into CHAT_COMPLETION_PROMPT_READY.
 * Now serves only as a restoration point for prompt_order states.
 * The actual suppression happens earlier via suppressPresetPrompts().
 *
 * @param {object} eventData - { chat: Array<{role, content, ...}>, dryRun: boolean }
 */
export function onChatCompletionPromptReady(eventData) {
    if (!isConversationEnabled()) return;

    // Restore preset prompts after the chat array has been built.
    // This is the primary restoration point — fires for both dry runs and real generations.
    restorePresetPrompts();
}
