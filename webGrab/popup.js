document.getElementById('fullPage').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'capture', type: 'full' });
  window.close();
});
