/**
 * Scene Banner component: shows "Scene in progress" banner in conversation mode.
 */

/**
 * Show the scene banner with scene info.
 * @param {object} sceneInfo
 * @param {string} sceneInfo.title
 * @param {Function} onGoToScene
 */
export function showSceneBanner(sceneInfo, onGoToScene) {
    const banner = document.getElementById('conv-scene-banner');
    const nameEl = document.getElementById('conv-scene-banner-name');
    const goBtn = document.getElementById('conv-scene-banner-go');

    if (banner) {
        banner.style.display = 'flex';
        if (nameEl) nameEl.textContent = `"${sceneInfo.title}"`;
        if (goBtn) {
            goBtn.onclick = onGoToScene;
        }
    }
}

/**
 * Hide the scene banner.
 */
export function hideSceneBanner() {
    const banner = document.getElementById('conv-scene-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}
