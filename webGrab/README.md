# webGrab

webGrab is a lightweight Chrome Extension designed for capturing high-quality, full-page screenshots of any website. It intelligently handles scrolling, manages overlapping elements, and provides instant options for saving or sharing.

## Features

- **Full-Page Capture**: Automatically scrolls and stitches the entire page into a single image.
- **Save as PNG**: Downloads the captured screenshot directly to your local machine.
- **Copy to Clipboard**: Seamlessly copies the screenshot for quick pasting into other applications.
- **Dynamic Element Handling**: Temporarily hides fixed and sticky elements to ensure a clean, seamless capture without visual artifacts.
- **Capture Progress UI**: Real-time visual feedback overlay during the capture process.

## Installation

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the project directory.

## Usage

- **Popup Menu**: Click the extension icon in the toolbar and select "Capture Full Site".
- **Keyboard Shortcut**: Press `Alt + Shift + S` to trigger a capture instantly on the active tab.

## Permissions

- `tabs`: For identifying the active tab to capture.
- `activeTab`: For accessing the current page content.
- `downloads`: For saving screenshots to the local filesystem.
- `clipboardWrite`: For copying images to the clipboard.
- `scripting`: For executing capture logic within the page context.
- `offscreen`: For handling clipboard operations in the background.

## License

This project is licensed under the MIT License.
