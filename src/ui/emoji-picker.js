/**
 * Emoji Picker: simple Unicode emoji grid.
 * Opens above the input bar, allows clicking to insert emoji into textarea.
 */

/** Emoji categories with Unicode characters */
const EMOJI_CATEGORIES = {
    'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷', '🤒', '🥵', '🥶', '😱', '😨', '😰', '😥', '😢', '😭', '😤', '😠', '😡'],
    'Gestures': ['👋', '🤚', '✋', '🖖', '👌', '🤏', '✌', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '🤝', '🙏', '💪'],
    'Hearts': ['❤', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
    'Nature': ['🌸', '💐', '🌹', '🌺', '🌻', '🌼', '🌱', '🌲', '🌳', '🌴', '🍀', '☀', '🌤', '⛅', '🌧', '🌈', '❄', '🔥', '💧', '⭐', '✨', '🌟', '💫'],
    'Food': ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🍕', '🍔', '🍟', '🌮', '🍿', '🥤', '☕', '🍵', '🍺', '🍷', '🍸', '🥂'],
    'Activities': ['⚽', '🏀', '🎮', '🎲', '🎯', '🎨', '🎬', '🎤', '🎧', '🎵', '🎶', '🎸', '🎹'],
    'Objects': ['📱', '💻', '📷', '💡', '📖', '📝', '💌', '📧', '🔑', '💰', '💎', '🎁', '🏆'],
    'Symbols': ['💥', '❗', '❓', '⁉', '‼', '✅', '❌', '⭕', '🔴', '🟡', '🟢', '🔵', '💯', '🆗', '🆕'],
};

/** Recently used emojis (stored in localStorage) */
const RECENT_KEY = 'conv_recent_emojis';
const MAX_RECENT = 20;

let pickerEl = null;
let onSelectCallback = null;

/**
 * Open the emoji picker.
 * @param {HTMLElement} anchorEl - Element to position near
 * @param {Function} onSelect - Called with selected emoji string
 */
export function openEmojiPicker(anchorEl, onSelect) {
    closeEmojiPicker();
    onSelectCallback = onSelect;

    pickerEl = document.createElement('div');
    pickerEl.className = 'conv-emoji-picker';

    // Search input
    const searchInput = document.createElement('input');
    searchInput.className = 'conv-emoji-search';
    searchInput.placeholder = 'Search...';
    searchInput.type = 'text';
    pickerEl.appendChild(searchInput);

    // Categories tabs
    const tabBar = document.createElement('div');
    tabBar.className = 'conv-emoji-tabs';
    const allCategories = ['Recent', ...Object.keys(EMOJI_CATEGORIES)];

    allCategories.forEach((cat, i) => {
        const tab = document.createElement('button');
        tab.className = `conv-emoji-tab ${i === 0 ? 'active' : ''}`;
        tab.textContent = cat === 'Recent' ? '🕐' : Object.values(EMOJI_CATEGORIES)[i - 1]?.[0] || cat.charAt(0);
        tab.title = cat;
        tab.dataset.category = cat;
        tab.addEventListener('click', () => {
            tabBar.querySelectorAll('.conv-emoji-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            showCategory(grid, cat);
        });
        tabBar.appendChild(tab);
    });
    pickerEl.appendChild(tabBar);

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'conv-emoji-grid';
    pickerEl.appendChild(grid);

    // Show recent by default
    showCategory(grid, 'Recent');

    // Search filtering
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            const activeTab = tabBar.querySelector('.conv-emoji-tab.active');
            showCategory(grid, activeTab?.dataset.category || 'Recent');
            return;
        }
        showSearchResults(grid, query);
    });

    // Position near anchor (above, inside phone frame)
    const phoneEl = document.getElementById('conv-phone');
    const container = phoneEl || document.body;
    container.appendChild(pickerEl);

    const anchorRect = anchorEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    pickerEl.style.position = 'absolute';
    pickerEl.style.bottom = `${containerRect.bottom - anchorRect.top + 4}px`;
    pickerEl.style.left = '8px';
    pickerEl.style.right = '8px';

    // Focus search
    searchInput.focus();

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 10);
}

/**
 * Close the emoji picker.
 */
export function closeEmojiPicker() {
    if (pickerEl) {
        pickerEl.remove();
        pickerEl = null;
    }
    document.removeEventListener('click', handleOutsideClick);
    onSelectCallback = null;
}

/**
 * Show emojis from a specific category.
 * @param {HTMLElement} grid
 * @param {string} category
 */
function showCategory(grid, category) {
    grid.innerHTML = '';

    let emojis;
    if (category === 'Recent') {
        emojis = getRecentEmojis();
        if (emojis.length === 0) {
            grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--conv-text-secondary);font-size:13px">No recent emojis</div>';
            return;
        }
    } else {
        emojis = EMOJI_CATEGORIES[category] || [];
    }

    renderEmojiButtons(grid, emojis);
}

/**
 * Show search results.
 * @param {HTMLElement} grid
 * @param {string} query
 */
function showSearchResults(grid, query) {
    grid.innerHTML = '';

    // Search all categories (simple: check if category name matches)
    const results = [];
    Object.entries(EMOJI_CATEGORIES).forEach(([cat, emojis]) => {
        if (cat.toLowerCase().includes(query)) {
            results.push(...emojis);
        }
    });

    // Also check individual emojis (by character match — limited but works)
    if (results.length === 0) {
        Object.values(EMOJI_CATEGORIES).forEach(emojis => {
            results.push(...emojis);
        });
    }

    if (results.length === 0) {
        grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--conv-text-secondary);font-size:13px">No results</div>';
        return;
    }

    renderEmojiButtons(grid, results.slice(0, 60));
}

/**
 * Render emoji buttons in the grid.
 * @param {HTMLElement} grid
 * @param {string[]} emojis
 */
function renderEmojiButtons(grid, emojis) {
    const row = document.createElement('div');
    row.className = 'conv-emoji-row';

    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'conv-emoji-btn';
        btn.textContent = emoji;
        btn.title = emoji;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToRecent(emoji);
            if (onSelectCallback) onSelectCallback(emoji);
            closeEmojiPicker();
        });
        row.appendChild(btn);
    });

    grid.appendChild(row);
}

/**
 * Get recently used emojis from localStorage.
 * @returns {string[]}
 */
function getRecentEmojis() {
    try {
        const stored = localStorage.getItem(RECENT_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Add an emoji to the recent list.
 * @param {string} emoji
 */
function addToRecent(emoji) {
    try {
        let recent = getRecentEmojis();
        recent = recent.filter(e => e !== emoji);
        recent.unshift(emoji);
        if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch { /* ignore */ }
}

function handleOutsideClick(e) {
    if (pickerEl && !pickerEl.contains(e.target)) {
        closeEmojiPicker();
    }
}
