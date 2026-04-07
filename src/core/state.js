/**
 * Global state management for Conversation Mode extension.
 * All mutable state lives here. Components read/write through exported functions.
 */

const MODULE_NAME = 'conversation';

/** Default extension settings (persisted in extensionSettings) */
export const DEFAULT_SETTINGS = {
    // Display
    displayMode: 'floating',       // 'floating' | 'docked-left' | 'docked-right' | 'fullscreen'
    enterToSend: true,
    showCharacterName: true,
    theme: 'auto',                 // 'light' | 'dark' | 'auto'

    // Phone window
    phoneWidth: 375,
    phoneHeight: 670,
    phoneX: null,                  // null = center
    phoneY: null,

    // Bubbles
    userBubbleColor: '#007AFF',
    assistantBubbleColor: '#E9E9EB',
    backgroundType: 'solid',       // 'solid' | 'gradient'
    backgroundColor: '#FFFFFF',
    backgroundGradient1: '#FFFFFF',
    backgroundGradient2: '#F2F2F7',
    bubbleShape: 'rounded',        // 'rounded' | 'sharp' | 'minimal'

    // Stagger
    staggerEnabled: true,
    staggerDelay: 1500,
    staggerSplitMode: 'paragraphs', // 'paragraphs' | 'lines'

    // Notifications
    soundEnabled: true,
    soundVolume: 70,
    browserNotifications: false,

    // Autonomous messaging
    autonomousEnabled: false,

    // Custom prompt (legacy — still used for injection settings)
    customPrompt: {
        enabled: true,
        text: '', // will be populated from prompts.conversationSystem on first run
        position: 1,    // 0=IN_PROMPT, 1=IN_CHAT, 2=BEFORE_PROMPT
        depth: 1,
        role: 0,        // 0=system, 1=user, 2=assistant
    },

    // ================================================================
    // Prompts — all LLM-facing templates, fully customizable.
    // Macros available in all prompts:
    //   {{charName}}         — character name
    //   {{charDescription}}  — character description
    //   {{charPersonality}}  — character personality field
    //   {{scenario}}         — character scenario
    //   {{user}}             — user's display name
    //   {{char}}             — alias for {{charName}}
    //   {{timeOfDay}}        — "morning" / "afternoon" / "evening"
    //   {{currentTime}}      — "HH:MM"
    //   {{currentDate}}      — "DD.MM.YYYY"
    //   {{dayName}}          — "Monday" etc.
    //   {{scheduleToday}}    — today's schedule summary
    //   {{currentActivity}}  — current activity from schedule
    //   {{currentStatus}}    — current status label (Online/Idle/etc.)
    //   {{sceneDescription}} — (scenes) user's scene idea
    // ================================================================
    prompts: {
        // System prompt injected into every generation in conversation mode
        conversationSystem: `You are now in a text messaging conversation. Write short, casual messages as if texting on a phone. Use natural texting style: short sentences, occasional emoji, casual grammar. Do NOT write long paragraphs or prose-style responses. Each new line will be shown as a separate message bubble.`,

        // Schedule generation prompt (sent to generateRaw)
        scheduleGeneration: `Based on this character's description, generate a realistic weekly phone/messaging schedule in JSON format.

Character: {{charName}}
Description: {{charDescription}}
{{scenario}}

The schedule should reflect the character's personality, occupation, lifestyle, and habits.
Each day should have time blocks covering 00:00-23:59 with these statuses:
- "online" — actively checking phone, quick responses
- "idle" — might check phone occasionally, slower responses  
- "dnd" — busy/focused, won't respond for a while
- "offline" — sleeping or completely unavailable

Each block needs: "from" (HH:MM), "to" (HH:MM), "status", and "activity" (brief description).

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
    "weekly": {
        "monday": [
            { "from": "00:00", "to": "07:00", "status": "offline", "activity": "Sleeping" },
            { "from": "07:00", "to": "08:30", "status": "online", "activity": "Morning routine" },
            { "from": "08:30", "to": "12:00", "status": "dnd", "activity": "At work/school" },
            { "from": "12:00", "to": "13:00", "status": "online", "activity": "Lunch break" },
            { "from": "13:00", "to": "17:00", "status": "dnd", "activity": "At work/school" },
            { "from": "17:00", "to": "22:00", "status": "online", "activity": "Free time" },
            { "from": "22:00", "to": "23:59", "status": "idle", "activity": "Winding down" }
        ],
        "tuesday": [...same format...],
        "wednesday": [...],
        "thursday": [...],
        "friday": [...],
        "saturday": [...],
        "sunday": [...]
    },
    "autonomousMessaging": {
        "enabled": true,
        "initiateAfterInactivity": 600,
        "maxInitiationsPerDay": 5,
        "responseDelay": { "min": 30, "max": 180 }
    }
}`,

        // Autonomous message prompt (sent via generateQuietPrompt)
        autonomousMessage: `[System: {{charName}} hasn't heard from {{user}} in a while. It's {{timeOfDay}}. {{charName}} decides to send a text message to {{user}}. Write ONLY the text message that {{charName}} would send — a short, natural message to start or continue conversation, based on their personality. Keep it casual and brief, like a real text message. Do NOT include any narration, actions, or stage directions.]`,

        // Context injection block template (injected before each generation)
        contextBlock: `<context>
Current time and date: {{currentTime}}, {{currentDate}} ({{dayName}}).
{{charName}}'s current status: {{currentStatus}}{{currentActivity}}.
{{user}}'s status: online (in the chat).
{{scheduleToday}}
</context>`,

        // Scene creation prompt (sent to generateRaw)
        sceneCreation: `Based on this scene idea, create a detailed scene plan for a roleplay scene.

Scene idea: {{sceneDescription}}
Character: {{charName}}
Character description: {{charDescription}}

Return ONLY valid JSON:
{
    "title": "Short scene title",
    "location": "Where the scene takes place",
    "mood": "Mood/atmosphere",
    "characters": ["{{charName}}", "{{user}}"],
    "description": "Brief scene description",
    "openingNarration": "*Opening narration text in roleplay style*",
    "systemPromptAddition": "Additional context for the AI during this scene"
}`,

        // Cross-memory: conversation context injected into scenes
        crossMemoryConversation: `[Context from text conversation between {{user}} and {{char}}:\n{{messages}}\n...]`,

        // Cross-memory: scene memories injected into conversation
        crossMemoryScene: `[Shared Memory - Scene: "{{sceneTitle}}"\n{{summary}}]`,
    },

    // Prompt presets (saved sets of all prompts)
    promptPresets: {},
    // Currently active preset name (null = custom / unsaved)
    activePreset: null,

    // Cross-memory
    crossMemory: {
        injectConversationIntoScene: true,
        conversationMessagesCount: 20,
        conversationInjectionDepth: 4,
        injectSceneMemories: true,
        maxSceneMemories: 0,       // 0 = all
        sceneMemoryDepth: 2,
        sceneMemoryPosition: 1,    // 0=IN_PROMPT, 1=IN_CHAT, 2=BEFORE_PROMPT
    },
};

/**
 * Runtime state (non-persisted, resets on page load).
 */
const runtimeState = {
    /** Whether conversation mode is currently active/visible */
    isActive: false,

    /** Whether we are currently in a scene (vs conversation) */
    isSceneMode: false,

    /** Whether generation is in progress */
    isGenerating: false,

    /** Whether stagger reveal is in progress */
    isStaggering: false,

    /** Stagger abort controller */
    staggerAbort: null,

    /** Whether the phone window is minimized */
    isMinimized: false,

    /** Unread message count (for minimized badge) */
    unreadCount: 0,

    /** Current streaming message element */
    streamingBubble: null,

    /** Last user activity timestamp (for autonomous messages) */
    lastUserActivity: Date.now(),

    /** Autonomous polling interval ID */
    autonomousIntervalId: null,

    /** Today's autonomous initiation count */
    todayInitiations: 0,

    /** Draft text per chat (key = chat filename) */
    drafts: {},

    /** Cached internal messages */
    messages: [],

    /** Whether user has scrolled up from bottom */
    userScrolledUp: false,
};

/** Flag to track if settings have been initialized this session */
let settingsInitialized = false;

/**
 * Get the extension settings object (from SillyTavern extensionSettings).
 * Initializes defaults if missing, merges with defaults to fill new keys (once per session).
 * @returns {object}
 */
export function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        settingsInitialized = true;
    } else if (!settingsInitialized) {
        // Merge defaults into existing settings once (fills missing keys from updates)
        const { lodash } = SillyTavern.libs;
        context.extensionSettings[MODULE_NAME] = lodash.merge(
            structuredClone(DEFAULT_SETTINGS),
            context.extensionSettings[MODULE_NAME],
        );
        settingsInitialized = true;
    }
    return context.extensionSettings[MODULE_NAME];
}

/**
 * Save extension settings (debounced).
 */
export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/**
 * Get a runtime state value.
 * @param {string} key
 * @returns {*}
 */
export function getState(key) {
    return runtimeState[key];
}

/**
 * Set a runtime state value.
 * @param {string} key
 * @param {*} value
 */
export function setState(key, value) {
    runtimeState[key] = value;
}

/**
 * Get the chat metadata for conversation mode.
 * @returns {object}
 */
export function getChatMeta() {
    const context = SillyTavern.getContext();
    return context.chatMetadata || {};
}

/**
 * Check if conversation mode is enabled for the current chat.
 * @returns {boolean}
 */
export function isConversationEnabled() {
    const meta = getChatMeta();
    return !!meta.conversationEnabled;
}

/**
 * Enable/disable conversation mode for the current chat.
 * @param {boolean} enabled
 */
export async function setConversationEnabled(enabled) {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata) return;
    context.chatMetadata.conversationEnabled = enabled;
    await context.saveMetadata();
}

/**
 * Get custom time settings from chat metadata.
 * @returns {object|null}
 */
export function getCustomTime() {
    const meta = getChatMeta();
    return meta.conversationTime || null;
}

/**
 * Get schedule from chat metadata.
 * @returns {object|null}
 */
export function getSchedule() {
    const meta = getChatMeta();
    return meta.conversationSchedule || null;
}

/**
 * Get scene info from chat metadata.
 * @returns {object|null}
 */
export function getSceneInfo() {
    const meta = getChatMeta();
    return meta.conversationScene || null;
}

/**
 * Get scene memories from chat metadata.
 * @returns {Array}
 */
export function getSceneMemories() {
    const meta = getChatMeta();
    return meta.conversationSceneMemories || [];
}

export { MODULE_NAME };
