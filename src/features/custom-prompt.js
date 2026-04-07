/**
 * Custom Prompt: injects a conversation-style system prompt when conversation mode is active.
 */

import { getSettings, isConversationEnabled, getChatMeta, MODULE_NAME, DEFAULT_SETTINGS } from '../core/state.js';

const PROMPT_NAME = 'conversation_mode_prompt';

/**
 * Inject the custom conversation prompt if enabled.
 * Should be called before each generation.
 */
export function injectCustomPrompt() {
    if (!isConversationEnabled()) {
        removeCustomPrompt();
        return;
    }

    const settings = getSettings();
    const chatMeta = getChatMeta();

    // Per-chat override takes priority
    const promptConfig = chatMeta.conversationCustomPrompt || settings.customPrompt;

    if (!promptConfig?.enabled) {
        removeCustomPrompt();
        return;
    }

    // Use text from customPrompt config, falling back to prompts.conversationSystem
    const text = promptConfig.text || settings.prompts?.conversationSystem || '';
    if (!text) {
        removeCustomPrompt();
        return;
    }

    const context = SillyTavern.getContext();
    context.setExtensionPrompt(
        PROMPT_NAME,
        text,
        promptConfig.position ?? 1,
        promptConfig.depth ?? 1,
        true,  // scan
        promptConfig.role ?? 0,
    );
}

/**
 * Remove the injected prompt.
 */
export function removeCustomPrompt() {
    const context = SillyTavern.getContext();
    context.setExtensionPrompt(PROMPT_NAME, '', 0, 0, false, 0);
}

/**
 * Get the default prompt text.
 * @returns {string}
 */
export function getDefaultPromptText() {
    return DEFAULT_SETTINGS.prompts.conversationSystem;
}
