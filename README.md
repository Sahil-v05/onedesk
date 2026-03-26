# LocalShare — Local Network Clipboard & File Sharing

Share text and files instantly between any devices on the same WiFi/LAN network.
No internet, no accounts, no WhatsApp, no Teams. Just open a browser.

---

## Setup (One-time)

### Requirements
- Node.js installed (https://nodejs.org — download LTS version)

### How to run

1. Open a Terminal / Command Prompt
2. Navigate to this folder:
   ```
   cd path/to/localshare
   ```
3. Start the server:
   ```
   node server.js
   ```
4. You'll see output like:
   ```
   ╔══════════════════════════════════════╗
   ║       LocalShare is running!         ║
   ╠══════════════════════════════════════╣
   ║  Open on this machine:               ║
   ║  → http://localhost:3000             ║
   ║                                      ║
   ║  Open on other devices (same WiFi):  ║
   ║  → http://192.168.1.105:3000         ║
   ╚══════════════════════════════════════╝
   ```

5. **On your desktop:** Open `http://localhost:3000`
6. **On your laptop (same WiFi):** Open the IP address shown, e.g. `http://192.168.1.105:3000`

---

## Usage

- **Shared Clipboard**: Type or paste text → click "Push to all devices" (or Ctrl+Enter)
  - All devices will see the updated text within 3 seconds automatically
- **File Sharing**: Drag & drop files or click to browse → files appear on all devices
  - Any device can download or delete shared files

---

## Notes

- Run the server on the **desktop** (connected by Ethernet) for best stability
- The `uploads/` folder stores shared files — safe to delete files from there anytime
- Works with any device on the network: phones, tablets, etc.
- No data leaves your local network

## Stopping the server
Press `Ctrl+C` in the terminal window.
