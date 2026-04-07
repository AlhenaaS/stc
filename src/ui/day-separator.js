/**
 * Day Separator component.
 */

import { createElement } from '../utils/dom-helpers.js';
import { formatDayLabel } from '../utils/time-helpers.js';

/**
 * Create a day separator element.
 * @param {Date|string|number} date
 * @returns {HTMLElement}
 */
export function createDaySeparator(date) {
    const wrapper = createElement('div', 'conv-day-separator');
    const line = createElement('div', 'conv-day-separator-line');
    const label = createElement('span', 'conv-day-separator-label', {
        textContent: formatDayLabel(date),
    });
    wrapper.appendChild(line);
    wrapper.appendChild(label);
    wrapper.appendChild(line.cloneNode(true));
    return wrapper;
}
