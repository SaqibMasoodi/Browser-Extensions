/**
 * Offscreen script to handle canvas stitching and PNG generation.
 */

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'stitchImages') {
    const { chunks, totalWidth, totalHeight, devicePixelRatio } = message;
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = totalWidth * devicePixelRatio;
    canvas.height = totalHeight * devicePixelRatio;
    const ctx = canvas.getContext('2d');

    // Draw chunks onto canvas
    for (const chunk of chunks) {
      const img = await createImageBitmap(await (await fetch(chunk.dataUrl)).blob());
      ctx.drawImage(img, chunk.x * devicePixelRatio, chunk.y * devicePixelRatio);
    }

    // Convert to Blob
    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        chrome.runtime.sendMessage({
          action: 'stitchingComplete',
          dataUrl: reader.result
        });
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  }
});
