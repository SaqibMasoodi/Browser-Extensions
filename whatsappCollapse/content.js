/**
 * content.js — WA-Focus core content script
 *
 * Runs at document_start on web.whatsapp.com.
 * Observes the DOM for WhatsApp's sidebar, injects toggle buttons,
 * and manages collapse/blur state with persistence.
 *
 * IMPORTANT: No class-name selectors. WhatsApp randomises them.
 * Only id, aria-label, role, and data-testid attributes.
 */

/* ===================================================================
   OQ-1: Keyboard shortcuts — not finalised.
   Stored in a config object for easy modification.
   =================================================================== */
const SHORTCUTS = {
  collapse: { key: '\\', ctrlKey: true, shiftKey: false, altKey: false },
  blur:     { key: 'b', ctrlKey: true, shiftKey: true,  altKey: false },
};

/* ===================================================================
   SVG ICONS
   =================================================================== */
const ICONS = {
  chevronLeft: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`,

  eyeOff: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`,

  eye: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`,

  warning: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
};

/* ===================================================================
   STATE
   =================================================================== */
let sidebarEl = null;
let buttonsInjected = false;
let collapseBtn = null;
let blurBtn = null;
let mainObserver = null;
let buttonWatcher = null;
let initTimeout = null;
const TIMEOUT_MS = 30000;

/* ===================================================================
   DOM FINDERS — two-level fallback, no class selectors
   =================================================================== */

/**
 * Find the sidebar element using fallback chain.
 * @returns {HTMLElement|null}
 */
function findSidebar() {
  return (
    document.querySelector('div#side') ||
    document.querySelector("div[aria-label='Chat list']") ||
    document.querySelector("div[role='navigation']") ||
    null
  );
}

/**
 * Find the icon panel (vertical left bar with Chats/Status/Channels icons).
 *
 * Strategy: locate a known nav button (e.g. "Chats") and walk up the DOM
 * to find the vertical column container that holds all the icon buttons.
 *
 * @returns {HTMLElement|null}
 */
function findIconPanel() {
  // Primary: find a known WhatsApp nav button and walk up to its container
  const knownLabels = ['Chats', 'Status', 'Communities', 'Channels'];
  for (const label of knownLabels) {
    const btn = document.querySelector(`button[aria-label="${label}"]`);
    if (btn) {
      // Walk up to find the column container that holds all nav buttons.
      // The button is typically nested: container > wrapper > span > button
      // We want the outermost column container (the narrow dark strip).
      let el = btn.parentElement;
      while (el) {
        // Look for a container that has multiple button descendants
        // and is taller than it is wide (vertical strip)
        const buttons = el.querySelectorAll('button[aria-label]');
        if (buttons.length >= 3) {
          // Found the container with multiple nav buttons — this is the panel
          return el;
        }
        // Don't walk past #app
        if (el.id === 'app' || el === document.body) break;
        el = el.parentElement;
      }
    }
  }

  // Fallback: data-testid='chatlist-header' parent (older WA versions)
  const header = document.querySelector("div[data-testid='chatlist-header']");
  if (header && header.parentElement) return header.parentElement;

  // Fallback: nav element
  const nav = document.querySelector("nav[role='navigation']");
  if (nav) return nav;

  // Fallback: header inside #side
  if (sidebarEl) {
    const headerInSide = sidebarEl.querySelector('header');
    if (headerInSide) return headerInSide;
  }

  return null;
}

/* ===================================================================
   BUTTON CREATION
   =================================================================== */

/**
 * Create a toggle button (collapse or blur).
 * @param {'collapse'|'blur'} type
 * @param {boolean} isActive
 * @returns {HTMLButtonElement}
 */
function createButton(type, isActive) {
  const btn = document.createElement('button');
  btn.className = `wa-focus-btn wa-focus-btn-${type}`;
  btn.id = `wa-focus-${type}-btn`;

  if (type === 'collapse') {
    btn.innerHTML = ICONS.chevronLeft;
    btn.setAttribute('data-tooltip', isActive ? 'Show sidebar' : 'Hide sidebar');
    if (isActive) btn.classList.add('wa-focus-active');
  } else {
    btn.innerHTML = isActive ? ICONS.eye : ICONS.eyeOff;
    btn.setAttribute('data-tooltip', isActive ? 'Unblur sidebar' : 'Blur sidebar');
    if (isActive) btn.classList.add('wa-focus-active');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleState(type);
  });

  return btn;
}

/* ===================================================================
   DIVIDER LINE HELPER
   =================================================================== */

/**
 * Remove all vertical border lines around the collapsed sidebar.
 *
 * WhatsApp renders borders in multiple places:
 *   - A dedicated 0.8px divider element (sibling of wrapper)
 *   - border-left on the main content container itself
 *   - Possibly border-right on the wrapper
 *
 * On collapse we strip ALL of these. On restore we put them back.
 *
 * @param {HTMLElement} wrapper - the sidebar wrapper element (parent of #side)
 * @param {boolean} hide - true to strip borders, false to restore them
 */
function hideBorders(wrapper, hide) {
  if (!wrapper || !wrapper.parentElement) return;

  const grandparent = wrapper.parentElement;
  const children = Array.from(grandparent.children);

  for (const child of children) {
    if (hide) {
      const cs = window.getComputedStyle(child);
      const w = parseFloat(cs.width);
      const bl = cs.borderLeft;
      const br = cs.borderRight;
      const bs = cs.boxShadow;

      // 1. Hide narrow dividers/spacers entirely
      if (w <= 3) {
        if (!child.dataset.waFocusOrigDisplay) {
          child.dataset.waFocusOrigDisplay = cs.display;
        }
        child.style.setProperty('display', 'none', 'important');
      }

      // 2. Strip borders (check for any non-zero/hidden border)
      // bl/br can be "0px none rgb(0,0,0)" or similar when "none"
      const hasBL = bl && bl !== 'none' && !bl.startsWith('0px');
      const hasBR = br && br !== 'none' && !br.startsWith('0px');

      if (hasBL) {
        if (!child.dataset.waFocusOrigBL) {
          child.dataset.waFocusOrigBL = child.style.borderLeft || bl;
        }
        child.style.setProperty('border-left', 'none', 'important');
      }
      if (hasBR) {
        if (!child.dataset.waFocusOrigBR) {
          child.dataset.waFocusOrigBR = child.style.borderRight || br;
        }
        child.style.setProperty('border-right', 'none', 'important');
      }

      // 3. Strip shadows
      if (bs && bs !== 'none') {
        if (!child.dataset.waFocusOrigBS) {
          child.dataset.waFocusOrigBS = child.style.boxShadow || bs;
        }
        child.style.setProperty('box-shadow', 'none', 'important');
      }
    } else {
      // Restore...
      if (child.dataset.waFocusOrigDisplay) {
        child.style.removeProperty('display');
        delete child.dataset.waFocusOrigDisplay;
      }
      if (child.dataset.waFocusOrigBL) {
        child.style.setProperty('border-left', child.dataset.waFocusOrigBL);
        delete child.dataset.waFocusOrigBL;
      }
      if (child.dataset.waFocusOrigBR) {
        child.style.setProperty('border-right', child.dataset.waFocusOrigBR);
        delete child.dataset.waFocusOrigBR;
      }
      if (child.dataset.waFocusOrigBS) {
        child.style.setProperty('box-shadow', child.dataset.waFocusOrigBS);
        delete child.dataset.waFocusOrigBS;
      }
    }
  }
}

/* ===================================================================
   STATE APPLICATION
   =================================================================== */

/**
 * Apply the current stored state to the sidebar DOM.
 * Collapse is applied to BOTH the wrapper (parent of #side) and #side itself,
 * because WhatsApp sets flex-basis ~30% on the wrapper. Without collapsing the
 * wrapper, the main chat pane can't reclaim the space.
 * @param {{sidebarCollapsed: boolean, sidebarBlurred: boolean}} state
 */
function applyState(state) {
  if (!sidebarEl) return;

  const wrapper = sidebarEl.parentElement;

  // --- Collapse ---
  if (state.sidebarCollapsed) {
    // Collapse the wrapper (kills flex-basis so main pane expands)
    if (wrapper) {
      wrapper.classList.add('wa-focus-collapsed');
      wrapper.classList.remove('wa-focus-expanded');
      // Hide the divider line (thin border sibling next to wrapper)
      hideBorders(wrapper, true);
    }
    // Collapse the inner sidebar content
    sidebarEl.classList.add('wa-focus-collapsed-inner');
  } else {
    if (wrapper) {
      wrapper.classList.remove('wa-focus-collapsed');
      wrapper.classList.add('wa-focus-expanded');
      setTimeout(() => {
        if (wrapper) wrapper.classList.remove('wa-focus-expanded');
      }, 300);
      // Restore the divider line
      hideBorders(wrapper, false);
    }
    sidebarEl.classList.remove('wa-focus-collapsed-inner');
  }

  // --- Blur ---
  if (state.sidebarBlurred) {
    sidebarEl.classList.add('wa-focus-blurred');
  } else {
    sidebarEl.classList.remove('wa-focus-blurred');
  }

  // --- Flex fix on grandparent (always applied to prevent white gap) ---
  if (wrapper && wrapper.parentElement) {
    wrapper.parentElement.classList.add('wa-focus-flex-fix');
  }

  // --- Update button visuals ---
  updateButtonVisuals(state);
}

/**
 * Update button icons and tooltips to match current state.
 * @param {{sidebarCollapsed: boolean, sidebarBlurred: boolean}} state
 */
function updateButtonVisuals(state) {
  if (collapseBtn) {
    if (state.sidebarCollapsed) {
      collapseBtn.classList.add('wa-focus-active');
      collapseBtn.setAttribute('data-tooltip', 'Show sidebar');
    } else {
      collapseBtn.classList.remove('wa-focus-active');
      collapseBtn.setAttribute('data-tooltip', 'Hide sidebar');
    }
  }

  if (blurBtn) {
    if (state.sidebarBlurred) {
      blurBtn.classList.add('wa-focus-active');
      blurBtn.innerHTML = ICONS.eye;
      blurBtn.setAttribute('data-tooltip', 'Unblur sidebar');
    } else {
      blurBtn.classList.remove('wa-focus-active');
      blurBtn.innerHTML = ICONS.eyeOff;
      blurBtn.setAttribute('data-tooltip', 'Blur sidebar');
    }
  }
}

/* ===================================================================
   TOGGLE LOGIC
   =================================================================== */

/**
 * Toggle a specific state and persist it.
 * @param {'collapse'|'blur'} type
 */
async function toggleState(type) {
  const state = await getState();

  if (type === 'collapse') {
    state.sidebarCollapsed = !state.sidebarCollapsed;
  } else {
    state.sidebarBlurred = !state.sidebarBlurred;
  }

  // OQ-3: When both blur and collapse are active simultaneously,
  // there is no visible cue that blur is active. This is a known
  // open question — no visual indicator is implemented for V1.

  await setState(state);
  applyState(state);
}

/* ===================================================================
   BUTTON INJECTION
   =================================================================== */

/**
 * Inject collapse and blur buttons into the icon panel.
 * @param {{sidebarCollapsed: boolean, sidebarBlurred: boolean}} state
 */
function injectButtons(state) {
  // Don't double-inject
  if (document.getElementById('wa-focus-collapse-btn') &&
      document.getElementById('wa-focus-blur-btn')) {
    buttonsInjected = true;
    collapseBtn = document.getElementById('wa-focus-collapse-btn');
    blurBtn = document.getElementById('wa-focus-blur-btn');
    return;
  }

  const panel = findIconPanel();
  if (!panel) return;

  // Create buttons
  collapseBtn = createButton('collapse', state.sidebarCollapsed);
  blurBtn = createButton('blur', state.sidebarBlurred);

  // Create a container for our buttons
  const container = document.createElement('div');
  container.id = 'wa-focus-controls';
  container.style.cssText = 'display: flex; flex-direction: column; align-items: center; padding: 4px 0; gap: 2px;';
  container.appendChild(collapseBtn);
  container.appendChild(blurBtn);

  // Insert at the end of the panel
  panel.appendChild(container);
  buttonsInjected = true;

  // Watch for WhatsApp re-renders that might wipe our buttons
  watchButtonRemoval();
}

/**
 * Watch for WhatsApp SPA re-renders that wipe our injected buttons.
 * Re-injects them if they disappear.
 */
function watchButtonRemoval() {
  if (buttonWatcher) buttonWatcher.disconnect();

  buttonWatcher = new MutationObserver(() => {
    // Check if our buttons are still in the DOM
    if (!document.getElementById('wa-focus-controls')) {
      buttonsInjected = false;
      collapseBtn = null;
      blurBtn = null;
      // Re-inject
      getState().then((state) => {
        injectButtons(state);
      });
    }
  });

  // Watch the sidebar's ancestor for removals
  const appEl = document.getElementById('app') || document.body;
  buttonWatcher.observe(appEl, { childList: true, subtree: true });
}

/* ===================================================================
   WARNING UI
   =================================================================== */

/**
 * Show a non-intrusive warning when sidebar cannot be found after timeout.
 */
function showWarning() {
  if (document.getElementById('wa-focus-warning')) return;

  const warn = document.createElement('div');
  warn.id = 'wa-focus-warning';
  warn.className = 'wa-focus-warning';
  warn.innerHTML = `${ICONS.warning} <span>WA-Focus: Sidebar not found. Extension may not work on this page.</span>`;
  warn.addEventListener('click', () => warn.remove());
  document.body.appendChild(warn);
}

/* ===================================================================
   KEYBOARD SHORTCUTS
   =================================================================== */

function handleKeyboard(e) {
  // Check collapse shortcut
  const c = SHORTCUTS.collapse;
  if (e.key === c.key &&
      e.ctrlKey === c.ctrlKey &&
      e.shiftKey === c.shiftKey &&
      e.altKey === c.altKey) {
    e.preventDefault();
    toggleState('collapse');
    return;
  }

  // Check blur shortcut
  const b = SHORTCUTS.blur;
  if (e.key === b.key &&
      e.ctrlKey === b.ctrlKey &&
      e.shiftKey === b.shiftKey &&
      e.altKey === b.altKey) {
    e.preventDefault();
    toggleState('blur');
  }
}

/* ===================================================================
   STYLE INJECTION — Fallback for manifest-declared CSS
   =================================================================== */

/**
 * Manually inject styles.css if not already present.
 * This ensures the layout fixes are applied even if manifest injection
 * is delayed in WhatsApp's dynamic environment.
 */
function injectStyles() {
  if (document.getElementById('wa-focus-styles-manual')) return;
  const link = document.createElement('link');
  link.id = 'wa-focus-styles-manual';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles.css');
  (document.head || document.documentElement).appendChild(link);
}

/* ===================================================================
   MAIN INIT — MutationObserver strategy
   =================================================================== */

/**
 * Called when sidebar is found in the DOM.
 * Applies stored state and injects buttons.
 */
async function onSidebarFound(sidebar) {
  sidebarEl = sidebar;

  // Clear timeout since we found the sidebar
  if (initTimeout) {
    clearTimeout(initTimeout);
    initTimeout = null;
  }

  // Remove any existing warning
  const warn = document.getElementById('wa-focus-warning');
  if (warn) warn.remove();

  // Read stored state and apply immediately
  const state = await getState();
  applyState(state);
  injectButtons(state);
}

/**
 * Start observing the DOM for the sidebar element.
 * WhatsApp is a React SPA — the sidebar may not exist at script init.
 */
function startObserving() {
  // Try immediately first
  const sidebar = findSidebar();
  if (sidebar) {
    onSidebarFound(sidebar);
    // Still observe for sidebar disappearance/re-appearance
    observeForChanges();
    return;
  }

  // Set up MutationObserver on #app or body
  const root = document.getElementById('app') || document.body;

  mainObserver = new MutationObserver(() => {
    const sidebar = findSidebar();
    if (sidebar) {
      mainObserver.disconnect();
      mainObserver = null;
      onSidebarFound(sidebar);
      // Continue observing for sidebar disappearance
      observeForChanges();
    }
  });

  mainObserver.observe(root, { childList: true, subtree: true });

  // Hard timeout: 30 seconds
  initTimeout = setTimeout(() => {
    if (!sidebarEl) {
      if (mainObserver) {
        mainObserver.disconnect();
        mainObserver = null;
      }
      showWarning();
    }
  }, TIMEOUT_MS);
}

/**
 * After sidebar is found, continue watching for it to disappear
 * (e.g. WhatsApp internal navigation) and re-appear.
 */
function observeForChanges() {
  const changeObserver = new MutationObserver(() => {
    const sidebar = findSidebar();

    if (!sidebar && sidebarEl) {
      // Sidebar disappeared — reset and watch for re-appearance
      sidebarEl = null;
      buttonsInjected = false;
      collapseBtn = null;
      blurBtn = null;
      changeObserver.disconnect();
      startObserving();
    } else if (sidebar && !sidebarEl) {
      // Sidebar re-appeared
      onSidebarFound(sidebar);
    }
  });

  const root = document.getElementById('app') || document.body;
  changeObserver.observe(root, { childList: true, subtree: true });
}

/* ===================================================================
   BOOT
   =================================================================== */

// Register keyboard shortcuts
document.addEventListener('keydown', handleKeyboard);

// Start observing — runs at document_start, so DOM may not be ready yet
injectStyles();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  startObserving();
}
