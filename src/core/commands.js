/**
 * Slash commands for Conversation Mode.
 */

import { isConversationEnabled, setConversationEnabled } from './state.js';
import { showPhone, hidePhone } from '../ui/phone-window.js';
import { renderAllMessages } from '../ui/conversation-view.js';
import { refreshHeader } from '../ui/header-bar.js';

/**
 * Register all slash commands.
 * SlashCommandParser and related classes are available via SillyTavern.getContext().
 */
export function registerCommands() {
    try {
        const context = SillyTavern.getContext();
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = context;

        if (!SlashCommandParser || !SlashCommand) {
            console.warn('[Conversation] SlashCommand API not available, skipping command registration');
            return;
        }

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'conv',
            callback: handleConvCommand,
            helpString: '<div>Toggle Conversation Mode. Usage: <code>/conv on|off|toggle</code></div>',
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'on / off / toggle',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
        }));

        console.log('[Conversation] Slash commands registered');
    } catch (e) {
        console.warn('[Conversation] Failed to register slash commands:', e);
    }
}

/**
 * Handle /conv command.
 * @param {object} namedArgs
 * @param {string} unnamedArgs
 * @returns {string}
 */
function handleConvCommand(namedArgs, unnamedArgs) {
    const arg = (unnamedArgs || '').trim().toLowerCase();

    switch (arg) {
        case 'on':
            setConversationEnabled(true);
            refreshHeader();
            renderAllMessages();
            showPhone();
            return 'Conversation Mode enabled';

        case 'off':
            setConversationEnabled(false);
            hidePhone();
            return 'Conversation Mode disabled';

        case 'toggle':
        case '':
            if (isConversationEnabled()) {
                setConversationEnabled(false);
                hidePhone();
                return 'Conversation Mode disabled';
            } else {
                setConversationEnabled(true);
                refreshHeader();
                renderAllMessages();
                showPhone();
                return 'Conversation Mode enabled';
            }

        default:
            return `Unknown argument: ${arg}. Use on/off/toggle.`;
    }
}
