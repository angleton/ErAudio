# Cloudflare listening history sync

Browser storage is local to each browser and origin. ErAudio uses a Cloudflare
Worker and D1 database to share listening history across browsers and devices
when you sign in with the same Google account. GitHub Pages hosts the static
app; Cloudflare provides the authenticated API and persistent database it
cannot provide on its own.

The Worker verifies Google ID tokens and keeps accounts separate. It stores
video IDs, titles, timeline labels, played ranges, timestamps, playback
session identifiers, and counts in D1. History is not publicly browsable.
History sync does not require YouTube permission. In the separate-sign-in
flow, an automatic YouTube connection attempt follows successful Google
sign-in without blocking TOP.
See the [privacy policy](../privacy.html) for more information.

Only listening history is synced. Settings, saved locations, and the Local
Videos list stay in browser storage, which is separate for each browser
profile and site origin. Use history and location exports for backups.

## Use the existing sync service

1. Open ErAudio over HTTPS, or run it locally at `http://localhost:8000`
   using the [local server instructions](../README.md#option-2-use-a-local-http-server).
2. In the main window, select **AUTHORIZE GOOGLE AND YOUTUBE**.
   Google identity connects **TOP**; YouTube permission remains optional.
   If prompted, choose whether
   to copy that browser's existing local history into your account.
3. Sign in with the same Google account in another browser or browser profile.
   Listen in one browser and check **TOP** in the other after it syncs.

Sync runs about once a minute while the page is in use, and when you open
**TOP** or return online. If the service is unavailable while signed in,
new listens are saved locally and retried. After a reload or sign-in
expiration, ErAudio attempts Google reconnection if you previously signed in.
If Google requires interaction, use the main sign-in button. While signed out, history remains
separate in that browser. Confirmed deletion under **MANAGE HISTORY** while signed in deletes account history
from the service; other browsers receive the deletion on their next sync.
Select **?** under **TOP** for sync status and help.

In the separate-sign-in flow, after Google history sign-in succeeds, ErAudio automatically attempts
read-only YouTube playlist access without consent screens, using the verified
account email as a login hint. This attempt does not require a saved YouTube
connection preference. **CONNECT YOUTUBE** remains available for first-time
consent or when browser or Google restrictions prevent automatic connection.
History sync does not depend on YouTube permission or a successful connection.
Identity and YouTube access tokens stay separate and in page memory. In this
separate-sign-in flow, the YouTube token is never sent to the Worker.
The combined flow below exchanges the authorization code at the
Worker instead. Signing out from the main
window clears both ErAudio sessions and disables automatic Google
reconnection until you sign in again; it does not sign out of Google elsewhere.

### Shared computers

On the shared computer, open **TOP**, select **?**, and choose **USE SHARED
COMPUTER**. On a trusted phone, open your ErAudio deployment directly from a
bookmark or by typing its address; don't follow a link from the shared computer.
Sign in with Google in the main window, open **TOP** and **?**, select **APPROVE SHARED COMPUTER**,
and enter the displayed code within five minutes.
The phone sends approval to the Worker; the shared computer never receives the
Google identity token. Its separate session can read and add history for up to
eight hours, but cannot clear account history or approve other sessions. Only
approve a computer you recognize. **REVOKE SHARED SESSIONS** on a trusted
Google-signed-in device revokes all paired sessions for that account.

Starting pairing cancels automatic Google reconnection. A paired session
cannot connect a YouTube account.

The session token stays in page memory; reloading or closing the page requires
approval again. Use **SIGN OUT** in the main window to end a paired session;
ErAudio attempts to sync and revoke the session.
If revocation fails, revoke sessions from the trusted device. A local account
history copy and any unsynced listens remain on the shared computer, including
after expiry or revocation; reconnect to the same account to retry. Closing a
private browsing session generally removes its local data, including unsynced
listens. A compromised shared computer can still steal an active ErAudio
session and read or alter history, so never enter your Google credentials there.

### Shared-computer pairing schema

The pairing-schema migration is complete for the existing deployment. No further
database action is needed for it. The migration creates session tables and
indexes without replacing the existing history schema.

For a separate deployment whose D1 database does not yet have the pairing
schema, apply [pairing-schema.sql](pairing-schema.sql) before deploying the
Worker and publishing the updated app. From the `cloudflare` directory, using
the correct database name:

```powershell
npx wrangler d1 execute eraudio-history --remote --file pairing-schema.sql
```

Do not rerun this migration against the existing deployment or rerun
`history-schema.sql` against an existing database. Automatic Worker deployment
does not apply migrations.

## Testing combined Google and YouTube authorization

The app's configuration enables combined authorization. Its Worker must support
the combined endpoint and have the matching OAuth client secret configured.
Do not deploy or alter the production Worker without approval. An isolated test
uses a separate Worker, database and Google OAuth client. The Google web client
must allow the test app's exact origin and the `youtube.readonly` scope, and
test accounts must be permitted by its consent screen.

### Local test on a development computer

See the [local testing guide](./local-testing/README.md) for a step-by-step
isolated test without deploying the site or touching production history.

### Separate hosted test

1. Configure and deploy a separate Worker and D1 database using the steps
   below. Set its `APP_ORIGINS` and `GOOGLE_CLIENT_ID` to the test values.
2. Store the matching OAuth client secret as the Worker secret
   `GOOGLE_CLIENT_SECRET` using `wrangler secret put` with your separate
   Worker's configuration. Never put it in the repository or app settings.
3. In the **test copy** of `ErAudio.json`, set `historySync.endpoint` and
   `historySync.googleClientId` to the test values and add
   `"combinedGoogleSignIn": true` inside `historySync`. Do not commit test
   endpoints or secrets to the production configuration.
4. Serve the test copy from the authorized origin. Select **AUTHORIZE GOOGLE
   AND YOUTUBE**, complete Google's consent, and verify TOP sync, playlists,
   sign-out, partial and denied consent, TOP-only fallback, and reconnection
   after a reload.

The Worker exchanges the one-time authorization code with Google and returns
the identity token and, only when YouTube permission is granted, the YouTube
access token to the browser. It validates the identity token and checks the
YouTube scope, and does not retain the access or refresh token. A partial
grant returns `accessToken: null`, allowing TOP to connect without YouTube.
Popup failures, denied identity consent, or Worker errors offer an explicit
**Sign in with Google** fallback for TOP only. Connecting YouTube afterward
starts from a separate click, never from the identity callback.

Tokens stay in page memory. Reconnection preferences ask Google to reconnect
TOP after reload or expiry; YouTube reconnection is attempted only after
previous YouTube consent and verified Google history sign-in. A failed
YouTube reconnection leaves TOP connected and offers **CONNECT YOUTUBE** in
the same account-control location. Google may still require a manual click.

The test Worker needs the new code and its client secret before the flag is
enabled. Its CORS preflight must allow `X-Requested-With`. No database
migration is needed for an existing test database. A
Google account and a real isolated deployment are required to validate the
actual popup and consent flow; automated tests use mocks.

## Configure your own deployment

The repository is already configured for its existing Worker and database.
These steps are for setting up or replacing a deployment, not for normal use.
Do not create a new database or apply the initial schema to an existing one
unless you intend to set up a separate deployment.

1. In Google Cloud, create a **Web application** OAuth client for Google
   Identity Services. Add each app origin to **Authorized JavaScript origins**,
   including `http://localhost:8000` for local testing. Origins must match
   exactly, including scheme and port, with no path or trailing slash. If the
   consent screen is in testing mode, add your test accounts.
2. In a terminal, change to the `cloudflare` directory and sign in:

   ```powershell
   npx wrangler login
   ```

3. For a new database, run the following and update the existing
   `[[d1_databases]]` block in [wrangler.toml](wrangler.toml) with the returned
   database name and ID. Keep its binding as `HISTORY_DB`; do not add a second
   binding line.

   ```powershell
   npx wrangler d1 create eraudio-history
   ```

4. In [wrangler.toml](wrangler.toml), set `APP_ORIGINS` to the comma-separated
   exact origins allowed to call the Worker and set `GOOGLE_CLIENT_ID` to your
   Google web client ID. Include `http://localhost:8000` if you want to sync
   while running locally.
5. Apply the initial history schema and pairing schema to the **new** database,
   then deploy the Worker. Run these commands separately from the `cloudflare`
   directory, waiting for each to finish successfully. Replace `eraudio-history`
   with the database name if you used a different one.

   ```powershell
   npx wrangler d1 execute eraudio-history --remote --file history-schema.sql
   ```

   ```powershell
   npx wrangler d1 execute eraudio-history --remote --file pairing-schema.sql
   ```

   ```powershell
   npx wrangler deploy
   ```

6. In [ErAudio.json](../ErAudio.json), set `historySync.endpoint` to your
   deployed Worker origin. From the repository root, copy the public Google
   client ID from `wrangler.toml` to the app configuration:

   ```powershell
   .\Sync-GoogleClientId.ps1
   ```

   Publish the updated static app files. When the client ID changes, rerun
   this script, redeploy the Worker, and publish the app again. The script
   itself does not deploy anything. Leave both `historySync` settings blank
   for local-only history.
7. Test with two browser profiles using the same account. Play at least five
   seconds in the first, then check **TOP** and the heat map in the second.
   Test a different account to verify isolation. To test deletion propagation,
   use disposable test history only, never production listening history.

The client ID is public, but Cloudflare API tokens are secrets: never commit
them. The browser must use the authenticated Worker rather than access D1
directly. See the [main README](../README.md#automate-worker-deployments-with-github-actions)
for automated Worker deployment and local sync tests. The GitHub Actions
deployment does not create the database or apply the schema.
