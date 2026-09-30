# Internal AI desktop app

An Electron app around the Internal AI workspace (https://internal-ai.vercel.app).

- **⌥ Space from any app** brings Internal AI forward and opens the quick assistant.
- **Menu bar icon** with Open, Quick ask and Quit. Closing the window keeps the app running.
- **Dock badge and notifications** for unread team messages, even while the window is hidden.
- **Files on this computer** (Knowledge page): add files, or connect folders that stay in sync (new, changed and deleted files, every 10 minutes and when the window is focused). Their text joins your private knowledge. Paths only come from the native picker.
- **Update notices** when a newer version is published.
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

## Publish a release for the team

1. Bump `version` in `package.json`, then build: `npm run dist:mac` and `npm run dist:win`.
2. From the project root: `BLOB_READ_WRITE_TOKEN=... node scripts/publish-desktop.mjs`.

This uploads the installers to the private Blob store and updates `internal-ai/desktop/latest.json`. Signed-in people download them from **Get the app** in the website's top bar (short-lived signed links), and installed apps show an update notice.
