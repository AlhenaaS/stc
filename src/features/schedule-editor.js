/**
 * Schedule Editor UI: visual timeline editor for character schedules.
 * Uses SillyTavern's Popup API for the dialog.
 */

import { getScheduleData, generateSchedule, saveSchedule, clearSchedule, exportScheduleJSON, importScheduleJSON } from './schedule.js';
import { refreshStatus } from './status.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const STATUS_COLORS = {
    online: '#34C759',
    idle: '#FFCC00',
    dnd: '#FF3B30',
    offline: '#8E8E93',
};

const STATUS_LABELS = {
    online: 'Online',
    idle: 'Idle',
    dnd: 'DND',
    offline: 'Offline',
};

/**
 * Open the schedule editor popup.
 */
export async function openScheduleEditor() {
    const schedule = getScheduleData();
    const html = buildEditorHtml(schedule);

    const { Popup, POPUP_TYPE } = SillyTavern.getContext();

    // Read DOM values before the popup closes (it removes DOM on close)
    let savedSchedule = null;

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        wide: true,
        okButton: 'Save',
        cancelButton: 'Cancel',
        onClosing: (p) => {
            if (p.result === 1) { // POPUP_RESULT.AFFIRMATIVE
                savedSchedule = readEditorSchedule();
            }
            return true;
        },
    });

    // Wire up action buttons after render
    requestAnimationFrame(() => {
        wireEditorActions(popup);
    });

    const result = await popup.show();

    if (result && savedSchedule) {
        saveSchedule(savedSchedule);
        refreshStatus();
        toastr.success('Schedule saved');
    }
}

/**
 * Build the full schedule editor HTML.
 * @param {object|null} schedule
 * @returns {string}
 */
function buildEditorHtml(schedule) {
    let html = `<div class="conv-schedule-editor" id="conv-schedule-editor">
        <h3>Character Schedule Editor</h3>

        <div class="flex-container gap10" style="margin-bottom:12px;flex-wrap:wrap">
            <button id="conv-sched-regenerate" class="menu_button">Regenerate (LLM)</button>
            <button id="conv-sched-export" class="menu_button">Export JSON</button>
            <button id="conv-sched-import" class="menu_button">Import JSON</button>
            <button id="conv-sched-clear" class="menu_button redWarningRecBG">Clear Schedule</button>
        </div>

        <div class="conv-schedule-legend flex-container gap10" style="margin-bottom:8px;font-size:13px">
            ${Object.entries(STATUS_COLORS).map(([k, c]) =>
                `<span><span style="color:${c}">&#9632;</span> ${STATUS_LABELS[k]}</span>`
            ).join(' ')}
        </div>

        <div style="font-size:12px;color:var(--SmartThemeQuoteColor);margin-bottom:8px">
            Click a time block to edit. Times are in 24h format (HH:MM).
        </div>`;

    if (!schedule?.weekly) {
        html += `<div style="text-align:center;padding:30px;color:var(--SmartThemeQuoteColor)">
            <p>No schedule generated yet.</p>
            <p>Click <b>Regenerate</b> to create one using the LLM based on the character's personality.</p>
        </div>`;
    } else {
        // Timeline for each day
        DAYS.forEach(day => {
            const blocks = schedule.weekly[day] || [];
            html += buildDayRow(day, blocks);
        });

        // Autonomous messaging settings
        const am = schedule.autonomousMessaging || {};
        html += `
        <hr style="margin:12px 0" />
        <h4>Autonomous Messaging</h4>
        <div class="flex-container flexFlowColumn gap10">
            <div class="flex-container alignItemsCenter gap10">
                <input id="conv-sched-auto-enabled" type="checkbox" ${am.enabled ? 'checked' : ''} />
                <label for="conv-sched-auto-enabled">Allow character to initiate messages</label>
            </div>
            <div class="flex-container alignItemsCenter gap10">
                <label>Initiate after inactivity (seconds):</label>
                <input id="conv-sched-auto-inactivity" type="number" class="text_pole" min="60" max="7200"
                    value="${am.initiateAfterInactivity || 600}" style="width:90px" />
            </div>
            <div class="flex-container alignItemsCenter gap10">
                <label>Max initiations per day:</label>
                <input id="conv-sched-auto-max" type="number" class="text_pole" min="1" max="50"
                    value="${am.maxInitiationsPerDay || 5}" style="width:70px" />
            </div>
            <div class="flex-container alignItemsCenter gap10">
                <label>Response delay range (seconds):</label>
                <input id="conv-sched-auto-delay-min" type="number" class="text_pole" min="0" max="600"
                    value="${am.responseDelay?.min || 30}" style="width:70px" />
                <span>to</span>
                <input id="conv-sched-auto-delay-max" type="number" class="text_pole" min="0" max="600"
                    value="${am.responseDelay?.max || 180}" style="width:70px" />
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

/**
 * Build a single day's timeline row.
 * @param {string} day
 * @param {object[]} blocks
 * @returns {string}
 */
function buildDayRow(day, blocks) {
    const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);

    let timelineHtml = '';
    blocks.forEach((block, idx) => {
        const widthPct = getBlockWidth(block.from, block.to);
        const leftPct = getBlockLeft(block.from);
        const color = STATUS_COLORS[block.status] || STATUS_COLORS.online;
        const tooltip = `${block.from}-${block.to}: ${block.activity || block.status}`;

        timelineHtml += `<div class="conv-sched-block" data-day="${day}" data-idx="${idx}"
            style="left:${leftPct}%;width:${Math.max(widthPct, 0.5)}%;background:${color}"
            title="${tooltip}"></div>`;
    });

    // Hidden data for each block (for editing)
    let blocksDataHtml = '';
    blocks.forEach((block, idx) => {
        blocksDataHtml += `
        <div class="conv-sched-block-data" data-day="${day}" data-idx="${idx}" style="display:none">
            <input class="conv-sched-from" type="text" value="${block.from}" />
            <input class="conv-sched-to" type="text" value="${block.to}" />
            <select class="conv-sched-status">
                ${Object.keys(STATUS_COLORS).map(s =>
                    `<option value="${s}" ${s === block.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`
                ).join('')}
            </select>
            <input class="conv-sched-activity" type="text" value="${block.activity || ''}" />
        </div>`;
    });

    return `
    <div class="conv-sched-day-row flex-container alignItemsCenter gap10" style="margin-bottom:4px">
        <span class="conv-sched-day-label" style="width:80px;font-size:13px;font-weight:600">${dayLabel}</span>
        <div class="conv-sched-timeline" style="flex:1;height:20px;background:rgba(128,128,128,0.15);
            border-radius:4px;position:relative;overflow:hidden;cursor:pointer"
            data-day="${day}">
            ${timelineHtml}
        </div>
        <button class="conv-sched-day-edit menu_button" data-day="${day}"
            style="font-size:11px;padding:2px 8px">Edit</button>
    </div>
    ${blocksDataHtml}`;
}

/**
 * Wire up action buttons in the editor.
 * @param {object} popup
 */
function wireEditorActions(popup) {
    // Regenerate
    document.getElementById('conv-sched-regenerate')?.addEventListener('click', async () => {
        const schedule = await generateSchedule();
        if (schedule) {
            // Close current editor and re-open with regenerated data
            await popup.completeCancelled();
            openScheduleEditor();
        }
    });

    // Export
    document.getElementById('conv-sched-export')?.addEventListener('click', () => {
        const json = exportScheduleJSON();
        if (json) {
            navigator.clipboard.writeText(json).then(() => {
                toastr.success('Schedule JSON copied to clipboard');
            }).catch(() => {
                // Fallback: show in alert
                prompt('Schedule JSON:', json);
            });
        } else {
            toastr.warning('No schedule to export');
        }
    });

    // Import
    document.getElementById('conv-sched-import')?.addEventListener('click', async () => {
        const json = prompt('Paste schedule JSON:');
        if (json) {
            if (importScheduleJSON(json)) {
                toastr.success('Schedule imported');
                // Close without triggering save (import already saved)
                await popup.completeCancelled();
                // Re-open to show updated data
                openScheduleEditor();
            }
        }
    });

    // Clear
    document.getElementById('conv-sched-clear')?.addEventListener('click', async () => {
        if (confirm('Clear the character schedule? This cannot be undone.')) {
            clearSchedule();
            toastr.info('Schedule cleared');
            // Close without triggering save (clear already saved)
            await popup.completeCancelled();
        }
    });

    // Day edit buttons — open block editor for that day
    document.querySelectorAll('.conv-sched-day-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const day = btn.dataset.day;
            openDayBlockEditor(day);
        });
    });
}

/**
 * Open an inline block editor for a specific day.
 * @param {string} day
 */
async function openDayBlockEditor(day) {
    const schedule = getScheduleData();
    const blocks = schedule?.weekly?.[day] || [];

    const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);

    let blocksHtml = blocks.map((block, idx) => `
        <div class="flex-container alignItemsCenter gap10" style="margin-bottom:4px" data-block-idx="${idx}">
            <input type="text" class="text_pole conv-day-from" value="${block.from}" style="width:60px"
                placeholder="HH:MM" />
            <span>-</span>
            <input type="text" class="text_pole conv-day-to" value="${block.to}" style="width:60px"
                placeholder="HH:MM" />
            <select class="text_pole conv-day-status" style="width:100px">
                ${Object.keys(STATUS_COLORS).map(s =>
                    `<option value="${s}" ${s === block.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`
                ).join('')}
            </select>
            <input type="text" class="text_pole conv-day-activity" value="${block.activity || ''}"
                style="flex:1" placeholder="Activity" />
            <button class="menu_button conv-day-remove" data-idx="${idx}" style="padding:2px 6px">X</button>
        </div>
    `).join('');

    const html = `
    <div class="conv-day-editor" id="conv-day-editor">
        <h3>${dayLabel} Schedule</h3>
        <div id="conv-day-blocks">${blocksHtml}</div>
        <button id="conv-day-add" class="menu_button" style="margin-top:8px">+ Add Block</button>
    </div>`;

    const { Popup, POPUP_TYPE } = SillyTavern.getContext();

    // We need to read DOM values before the popup closes (it removes DOM on close).
    // Store blocks in a closure variable, read them in onClosing callback.
    let savedBlocks = null;

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Save Day',
        cancelButton: 'Cancel',
        onClosing: (p) => {
            // Only read values if the user clicked OK (affirmative)
            if (p.result === 1) { // POPUP_RESULT.AFFIRMATIVE
                savedBlocks = readDayBlocksFromDOM();
            }
            return true; // allow closing
        },
    });

    // Wire add/remove buttons
    requestAnimationFrame(() => {
        document.getElementById('conv-day-add')?.addEventListener('click', () => {
            const container = document.getElementById('conv-day-blocks');
            if (!container) return;
            const idx = container.children.length;
            const newBlock = document.createElement('div');
            newBlock.className = 'flex-container alignItemsCenter gap10';
            newBlock.style.marginBottom = '4px';
            newBlock.dataset.blockIdx = idx;
            newBlock.innerHTML = `
                <input type="text" class="text_pole conv-day-from" value="00:00" style="width:60px" />
                <span>-</span>
                <input type="text" class="text_pole conv-day-to" value="01:00" style="width:60px" />
                <select class="text_pole conv-day-status" style="width:100px">
                    ${Object.keys(STATUS_COLORS).map(s =>
                        `<option value="${s}">${STATUS_LABELS[s]}</option>`
                    ).join('')}
                </select>
                <input type="text" class="text_pole conv-day-activity" style="flex:1" placeholder="Activity" />
                <button class="menu_button conv-day-remove" style="padding:2px 6px">X</button>
            `;
            container.appendChild(newBlock);
            wireRemoveButtons();
        });
        wireRemoveButtons();
    });

    const result = await popup.show();
    if (result && savedBlocks !== null) {
        // Sort by start time
        savedBlocks.sort((a, b) => a.from.localeCompare(b.from));

        // Save
        if (schedule?.weekly) {
            schedule.weekly[day] = savedBlocks;
            saveSchedule(schedule);
            refreshStatus();
            toastr.success(`${dayLabel} schedule updated`);
        }
    }
}

/**
 * Wire remove buttons for day block editor.
 */
function wireRemoveButtons() {
    document.querySelectorAll('.conv-day-remove').forEach(btn => {
        btn.onclick = () => btn.closest('[data-block-idx]')?.remove();
    });
}

/**
 * Read day blocks from the day editor DOM (before popup closes and removes DOM).
 * @returns {object[]}
 */
function readDayBlocksFromDOM() {
    const blocks = [];
    const container = document.getElementById('conv-day-blocks');
    if (!container) return blocks;

    Array.from(container.children).forEach(row => {
        const from = row.querySelector('.conv-day-from')?.value?.trim();
        const to = row.querySelector('.conv-day-to')?.value?.trim();
        const status = row.querySelector('.conv-day-status')?.value;
        const activity = row.querySelector('.conv-day-activity')?.value?.trim();
        if (from && to) {
            blocks.push({ from, to, status: status || 'online', activity: activity || '' });
        }
    });

    return blocks;
}

/**
 * Read the autonomous messaging settings from the editor DOM.
 * @returns {object|null}
 */
function readEditorSchedule() {
    const schedule = getScheduleData();
    if (!schedule) return null;

    // Read autonomous messaging settings
    const autoEnabled = document.getElementById('conv-sched-auto-enabled')?.checked ?? false;
    const inactivity = parseInt(document.getElementById('conv-sched-auto-inactivity')?.value, 10) || 600;
    const maxDaily = parseInt(document.getElementById('conv-sched-auto-max')?.value, 10) || 5;
    const delayMin = parseInt(document.getElementById('conv-sched-auto-delay-min')?.value, 10) || 30;
    const delayMax = parseInt(document.getElementById('conv-sched-auto-delay-max')?.value, 10) || 180;

    return {
        ...schedule,
        autonomousMessaging: {
            enabled: autoEnabled,
            initiateAfterInactivity: inactivity,
            maxInitiationsPerDay: maxDaily,
            responseDelay: { min: delayMin, max: delayMax },
        },
    };
}

// --- Helper functions ---

function getBlockWidth(from, to) {
    const fromMin = timeToMinutes(from);
    let toMin = timeToMinutes(to);
    if (toMin <= fromMin) toMin += 1440;
    return ((toMin - fromMin) / 1440) * 100;
}

function getBlockLeft(from) {
    return (timeToMinutes(from) / 1440) * 100;
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}
