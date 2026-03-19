/**
 * Content script with dimension reporting, scrolling, and progress UI.
 */

let overlay = null;

function createOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'screenshot-extension-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    font-family: sans-serif;
    font-size: 14px;
    border-radius: 30px;
    z-index: 10000000;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    pointer-events: none;
    transition: opacity 0.3s;
  `;
  
  const spinner = document.createElement('div');
  spinner.style.cssText = `
    width: 18px;
    height: 18px;
    border: 2px solid #fff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: screenshot-spin 0.8s linear infinite;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes screenshot-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
  
  const text = document.createElement('span');
  text.id = 'screenshot-extension-text';
  text.textContent = 'Capturing...';
  
  overlay.appendChild(spinner);
  overlay.appendChild(text);
  document.body.appendChild(overlay);
}

function updateProgress(message) {
  createOverlay();
  const text = document.getElementById('screenshot-extension-text');
  if (text) text.textContent = message;
  overlay.style.opacity = '1';
}

function hideProgress() {
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
        overlay = null;
      }
    }, 300);
  }
}

function hideFixedElements() {
  const elements = document.querySelectorAll('*');
  for (const el of elements) {
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') {
      el.setAttribute('data-screenshot-original-visibility', el.style.visibility || 'visible');
      el.style.visibility = 'hidden';
    }
  }
}

function restoreFixedElements() {
  const elements = document.querySelectorAll('[data-screenshot-original-visibility]');
  for (const el of elements) {
    el.style.visibility = el.getAttribute('data-screenshot-original-visibility');
    el.removeAttribute('data-screenshot-original-visibility');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ pong: true });
  } else if (message.action === 'getDimensions') {
    const body = document.body;
    const html = document.documentElement;
    const height = Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);
    const width = Math.max(body.scrollWidth, body.offsetWidth, html.scrollWidth, html.offsetWidth);

    sendResponse({
      height, width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio || 1
    });
  } else if (message.action === 'scrollTo') {
    window.scrollTo(0, message.y);
    setTimeout(() => {
      sendResponse({ scrolled: true, currentY: window.scrollY });
    }, 1000);
    return true;
  } else if (message.action === 'showProgress') {
    updateProgress(message.text);
    sendResponse({ ok: true });
  } else if (message.action === 'hideProgress') {
    hideProgress();
    sendResponse({ ok: true });
  } else if (message.action === 'hideFixed') {
    hideFixedElements();
    sendResponse({ ok: true });
  } else if (message.action === 'restoreFixed') {
    restoreFixedElements();
    sendResponse({ ok: true });
  }
});
