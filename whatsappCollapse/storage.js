/**
 * storage.js — Thin chrome/browser storage wrapper for WA-Focus
 *
 * Abstracts the difference between Chrome (chrome.storage) and
 * Firefox (browser.storage) into a single API.
 *
 * Lazily resolves the storage API on each call because at
 * document_start, chrome.storage.local may not yet be available.
 */

const DEFAULTS = {
  sidebarCollapsed: false,
  sidebarBlurred: false,
};

/**
 * Lazily resolve the storage.local API.
 * At document_start chrome.storage may exist but .local may not yet.
 * @returns {chrome.storage.LocalStorageArea|null}
 */
function _getStorageLocal() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
  } catch (e) {
    // Storage API not available yet
  }
  return null;
}

/**
 * Read current state from storage.
 * @returns {Promise<{sidebarCollapsed: boolean, sidebarBlurred: boolean}>}
 */
function getState() {
  return new Promise((resolve) => {
    const local = _getStorageLocal();
    if (!local) {
      resolve({ ...DEFAULTS });
      return;
    }
    try {
      local.get(DEFAULTS, (result) => {
        if (chrome.runtime.lastError) {
          resolve({ ...DEFAULTS });
          return;
        }
        resolve(result);
      });
    } catch (e) {
      resolve({ ...DEFAULTS });
    }
  });
}

/**
 * Merge a partial state update into storage.
 * @param {Partial<{sidebarCollapsed: boolean, sidebarBlurred: boolean}>} patch
 * @returns {Promise<void>}
 */
function setState(patch) {
  return new Promise((resolve) => {
    const local = _getStorageLocal();
    if (!local) {
      resolve();
      return;
    }
    try {
      local.set(patch, () => {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}
