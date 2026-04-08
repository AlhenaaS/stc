/**
 * Autonomous Messages: character initiates messages after inactivity or schedule triggers.
 *
 * Flow:
 * 1. Polls every 30s while conversation mode is active
 * 2. Checks: schedule allows messaging + user has been inactive long enough
 * 3. Adds a response delay (simulates thinking time)
 * 4. Generates message via generateQuietPrompt
 * 5. Plays notification + browser notification
 */

import { getState, setState, getSchedule, getSettings, isConversationEnabled } from '../core/state.js';
import { getCurrentTime } from '../utils/time-helpers.js';
import { stampMessage } from '../utils/time-helpers.js';
import { resolvePrompt } from '../utils/prompt-helpers.js';
import { playNotificationSound, showBrowserNotification } from './notifications.js';
import { addMessage } from '../ui/conversation-view.js';
import { canReceiveMessages } from './status.js';
import { delay } from '../utils/dom-helpers.js';

let pollingInterval = null;

/** Daily initiation count key prefix for localStorage */
const DAILY_COUNT_KEY = 'conv_autonomous_daily';

/**
 * Start autonomous messaging polling.
 * Should be called when conversation mode is activated.
 */
export function startAutonomousPolling() {
    if (pollingInterval) return;

    // Reset daily count if day changed
    resetDailyCountIfNeeded();

    pollingInterval = setInterval(checkAutonomousTriggers, 30000); // Every 30 seconds
    console.log('[Conversation] Autonomous polling started');
}

/**
 * Stop autonomous messaging polling.
 * Should be called when conversation mode is deactivated.
 */
export function stopAutonomousPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * Reset the daily initiation count at midnight.
 */
function resetDailyCountIfNeeded() {
    try {
        const stored = localStorage.getItem(DAILY_COUNT_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            const today = new Date().toDateString();
            if (data.date !== today) {
                setState('todayInitiations', 0);
                localStorage.setItem(DAILY_COUNT_KEY, JSON.stringify({ date: today, count: 0 }));
            } else {
                setState('todayInitiations', data.count || 0);
            }
        }
    } catch { /* ignore */ }
}

/**
 * Save daily initiation count.
 */
function saveDailyCount() {
    const count = getState('todayInitiations') || 0;
    try {
        localStorage.setItem(DAILY_COUNT_KEY, JSON.stringify({
            date: new Date().toDateString(),
            count,
        }));
    } catch { /* ignore */ }
}

/**
 * Check if autonomous message should be triggered.
 */
async function checkAutonomousTriggers() {
    // Guard: skip if not ready
    if (!isConversationEnabled() || !getState('isActive')) return;
    if (getState('isGenerating') || getState('isStaggering')) return;

    const schedule = getSchedule();
    if (!schedule?.autonomousMessaging?.enabled) return;

    // Check status allows messaging
    if (!canReceiveMessages()) return;

    // Check daily limit
    const todayInitiations = getState('todayInitiations') || 0;
    const maxDaily = schedule.autonomousMessaging.maxInitiationsPerDay || 5;
    if (todayInitiations >= maxDaily) return;

    // Check inactivity threshold
    const lastActivity = getState('lastUserActivity') || Date.now();
    const inactivitySeconds = (Date.now() - lastActivity) / 1000;
    const threshold = schedule.autonomousMessaging.initiateAfterInactivity || 600;

    if (inactivitySeconds >= threshold) {
        await triggerAutonomousMessage(schedule);
    }
}

/**
 * Trigger an autonomous message from the character.
 * @param {object} schedule
 */
async function triggerAutonomousMessage(schedule) {
    const context = SillyTavern.getContext();
    if (context.characterId === undefined) return;

    const char = context.characters[context.characterId];
    if (!char) return;

    console.log('[Conversation] Triggering autonomous message');

    // Simulate response delay (character "thinking")
    const responseDelay = schedule.autonomousMessaging.responseDelay || { min: 30, max: 180 };
    const delayMs = (Math.random() * (responseDelay.max - responseDelay.min) + responseDelay.min) * 1000;

    // Show typing indicator during delay
    const { showTypingIndicator, hideTypingIndicator } = await import('../ui/typing-indicator.js');
    showTypingIndicator(char.name);

    await delay(Math.min(delayMs, 10000)); // Cap at 10 seconds for UX

    // Double-check we're still active after delay
    if (!isConversationEnabled() || !getState('isActive') || getState('isGenerating')) {
        hideTypingIndicator();
        return;
    }

    try {
        const settings = getSettings();
        const promptTemplate = settings.prompts?.autonomousMessage;
        if (!promptTemplate) {
            hideTypingIndicator();
            return;
        }

        const prompt = resolvePrompt(promptTemplate);

        // generateQuietPrompt generates text but does NOT add it to chat.
        // We need to manually create a message and insert it.
        const result = await context.generateQuietPrompt({ quietPrompt: prompt });

        hideTypingIndicator();

        if (!result) return;

        // Create a character message object and add it to chat
        const newMessage = {
            name: char.name,
            is_user: false,
            is_system: false,
            mes: typeof result === 'string' ? result : String(result),
            send_date: context.humanizedDateTime(),
            extra: {
                isAutonomous: true,
            },
            swipe_id: 0,
            swipes: [typeof result === 'string' ? result : String(result)],
        };

        // Stamp the message: [HH:MM] in mes, clean text in extra.display_text
        stampMessage(newMessage);

        // Push to chat array then call addOneMessage to render in ST's main view
        context.chat.push(newMessage);
        context.addOneMessage(newMessage, { scroll: false });
        await context.saveChat();

        // Also render in our conversation view
        const msgIndex = context.chat.length - 1;
        addMessage(newMessage, msgIndex, { isNew: true });

        // Update counters
        setState('todayInitiations', (getState('todayInitiations') || 0) + 1);
        saveDailyCount();
        setState('lastUserActivity', Date.now()); // Reset timer to prevent spam

        playNotificationSound();
        showBrowserNotification(
            char.name,
            (typeof result === 'string' ? result : '').substring(0, 100),
            char.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}` : undefined,
        );
    } catch (e) {
        hideTypingIndicator();
        console.error('[Conversation] Autonomous message failed:', e);
    }
}

/**
 * Manually trigger an autonomous message (for testing/debugging).
 */
export async function forceAutonomousMessage() {
    const schedule = getSchedule();
    if (schedule?.autonomousMessaging) {
        await triggerAutonomousMessage(schedule);
    } else {
        await triggerAutonomousMessage({
            autonomousMessaging: {
                responseDelay: { min: 1, max: 3 },
            },
        });
    }
}
