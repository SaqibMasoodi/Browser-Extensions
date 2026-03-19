/**
 * Background Service Worker for orchestrating full-page capture.
 */

chrome.commands.onCommand.addListener((command) => {
  if (command === '_execute_action') {
    if (isCapturing) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) captureFullPage(tabs[0].id);
    });
  }
});

let isCapturing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture') {
    if (isCapturing) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) captureFullPage(tabs[0].id);
    });
  }
});

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }
}

async function captureFullPage(tabId) {
  if (isCapturing) return;
  isCapturing = true;
  try {
    await ensureContentScriptInjected(tabId);

    const dimensions = await chrome.tabs.sendMessage(tabId, { action: 'getDimensions' });
    const { height, width, viewportHeight, devicePixelRatio } = dimensions;

    await chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: 'Preparing...' });
    await chrome.tabs.sendMessage(tabId, { action: 'hideFixed' });

    const chunks = [];
    let currentY = 0;
    let lastActualY = -1;

    while (currentY < height) {
      const progressText = `Capturing ${Math.min(100, Math.round((currentY / height) * 100))}%`;
      await chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: progressText });

      const response = await chrome.tabs.sendMessage(tabId, { action: 'scrollTo', y: currentY });
      const actualY = response.currentY;
      
      if (actualY === lastActualY && currentY > 0) break;
      
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      chunks.push({ dataUrl, x: 0, y: actualY });
      
      lastActualY = actualY;
      currentY = actualY + viewportHeight;
      if (chunks.length > 200) break; 
    }

    await chrome.tabs.sendMessage(tabId, { action: 'restoreFixed' });
    await chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: 'Stitching image...' });

    // 3. Create offscreen document for stitching
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD', 'BLOBS'],
        justification: 'Stitch multiples viewport images into one canvas and copy to clipboard.'
      });
      // Give it a moment to load and register its listener
      await new Promise(r => setTimeout(r, 500));
    }

    // 5. Listen for completion from offscreen (STAKE BEFORE SENDING)
    const onMessage = async (message) => {
      if (message.action === 'stitchingComplete') {
        chrome.runtime.onMessage.removeListener(onMessage);
        
        const dataUrl = message.dataUrl;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot-${timestamp}.png`;

        await chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: 'Saving...' });

        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: false
        });

        await chrome.scripting.executeScript({
          target: { tabId },
          func: (dataUrl) => {
            fetch(dataUrl)
              .then(res => res.blob())
              .then(blob => {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]);
              });
          },
          args: [dataUrl]
        });

        await chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: 'Done! Copied to clipboard.' });
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: 'hideProgress' });
          chrome.offscreen.closeDocument().catch(() => {});
          isCapturing = false; 
        }, 1500);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    // 4. Send chunks to offscreen for stitching
    chrome.runtime.sendMessage({
      action: 'stitchImages',
      chunks,
      totalWidth: width,
      totalHeight: height,
      devicePixelRatio
    }).catch(err => {
      console.error('Failed to send message to offscreen:', err);
      // Fallback: if message fails, document might not be ready
    });

  } catch (error) {
    isCapturing = false; // Release lock on error
    console.error('Capture failed:', error);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'showProgress', text: 'Error occurred!' });
      setTimeout(() => chrome.tabs.sendMessage(tabId, { action: 'hideProgress' }), 2000);
    } catch (e) {}
  }
}
