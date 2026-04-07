/**
 * Cross-memory: inject conversation context into scenes and scene memories into conversations.
 * Phase 3 feature — skeleton implementation.
 */

import { getSettings, getSceneMemories, getChatMeta, isConversationEnabled } from '../core/state.js';

const CONV_TO_SCENE_PROMPT = 'conversation_to_scene_context';
const SCENE_TO_CONV_PROMPT = 'scene_memories_context';

/**
 * Inject conversation context into scene (before scene generation).
 */
export function injectConversationIntoScene() {
    const settings = getSettings();
    if (!settings.crossMemory.injectConversationIntoScene) return;

    const meta = getChatMeta();
    if (!meta.sceneOrigin?.isScene) return; // Only in scene chats

    const context = SillyTavern.getContext();
    const originMessages = getOriginConversationMessages(settings.crossMemory.conversationMessagesCount);

    if (!originMessages || originMessages.length === 0) return;

    const formatted = formatConversationContext(originMessages);
    context.setExtensionPrompt(
        CONV_TO_SCENE_PROMPT,
        formatted,
        1, // IN_CHAT
        settings.crossMemory.conversationInjectionDepth,
        true,
        0, // system
    );
}

/**
 * Inject scene memories into conversation (before conversation generation).
 */
export function injectSceneMemoriesIntoConversation() {
    const settings = getSettings();
    if (!settings.crossMemory.injectSceneMemories) return;
    if (!isConversationEnabled()) return;

    const memories = getSceneMemories();
    if (!memories || memories.length === 0) {
        removeSceneMemoryPrompt();
        return;
    }

    // Limit memories
    const max = settings.crossMemory.maxSceneMemories;
    const limited = max > 0 ? memories.slice(-max) : memories;

    const formatted = formatSceneMemories(limited);
    const context = SillyTavern.getContext();
    context.setExtensionPrompt(
        SCENE_TO_CONV_PROMPT,
        formatted,
        settings.crossMemory.sceneMemoryPosition,
        settings.crossMemory.sceneMemoryDepth,
        true,
        0, // system
    );
}

/**
 * Remove scene memory injection prompt.
 */
export function removeSceneMemoryPrompt() {
    const context = SillyTavern.getContext();
    context.setExtensionPrompt(SCENE_TO_CONV_PROMPT, '', 0, 0, false, 0);
}

/**
 * Format conversation messages for injection into scene context.
 * @param {object[]} messages
 * @returns {string}
 */
function formatConversationContext(messages) {
    const lines = messages.map(m => {
        const name = m.is_user ? '{{user}}' : m.name;
        return `${name}: ${(m.mes || '').substring(0, 200)}`;
    });

    return `[Context from text conversation between {{user}} and {{char}}:\n${lines.join('\n')}\n...]`;
}

/**
 * Format scene memories for injection into conversation context.
 * @param {object[]} memories
 * @returns {string}
 */
function formatSceneMemories(memories) {
    return memories.map(m =>
        `[Shared Memory - Scene: "${m.sceneTitle}"\n${m.summary}]`
    ).join('\n\n');
}

/**
 * Get messages from the origin conversation (stub — would need file access in full implementation).
 * @param {number} count
 * @returns {object[]}
 */
function getOriginConversationMessages(count) {
    // In full implementation, this would load messages from the origin chat file
    // For now, return empty (Phase 3)
    return [];
}
