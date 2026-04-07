/**
 * Scene system: create, manage, and switch between conversation and RP scenes.
 * Phase 3 feature — skeleton implementation.
 */

import { getSceneInfo, getSettings, getState, setState } from '../core/state.js';
import { resolvePrompt } from '../utils/prompt-helpers.js';

/**
 * Create a new scene from conversation.
 * @param {string} description - User's scene idea
 * @returns {Promise<object|null>} Scene plan
 */
export async function createScene(description) {
    const context = SillyTavern.getContext();
    if (!context.characterId && context.characterId !== 0) {
        toastr.error('No character selected');
        return null;
    }

    const settings = getSettings();
    const promptTemplate = settings.prompts?.sceneCreation;
    if (!promptTemplate) {
        toastr.error('Scene creation prompt is empty');
        return null;
    }

    // Generate scene plan via LLM
    const prompt = resolvePrompt(promptTemplate, {
        sceneDescription: description,
    });

    try {
        toastr.info('Planning scene...');
        // generateRaw takes an options object per ST API docs
        const raw = await context.generateRaw({ prompt });
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON in response');

        const scenePlan = JSON.parse(match[0]);
        return scenePlan;
    } catch (e) {
        console.error('[Conversation] Scene planning failed:', e);
        toastr.error('Failed to plan scene');
        return null;
    }
}

/**
 * Conclude the current scene (generate summary, switch back).
 */
export async function concludeScene() {
    // Phase 3 — to be fully implemented
    console.log('[Conversation] Conclude scene — not yet implemented');
    toastr.info('Scene system is not yet fully implemented');
}

/**
 * Abandon the current scene.
 */
export async function abandonScene() {
    console.log('[Conversation] Abandon scene — not yet implemented');
    toastr.info('Scene system is not yet fully implemented');
}

/**
 * Check if there is an active scene.
 * @returns {boolean}
 */
export function hasActiveScene() {
    const info = getSceneInfo();
    return info?.sceneStatus === 'active';
}
