# Internal AI desktop app

An Electron app around the Internal AI workspace (https://internal-ai.vercel.app).

- **⌥ Space from any app** brings Internal AI forward and opens the quick assistant.
- **Menu bar icon** with Open, Quick ask and Quit. Closing the window keeps the app running.
- **Dock badge and notifications** for unread team messages, even while the window is hidden.
- **Microphone (Echo) and screen capture** with native permission prompts, for the workspace only.
- External links open in your default browser. The window only ever shows the workspace.

## Run and build

```bash
npm install
node node_modules/electron/install.js   # if npm skipped Electron's download
npm start                                # opens the live workspace
INTERNAL_AI_URL=http://localhost:3100 npm start   # against local development
npm run dist:mac                         # .dmg and .zip for Apple silicon and Intel
npm run dist:win                         # Windows installer
```

Builds are unsigned unless signing credentials are configured. On macOS, the first launch of an unsigned app needs right-click → Open. For wider distribution, sign and notarise with an Apple Developer ID (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
