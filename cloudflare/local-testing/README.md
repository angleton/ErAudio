# Local testing for combined Google and YouTube sign-in

This test uses an isolated local Worker, database, and Google OAuth client. It
does not deploy the site or touch production history. Localhost is a separate
browser origin, so it does not automatically include your live site's local
history or API SETUP settings. The production Worker must not be used for
this isolated test.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   separate test project, enable **YouTube Data API v3**, configure the OAuth
   consent screen and add your Google account as a test user. Create a **Web
   application** OAuth client and add exactly `http://localhost:8000` as an
   authorized JavaScript origin. Save the client ID and client secret
   privately; do not paste the secret into chat, API SETUP, or a committed file.
   The test client is separate from the production client, even if API SETUP
   already contains a client ID.
2. With the `fix/google-youtube-sign-in` branch checked out, create
   `C:\ErAudio\cloudflare\wrangler.local.toml` (ignored by Git). Replace the
   placeholder with the test client's **ID**, not its secret:

   ```toml
   name = "eraudio-history-local-test"
   main = "history-worker.mjs"
   compatibility_date = "2026-11-19"

   [vars]
   APP_ORIGINS = "http://localhost:8000"
   GOOGLE_CLIENT_ID = "YOUR_TEST_CLIENT_ID.apps.googleusercontent.com"

   [[d1_databases]]
   binding = "HISTORY_DB"
   database_name = "eraudio-history-local-test"
   database_id = "00000000-0000-0000-0000-000000000000"
   ```

3. Create `C:\ErAudio\cloudflare\.dev.vars` (also ignored by Git) with one
   line: `GOOGLE_CLIENT_SECRET=your-test-client-secret`. Replace the
   placeholder with the actual test secret, without quotes. Never commit or
   share this file.
4. Open a PowerShell terminal. Initialize the disposable local database
   **once**, then start the Worker. Leave this terminal running. Do not use
   `--remote` or `wrangler deploy` for this test. The first `npx` command may
   ask permission to download Wrangler.

   ```powershell
   cd C:\ErAudio\cloudflare
   npx wrangler@4 d1 execute eraudio-history-local-test --local --config wrangler.local.toml --file history-schema.sql
   npx wrangler@4 d1 execute eraudio-history-local-test --local --config wrangler.local.toml --file pairing-schema.sql
   npx wrangler@4 dev --local --config wrangler.local.toml --port 8787
   ```

5. In a second PowerShell terminal, build the test copy:

   ```powershell
   cd C:\ErAudio
   npm run site:build
   ```

   This cleans and rebuilds `dist/`. Open the ignored
   `C:\ErAudio\dist\eraudio\ErAudio.json` and replace its `historySync` object
   with the following, using the same test client ID as in step 2:

   ```json
   "historySync": {
     "endpoint": "http://localhost:8787",
     "googleClientId": "YOUR_TEST_CLIENT_ID.apps.googleusercontent.com",
     "combinedGoogleSignIn": true
   }
   ```

   Keep the surrounding JSON object and its other settings intact. Do not
   edit the root `ErAudio.json` or put the client secret in this file. A later
   site build overwrites this test copy, so repeat this configuration after
   rebuilding.
6. In the second terminal, start the website and leave it running:

   ```powershell
   py -m http.server 8000 --directory dist
   ```

   Open <http://localhost:8000/eraudio/>. Before signing in, confirm there is
   one **AUTHORIZE GOOGLE AND YOUTUBE** control rather than separate Google
   and YouTube login controls. Google can still ask you to select an account
   and approve permissions. Review the displayed app identity and permissions
   before consenting. Check TOP sync and playlists, then sign out and reload.
   Test denied YouTube consent and the TOP-only fallback too; an additional
   click may be needed after a failure or declined permission.

   When finished, press **Ctrl+C** in each terminal. Test data remains in
   `cloudflare/.wrangler/` and localhost browser storage, separate from
   production. The client secret remains in the ignored `.dev.vars` file.
