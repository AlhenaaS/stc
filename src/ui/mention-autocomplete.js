/**
 * @mention autocomplete for character names in the input textarea.
 * Triggers on '@' character, shows a popup with matching names.
 * Supports keyboard navigation (Up/Down/Enter/Tab/Escape).
 */

let autocompleteEl = null;
let onSelectCallback = null;
let currentTextarea = null;

/**
 * Initialize mention autocomplete on the input textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {Function} [onSelect] - Called with { name, startPos, endPos }
 */
export function initMentionAutocomplete(textarea, onSelect) {
    if (!textarea) return;

    // Prevent double-init
    if (currentTextarea === textarea) return;
    currentTextarea = textarea;
    onSelectCallback = onSelect || null;

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeydown);
    textarea.addEventListener('blur', () => {
        // Delay hide to allow click on autocomplete item
        setTimeout(hideAutocomplete, 200);
    });
}

/**
 * Destroy mention autocomplete listeners.
 */
export function destroyMentionAutocomplete() {
    if (currentTextarea) {
        currentTextarea.removeEventListener('input', onInput);
        currentTextarea.removeEventListener('keydown', onKeydown);
        currentTextarea = null;
    }
    hideAutocomplete();
}

/**
 * Handle input event — check for @ trigger.
 */
function onInput() {
    const textarea = currentTextarea;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const text = textarea.value.substring(0, cursorPos);

    // Find the last '@' that starts a mention
    const atIndex = findMentionStart(text);

    if (atIndex >= 0) {
        const query = text.substring(atIndex + 1).toLowerCase();
        showAutocomplete(textarea, query, atIndex);
    } else {
        hideAutocomplete();
    }
}

/**
 * Handle keydown — navigate/select in autocomplete.
 * @param {KeyboardEvent} e
 */
function onKeydown(e) {
    if (!autocompleteEl || autocompleteEl.style.display === 'none') return;

    const items = autocompleteEl.querySelectorAll('.conv-mention-item');
    if (items.length === 0) return;

    const active = autocompleteEl.querySelector('.conv-mention-item.active');
    let activeIdx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach((item, i) => item.classList.toggle('active', i === activeIdx));
        ensureVisible(items[activeIdx]);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach((item, i) => item.classList.toggle('active', i === activeIdx));
        ensureVisible(items[activeIdx]);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (active && autocompleteEl.style.display !== 'none') {
            e.preventDefault();
            selectMention(currentTextarea, active.dataset.name, parseInt(active.dataset.start, 10));
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
    }
}

/**
 * Find the start of a mention trigger ('@') in text.
 * Must be at start of text or preceded by whitespace.
 * @param {string} text
 * @returns {number} Index of '@' or -1
 */
function findMentionStart(text) {
    for (let i = text.length - 1; i >= 0; i--) {
        const char = text[i];
        if (char === '@' && (i === 0 || /\s/.test(text[i - 1]))) {
            return i;
        }
        // Stop searching if we hit whitespace before finding @
        if (/\s/.test(char)) return -1;
    }
    return -1;
}

/**
 * Show autocomplete popup with matching names.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} query
 * @param {number} atIndex
 */
function showAutocomplete(textarea, query, atIndex) {
    const names = gatherNames();

    // Filter by query
    const filtered = query
        ? names.filter(n => n.name.toLowerCase().includes(query))
        : names;

    if (filtered.length === 0) {
        hideAutocomplete();
        return;
    }

    // Create or reuse popup
    if (!autocompleteEl) {
        autocompleteEl = document.createElement('div');
        autocompleteEl.className = 'conv-mention-popup';
        // Append to phone container for proper positioning
        const phoneEl = document.getElementById('conv-phone');
        (phoneEl || document.body).appendChild(autocompleteEl);
    }

    autocompleteEl.innerHTML = '';
    filtered.slice(0, 10).forEach((entry, i) => {
        const item = document.createElement('div');
        item.className = `conv-mention-item ${i === 0 ? 'active' : ''}`;
        item.dataset.name = entry.name;
        item.dataset.start = String(atIndex);

        // Avatar + name
        if (entry.avatar) {
            const img = document.createElement('img');
            img.src = entry.avatar;
            img.className = 'conv-mention-avatar';
            img.alt = '';
            item.appendChild(img);
        }

        const label = document.createElement('span');
        label.textContent = entry.name;
        item.appendChild(label);

        if (entry.type) {
            const badge = document.createElement('span');
            badge.className = 'conv-mention-badge';
            badge.textContent = entry.type;
            item.appendChild(badge);
        }

        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectMention(textarea, entry.name, atIndex);
        });
        autocompleteEl.appendChild(item);
    });

    // Position above textarea
    const rect = textarea.getBoundingClientRect();
    const phoneEl = document.getElementById('conv-phone');
    const containerRect = phoneEl ? phoneEl.getBoundingClientRect() : { top: 0, left: 0 };

    autocompleteEl.style.display = 'block';
    autocompleteEl.style.position = 'absolute';
    autocompleteEl.style.bottom = `${(phoneEl ? containerRect.bottom : window.innerHeight) - rect.top + 4}px`;
    autocompleteEl.style.left = '8px';
    autocompleteEl.style.right = '8px';
}

/**
 * Hide autocomplete popup.
 */
function hideAutocomplete() {
    if (autocompleteEl) {
        autocompleteEl.style.display = 'none';
    }
}

/**
 * Select a mention and insert into textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} name
 * @param {number} atIndex
 */
function selectMention(textarea, name, atIndex) {
    if (!textarea) return;

    const before = textarea.value.substring(0, atIndex);
    const after = textarea.value.substring(textarea.selectionStart);
    textarea.value = `${before}@${name} ${after}`;

    const newPos = atIndex + name.length + 2; // +2 for '@' and trailing space
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.focus();
    hideAutocomplete();

    // Trigger input event so auto-grow updates
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    if (onSelectCallback) {
        onSelectCallback({ name, startPos: atIndex, endPos: newPos - 1 });
    }
}

/**
 * Gather all mentionable names (characters, user persona, group members).
 * @returns {{ name: string, avatar: string, type: string }[]}
 */
function gatherNames() {
    const context = SillyTavern.getContext();
    const names = [];

    // Current character
    if (context.characterId !== undefined) {
        const char = context.characters[context.characterId];
        if (char?.name) {
            names.push({
                name: char.name,
                avatar: char.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}` : '',
                type: 'character',
            });
        }
    }

    // Group members (if in group chat)
    if (context.groupId && context.groups) {
        const group = context.groups.find(g => g.id === context.groupId);
        if (group?.members) {
            group.members.forEach(memberId => {
                const char = context.characters.find(c => c.avatar === memberId || c.name === memberId);
                if (char?.name && !names.some(n => n.name === char.name)) {
                    names.push({
                        name: char.name,
                        avatar: char.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}` : '',
                        type: 'group member',
                    });
                }
            });
        }
    }

    // User persona
    const userName = context.name1 || '{{user}}';
    names.push({
        name: userName,
        avatar: '/img/user-default.png',
        type: 'you',
    });

    return names;
}

/**
 * Ensure an element is visible within its scroll parent.
 * @param {HTMLElement} el
 */
function ensureVisible(el) {
    if (!el || !autocompleteEl) return;
    el.scrollIntoView({ block: 'nearest' });
}
