# ErAudio YouTube Web Player (with Pitchfork High-Granularity Control)

**ErAudio’s TOP panel ranks both whole videos and specific segments by time actually played in ErAudio.** See which videos you listen to most and which parts you keep coming back to.

**ErAudio:** /ɛr ˈɔdi.oʊ/ (“air-AW-dee-oh”)

A retro YouTube audio web player interface inspired by the classic **Winamp 2.x skin**, branded as **ErAudio**, and paired with a **Pitchfork**-style playback speed control.

---

## ▶️ Quick Start (no install needed)

1. **Open the player:** <https://ericangleton.com/eraudio/>
2. **Start listening:** Click **Open** and enter a YouTube link or video ID; no account needed. On later visits, the last video that played is selected and cued without playing automatically. Press **Play** to start it from the beginning. Previously added videos are still available in **VID**. The selection is stored in this browser; clearing site data removes it. Videos played from YouTube playlists or history are restored individually, not with their original playlist queue.
3. **Optional YouTube features:** use **API SETUP** to enter your own YouTube Data API key for public video chapters, or your Google OAuth client ID for **YOUTUBE LOGIN** and account playlists. This YouTube login is separate from the Google sign-in under **TOP**, which syncs listening history across browsers. See [YouTube API setup](#youtube-api-setup) and [listening history sync](#private-listening-history-sync).
4. **Show more windows:** **VID** opens the Videos window, **PL** opens detected chapters and timestamps, **DJ** opens the speed control, and **TOP** opens your listening history above the main player, ranked by total listening time. Use the **−** button in an optional pane’s top-right corner to hide it, and its main-player button to reopen it.
5. **See live audio levels:** Follow [Enable live audio levels](#enable-live-audio-levels) to share audio from the ErAudio tab.

> If Google warns that an app is unverified, review the app identity and requested permissions before proceeding. Don't continue if you don't recognize or trust the app. YouTube login requests read-only access to your YouTube account; history sync uses a separate Google sign-in.

### Prefer to download it?

1. On this page, click the green **Code** button, then **Download ZIP**, and unzip it.
2. Open a terminal in the unzipped folder and run `py -m http.server 8000` (Windows; needs [Python](https://www.python.org/downloads/)).
3. Visit <http://localhost:8000> in your browser.

Pasting links works this way. For YouTube API features, configure your own credentials and authorize `http://localhost:8000` as described below.

## Privacy and website hosting

Read the [ErAudio Privacy Policy](https://ericangleton.com/privacy.html). The source is [`privacy.html`](./privacy.html), and the player links to it from its footer.

Squarespace holds the `ericangleton.com` registration and DNS; GitHub Pages hosts the site. The homepage currently redirects to ErAudio at `/eraudio/`, and the blog is at `/blog/`. Squarespace's apex A records point to GitHub Pages. Preserve email-related DNS records if making future web-hosting changes.

### Build and preview the unified site

The Eleventy build creates the homepage redirect, blog index, and article pages in `dist/`, then copies the existing ErAudio app into `dist/eraudio/`. The original app files remain at the repository root, and the visualizer remains in its own `visualizer/` directory.

```powershell
npm ci
npm run site:build
py -m http.server 8000 --directory dist
```

Open <http://localhost:8000> to preview the site. Check the homepage, `/blog/`, `/privacy.html`, and `/eraudio/`. The privacy policy is also copied under `/eraudio/` so the app's relative policy link continues to work.

Write posts as Markdown files in [`site/posts/`](./site/posts/), with front matter such as:

```yaml
---
title: A post title
date: 2026-06-02
description: A short summary for the blog index.
---
```

GitHub Pages is static hosting, so it does not provide built-in comments or sign-in. No comments are enabled yet; a service such as Giscus could add comments later, with GitHub Discussions and a GitHub account required for readers.

The **Build and publish website** workflow builds on pushes and pull requests to `main`. When the repository Actions variable `PUBLISH_SITE` is `true`, pushes to `main` and manual workflow runs publish the site. This deploys to the repository's single live GitHub Pages site; it is not a separate staging environment. Set the variable to `false` or remove it to pause publishing.

The **Live site smoke test** workflow checks the public site from GitHub's servers after each successful deployment and daily. It verifies the pages and app files load, HTTP redirects to HTTPS, `www` redirects to the apex, the TLS certificate is valid for at least 14 days, and the history Worker allows the site's origin. Run it manually from the Actions tab, or locally with `node scripts/smoke-test-live.mjs [origin]`.

---

## 🎯 Target UI & Design References

This project aims to preserve the compact retro-audio-player aesthetic that inspired it while establishing ErAudio as its own product identity.

### Current UI
The main player combines YouTube playback and transport controls with a position bar, saved-location markers, and import/export controls. **LOCATIONS** opens a timestamp list where a selected location can be recalled or removed; **M+** saves the current position.

The time and scrolling title overlay the full-width [live audio spectrum](#enable-live-audio-levels) above the position bar.

The main title bar displays **ErAudio**, the YouTube login or account name, and **API SETUP**. The optional Pitchfork window, opened with **DJ**, contains playback-speed adjustments, two independent BPM counters, BPM matching, speed ramps, and beat-based nudging. **VID** opens the video list, while **PL** opens detected chapters and timestamps. The interface remains audio-first; YouTube playback uses an embedded player rather than a visible video screen.

![ErAudio player showing saved locations, Pitchfork controls, videos, and chapters](screenshot-ui.png)
<br>
*Earlier interface with example videos, chapters, BPM, and saved locations; playback is simulated for this screenshot.*

### Enable live audio levels

1. Open ErAudio over HTTPS or localhost (`file://` does not work for the meter). Click **Share Tab Audio for Visualizer** beside the meter, or start playback with ErAudio's **Play** button to open the picker automatically on your first Play.
2. In desktop Chrome, Edge, or Brave, choose **This Tab** or the browser's tab category in the picker. Select the ErAudio tab you're using, turn on **Share tab audio** (sometimes **Also share tab audio**), and click **Share**. The audio option is in the picker, not in ErAudio or the browser tab menu. Do not select **Window** or **Entire Screen**.
3. While sharing is active, a high-resolution continuous spectrum shows real-time levels from bass on the left to treble on the right. The fill rises and changes color from green through yellow to red as each frequency band gets louder. White peak markers briefly hold the peaks, then fall more slowly than the fill; they change gradually from dots to rectangular lights as the band count is reduced. Right-click the visualizer pane to open or close its frequency-band settings, or focus the spectrum and press Shift+F10 to open them. Choose from 8 to 512 frequency bands; the setting is saved in browser storage. The instructions and **Share Tab Audio for Visualizer** button return when sharing stops. If the picker closes before you can share, or if you cancel or share without audio, click **Share Tab Audio for Visualizer** again. You don't need to reload or pause playback. If the browser is unsupported, try the [hosted player](https://ericangleton.com/eraudio/) in desktop Chrome, Edge, or Brave.

The browser grants access to the selected tab's audio and video, not a levels-only permission. ErAudio verifies the selection is this tab, stops the video track, and measures frequency levels locally without recording or uploading audio. Canceling leaves playback working without the spectrum. Use the browser's sharing controls to stop.

While playback is paused, the colored spectrum holds its last frame, but the white peak markers keep falling until they disappear. Resuming playback restores live updates for both.

The **BPM** readout to the right of **LOCATIONS**, above **DJ**, estimates the tempo of the shared audio at the current playback speed. If audio isn't shared, use **Share Tab Audio for Visualizer**; no Google sign-in is needed. The readout shows a gray `-- BPM` until it detects a tempo, then turns yellow during playback. Automatic detection needs at least six seconds of steady playback in the visible tab and resets on pause, seek, or speed change. Brief delays between animation frames do not restart detection; longer gaps do. While the audio remains active, the last confident estimate stays visible for up to three seconds through dips in confidence. A moving spectrum confirms that audio is shared, but it doesn't guarantee a tempo estimate. The detector checks for quieter beats between strong accents to avoid reporting half tempo, though some rhythms can still register at half or double tempo. The estimate does not change the manual Pitchfork BPM counters or playback speed.

If the estimate is off, tap either **DJ** BPM button in time with the music. After two taps, the main readout follows the latest tapped tempo for up to 3 seconds after the last tap, even without audio sharing. With shared audio playing, four steady taps in the supported range (55-200 BPM) also give the detector a 15-second hint. It can favor an audio-supported beat near your tap tempo, but it won't report a beat the audio doesn't support.

### Visualizer preview and customization

Open [`visualizer/preview.html`](./visualizer/preview.html) directly in a browser to try simulated levels without audio, YouTube, sign-in, or tab sharing. The preview and player share the same renderer. See the [visualizer guide](./visualizer/README.md) for customization and tests.

---

## 🚀 Project Overview & Architecture

### Current Stage: Version 5.0
* **Standalone UI (`index.html`, `styles.css`, `app.js`):** Pixel-styled HTML5 layout for the ErAudio player, audio playlist, and Pitchfork plugin deck.
  The interface fills the browser window; the spectrum and open lists expand when more height is available. Drag the main player's bottom edge to change its height, or focus the resize handle and press **Up** or **Down**. The chosen height is saved in this browser and capped at the visible browser height. In smaller windows, scroll to reach the remaining controls. Browser zoom remains available to adjust the overall size.
* **Audio-First Design:** Focuses on pure audio playlist playback with no embedded video player screen.
* **Granular Controls:** The horizontal speed slider spans the bottom of Pitchfork, from -50% (`0.5x`) to +50% (`1.5x`), with normal speed (0%) at its midpoint. Values are rounded to `0.0001x`, and the arrow keys adjust by that amount; YouTube playback uses the rates supported by the video.
* **Semantic Controls:** Transport buttons, toggle buttons, playlist items, checkboxes, and range sliders are real HTML controls with keyboard focus and accessible names.
* **Copy list items:** Right-click an item in **VID** or the Video Chapters or Timestamps window, then choose **COPY TEXT** or **COPY LINK**. Alternatively, focus an item, press Shift+F10, use the arrow keys to choose, and press Enter; Escape closes the menu. Text includes the displayed number and timestamp or duration. Video links open the video on YouTube; chapter, timestamp, and saved-location links also start at that position, rounded down to whole seconds. A brief notification confirms a successful copy. Clipboard access requires browser permission and a supported secure context, such as HTTPS or localhost.
* **Play control:** Press **Play** to start or resume playback. While playing, a green triangle appears inside the time display without shifting the digits, and the button changes to **Pause** with a slowly pulsing yellow border; press it to pause. The border remains static when reduced motion is requested. While paused, the button looks the same as when stopped.
* **Time display:** Click the timer to switch between elapsed and remaining video time. Remaining time has a minus sign; `--:--` means the duration is not available. You can also focus the timer and press **Enter** or **Space**.
* **Scrolling title:** Click anywhere in the title area to show the beginning. Hold the left mouse button and drag left to see the end, or drag right to move the beginning across the title area instead of stopping at the left edge. Scrolling resumes from where you release it. Right-button dragging starts at the beginning and pauses briefly after release. The title does not affect playback. Right-click the spectrum below it for visualizer settings.
* **Visualizer playback:** Left-click the visualizer outside the title area to play or pause, or focus its playback control and press **Enter** or **Space**. The timer and audio-sharing button keep their own actions.
* **Visualizer fullscreen:** Once tab audio is shared, click the fullscreen button at the upper right of the frequency display. The timer and scrolling title stay at the top. Click **×** or press any key, including **Esc**, to return without interrupting playback. Fullscreen also closes if audio sharing stops.
* **Keyboard shortcut:** Press **Space** to play or pause when the page is focused. Space keeps its normal behavior in focused controls and editable fields; the shortcut is inactive while a dialog or copy menu is open.
* **Listening history:** ErAudio records which parts of each video you actually play, locally in this browser's IndexedDB (no account or network needed). Each record is a span of video seconds, written when playback pauses, seeks, ends, or the video changes. Time spent paused or buffering is not counted, a seek through a part of the video is not a listen (spans under 5 seconds are ignored), and resuming where you left off continues the same span. Because spans are positions in the video, playback speed does not affect them, and chapters or timestamps are only labels applied when the history is read, so they also work for videos that have none or whose markers change. A playback session counts as one play when it records a span of at least 5 seconds. The position bar has a heat strip below it, and each chapter or timestamp in the Chapters window shows a badge such as `x1.5`, the average number of times that section was heard; hotter colors mean more listening. In **TOP**, select **SEGMENTS** or **VIDEOS** to rank passages or whole videos by total listening time, highest first. Time is measured in video time; listen count for segments and play count for whole videos break ties. **EXPORT** and **IMPORT** back up or merge history as a JSON file, and **CLEAR** erases it. The browser may delete site data, so export it if you want to keep it. Tracking is approximate and unavailable if the browser blocks IndexedDB.
  History is associated with the YouTube video ID, so listening to the same video in Local Videos and YouTube playlists contributes to the same TOP entry and heat map. Segment listens count qualifying spans; whole-video plays count playback sessions, so these numbers can differ.
  **TIME PERIOD** filters TOP to all time (the default), today, this week, this month, or this year. Periods follow the browser's local calendar and time zone; the week begins Sunday. Time crossing a period boundary is estimated, and older spans without an end timestamp are assigned to the period when they began. Period-specific video plays count qualifying sessions started during that period. Older history lacks session identifiers, so `≥` marks counts that may be incomplete; all-time counts remain unchanged. The filter does not change the stored history, heat map, or export.

  Drag the bottom edge of **TOP** up for a compact view with room for about one or two entries, or down to show more. Even a full history list can shrink; scroll to see the rest. You can also focus the resize handle and use **Up** and **Down**. Your chosen height is saved in this browser.
* **Open Input:** The Open control accepts an 11-character video ID or a YouTube watch, short, embed, Shorts, or live URL. It validates the ID format, adds the video, and starts playback through the YouTube player; a valid ID does not guarantee that the video exists or is playable. It also emits an `eraudio:control` event with the video ID.
* **Chapters and timestamps:** The Video Chapters or Timestamps window detects timestamp lines in the current video's description. Entries show the time and name, wrapping long names across lines. It infers chapters from the first contiguous group that starts at 0:00, has at least three ascending entries at least 10 seconds apart, and has a final chapter at least 10 seconds long. Entries at or beyond the video's duration are excluded from the inference but remain visible, disabled, in the timestamps view. If the two lists differ, use the button in the window footer to switch between them; identical lists are shown once. Use **SHOW MY LOCATIONS** to switch to a separate chronological list of locations saved with **M+**, or **SHOW VIDEO MARKERS** to return. Select a saved location to seek without changing play/pause state; manage or edit it through **LOCATIONS**. These saved locations are stored per video in browser storage and do not require a YouTube API key. A missing duration prevents chapter inference. Inferred chapters are estimates, not YouTube's actual chapter data, and automatically generated chapters not present in the description are not detected. For public videos description detection works without signing in when a YouTube Data API key is configured; otherwise a configured YouTube login can provide access.
* **Jump from history:** Select a **TOP** entry to play from the start of its chapter or timestamp. Whole-video entries play from the beginning. Opening a video from history does not add it to **VID**.
  A gold edge marks the video that's playing in **VID** and **TOP**'s Videos view, and the current part in **PL** and **TOP**'s Segments view when it has a row there.
* **Remove a video:** In **Local Videos**, right-click a **VID** entry and choose **REMOVE FROM VIDEOS** to remove just that entry, regardless of which videos are selected. This doesn't erase its listening history or saved locations. YouTube playlists are read-only.
* **Sort a YouTube playlist:** In **VID**, select a YouTube playlist to see columns for view counts, your ErAudio play counts, and your total listening time. Use **?** beside the playlist selector to show or hide playlist guidance; loading messages and problems remain visible. Select a column heading to sort, and select it again to reverse the order; **VIDEO** restores playlist order. View counts are loaded using additional YouTube API requests only when you select **VIEWS**; `--` means they have not loaded or are unavailable, and unavailable values sort last. Personal metrics use all-time history for each video (including synced history when signed in), not just listens from that playlist. Listening time is measured in video time, as in **TOP**. Ties keep playlist order. Sorting changes only the display: Next and Previous follow the original playlist order, and nothing changes on YouTube. The sort resets when switching playlists.
* **Event Hooks:** Controls dispatch an `eraudio:control` `CustomEvent` on `document`. The interface can be opened directly as a local file; if browser storage is unavailable, other preferences fall back to in-memory values for that page session.
* **BPM buttons:** The two independent counters have stable IDs `bpm-left` and `bpm-right`; their control events use those IDs as their names even when the displayed BPM changes. Check **AUTO** beside a counter to follow the live detected BPM. Switching AUTO on or off preserves the current reading; when AUTO is on, the next change to the detected BPM updates it. Unchecking AUTO holds the reading in **MANUAL**, or tap the button to measure a tempo and switch to manual automatically. Right-click a BPM button (or focus it and press Shift+F10) to select AUTO or MANUAL for that counter. Right-click either AUTO checkbox (or focus it and press Shift+F10) for options to enable or disable AUTO on both counters. **AC** resets both counters to AUTO and resets playback speed.
* **BPM matching:** After measuring both BPM values, **M2=M** sets the speed to right BPM divided by left BPM; **M-M2** uses left BPM divided by right BPM. Values outside the slider's range are limited to its nearest endpoint. The YouTube player may not support the requested rate.
* **Speed steps:** Each **+**, **-**, **++**, or **--** button displays its step in percentage points. Right-click it (or press Shift+F10 while focused) to edit the nonnegative value. Press Enter or move focus away to save, or Escape to cancel. Positive and negative buttons share the same step within each size and side; the left side is permanent and the right side is temporary. Initial defaults come from `ErAudio.json` when served over HTTP, and edits persist in browser storage, overriding the corresponding file values without modifying the file. Browser storage must be available to save edits.
* **Speed reset:** Hold **=** for 0% (normal speed); releasing it restores the prior speed. **=0=** permanently resets speed to 0%. Neither clears BPM values or saved locations.
* **Nudging:** **◄N** and **N►** move the playback position backward or forward by one-sixteenth of a beat in video time, using the left BPM if measured, or 130 BPM otherwise. The fallback does not set the BPM counter. If a saved location is selected, nudging updates that location instead, even if playback has moved elsewhere. The updated location is saved before the preview and remains changed if the preview fails. Save or cancel an open location edit before nudging a selected location. The player pauses, plays an approximately 100 ms preview, then returns to the requested position paused. YouTube may seek to an earlier keyframe when the target is not buffered, and buffering or browser scheduling can affect preview timing, so precise beat alignment is not guaranteed.
* **Saved playback locations:** Press **M+** while a video is playing or paused to save its current position; select a marker on the position bar to seek back. **LOCATIONS** opens a chronological list for the current video with millisecond timestamps; select an entry to seek without changing play/pause state. Double-click an entry or focus it and press **F2** to edit it as `MM:SS` or `MM:SS.sss`. Save a changed value within the loaded video's duration to update the marker and seek there; an unchanged value does not save or seek again. **Escape** or **CANCEL** discards the edit. An arrow marks the last location selected from the list or bar, until the video changes or the location is cleared. Use **REMOVE SELECTED** to delete that one location; even an unavailable location can be selected in the list for removal. Up to 50 locations per video are stored in browser storage across reloads. **AC** clears the saved locations for all videos as well as resetting speed and BPM. Browser storage must be available to save or clear locations.
* **Sharing locations:** Use **EXPORT LOCATIONS** to download a JSON text file containing saved locations for the current video. The filename includes its title with special characters removed (or its video ID if the title has no usable characters). **IMPORT LOCATIONS** merges a file into local storage, skipping exact duplicates; it also accepts older exports containing multiple videos. If any video would exceed 50 locations, the entire import is rejected without changing existing locations. Importing and exporting require browser storage; exports are not automatically synchronized, and AC does not delete exported files.
* **Automatic speed ramps:** The up/down triangle buttons change speed by 1 percentage point per second by default. Moving toward normal speed stops at 0%; otherwise the ramp stops at the slider limit or the current YouTube video's supported limit, whichever is closer. Click the same button to stop, the opposite button to reverse, or use another speed control to stop the ramp. YouTube audio changes only at supported discrete rates. Set `ramp.percentPerSecond` to a positive number in `ErAudio.json` to change the rate; the file is loaded over HTTP at launch.

### Private listening history sync

See the [Cloudflare sync guide](./cloudflare/README.md) for why ErAudio uses Cloudflare and how to use cross-browser history sync.

When sync is configured, the **TOP** controls start with **Sign in with Google** or **STOP SYNC & SIGN OUT**, followed by **?** and **VIEW**. Select **?** to show history help and sync status.

When configured, **TOP** offers a separate **Sign in with Google** button. It is hidden while you’re signed in to history sync and returns when you sign out or need to sign in again. Sign in with the same account in each browser to combine listening spans, play counts, and heat maps. The first sign-in for each account in a browser asks before copying existing local history. Declining keeps it local. ErAudio uploads video IDs, titles and timeline labels, played ranges, timestamps, playback-session identifiers, and counts to Cloudflare D1; there is no public view. YouTube login and permissions are unchanged.

Only listening history is synced. Settings, saved locations, and the Local Videos list remain in browser storage and do not automatically follow your account. Browser storage is also separate between origins, such as `localhost` and the hosted site. Export saved locations or history if you want a backup.

Sync checks about once a minute while the page is in use, and when you open **TOP** or return online. It does not interrupt playback. If the network or service is unavailable after sign-in, new listens are saved in that account's local browser storage and retried. After a reload or sign-in expiration, use the Google button to reconnect. While signed out, ErAudio shows and records only this browser's separate local history. Signing out hides the account history in the app; it does not erase its local database. Use separate browser profiles on a shared computer.

Period-specific play details require the updated history Worker. If the app connects to an older Worker, ordinary history continues to sync, while period details remain in the local account database and a sync warning is shown. Deploy the updated Worker to sync those details; no D1 schema migration is required.

While signed in, **EXPORT** includes the combined history, **IMPORT** adds to the active account history, and **CLEAR** deletes it from the service. Other browsers see the deletion on their next sync; pending changes from before the clear cannot restore it. Any separate signed-out history is unaffected. Existing JSON imports deduplicate identical spans, but old backups only have per-video play counts, so copying the same old backup from multiple browsers may overcount plays.

#### Enable sync on a deployment

The hosted app is already configured for history sync. To configure or replace a deployment, follow [Configure your own deployment](./cloudflare/README.md#configure-your-own-deployment), including its verification steps.

#### Automate Worker deployments with GitHub Actions

The [Cloudflare sync guide](./cloudflare/README.md) explains the Worker and database used by this workflow.

1. Create a [Cloudflare deployment API token](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) using the **Edit Cloudflare Workers** template, scoped to the account that owns ErAudio's Worker. Copy that account's ID (not the D1 database ID).
2. In GitHub, go to **Settings → Secrets and variables → Actions** and add two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Do not put the token in a config file or commit it.
3. In **Actions → Deploy Cloudflare History Worker**, choose **Run workflow** on `main` to deploy without changing a file. Subsequent pushes to `main` that change the Worker, its Wrangler config, or the workflow deploy automatically.

This workflow is separate from GitHub Pages. It deploys to the existing Worker and does not create the D1 database or apply its schema; follow the [database setup guide](./cloudflare/README.md#configure-your-own-deployment) separately for a new deployment.

To run the local API and sync tests without contacting Google or Cloudflare, use Node.js 24+ and run `node --test tests\history-sync.test.mjs` from the repository root.

To compare **TOP** in real Chromium and Firefox browsers, run `npm.cmd ci` and then `npx.cmd playwright install chromium firefox` from the repository root. Run the test with `npm.cmd run test:top`. It imports synthetic listens in each browser and compares the ranked segment and video rows after syncing through a local Worker and in-memory database. It does not use a real Google account, play YouTube videos, or touch deployed Cloudflare data.

### Planned Stack & Capabilities
* **Rust + WebAssembly (Wasm):** Rust application state management, playlist handling, keyboard shortcuts, and player logic.
* **YouTube playback:** Start with a YouTube video ID or URL entered through the ErAudio-style **Open** control. A later iteration may offer YouTube browsing/search, subject to the available YouTube APIs and their authentication, quota, and usage requirements.
* **Audio-first presentation:** The player can present YouTube playback as an audio-focused experience while retaining the underlying supported YouTube player. Extracting and redistributing raw YouTube audio is not assumed to be part of this project.
* **Playback controls:** The YouTube IFrame Player API can provide supported playback-rate controls, but it does not guarantee arbitrary floating-point rates. The embed does not expose raw audio for spectrum analysis; the spectrum instead uses audio shared from the browser tab. Independent pitch and tempo controls and stream bitrate/sample-rate readouts are not provided by the embed.
* **Optional browser extension interop:** A browser extension could report which tabs are marked audible through the WebExtensions `tabs` API in Chromium-based browsers and Firefox. This is useful for discovery and companion features, but it does not expose exact audio routing or the individual audio element responsible for sound.
* **Desktop window behavior:** HTML/CSS can make the player surface translucent, but a normal browser page cannot make its outer browser window transparent or define OS-level click-through regions. True transparent-window behavior requires a desktop wrapper or native host such as Electron, Tauri, WinUI, WPF, or WinForms.

### Product Direction
The goal is a compact, keyboard-friendly HTML5 ErAudio experience for YouTube listening:

1. Click **Open** and paste a YouTube URL or video ID.
2. Resolve the input into a playable YouTube item and add it to the playlist.
3. Play it through the classic ErAudio transport and playlist controls.
4. Keep the first iteration audio-focused, with video display and browsing treated as later additions.

The browser and extension APIs can help identify audible tabs, but they cannot universally identify the exact YouTube tab from Windows audio alone. If that capability becomes important, the application will need browser-specific extension integrations plus a native or desktop-wrapper component.

---

## 🖥️ Run Locally

This is a static HTML/CSS/JavaScript project. No build step, dependencies, database, or backend server are required.

### Option 1: Open the file directly

Open `index.html` in a modern browser, for example by double-clicking it in File Explorer. The URL will start with `file://`. The player interface and YouTube URL/ID parsing work locally; if the browser blocks local storage, saved preferences last only for the current page session.

### YouTube API setup

The app does not ship YouTube API credentials or read `config.js`; the separate history sync configuration includes a public Google client ID. Each user can enter YouTube API credentials through **API SETUP**; opening **PL** without either credential or choosing **YOUTUBE LOGIN** without a client ID also opens the setup dialog. Both fields are optional except that login requires a client ID. Saving settings through **API SETUP** does not sign you in; click **YOUTUBE LOGIN** to authorize your account. Use **API SETUP** again to change a value or clear a field and save to remove it. Changing or removing the client ID ends the current app session's YouTube sign-in.

Click outside **YOUTUBE API SETUP** or press **CANCEL** to close it without saving changes.

The values are stored unencrypted in the browser's local storage for this site and browser profile, not in project files or GitHub. They are accessible to scripts running on the same origin, browser extensions, and people with access to the profile. Clearing browser site data removes them. The API key is sent to Google for API requests and the client ID is sent to Google for sign-in; use website and API restrictions, and do not enter a client secret. Saving requires browser storage; if it is blocked, the app reports the failure and does not change the settings.

If you previously created a local `config.js`, it is no longer used. It remains on your computer and may still be served by a local web server until you remove it yourself.

#### Public video chapters

Public video descriptions can be retrieved without sign-in using your own YouTube Data API key:

1. In [Google Cloud Console](https://console.cloud.google.com), create or select a project and enable **YouTube Data API v3** under **APIs & Services → Library**.
2. Under **APIs & Services → Credentials**, create an API key. Restrict its API access to **YouTube Data API v3** and its website access to the sites you use, such as `https://ericangleton.com/*`, `https://audio.ericangleton.com/*`, and `http://localhost:8000/*`.
3. Open **API SETUP** in ErAudio, enter the key and save. Monitor your Google Cloud quota and usage.
4. Use the app over HTTP or HTTPS from an allowed website. Direct `file://` use may not supply a referrer accepted by a restricted key.

The YouTube Data API has a quota; a request can also fail because of key restrictions, network errors, or video availability. The Video Chapters or Timestamps window reports failures. Reopen the video or reload the page to retry.

#### YouTube account playlists

An OAuth client ID is needed only for **YOUTUBE LOGIN** and account playlists, not for public chapters when you use an API key. **Local Videos** is always the first option in the Videos window's **PLAYLISTS** dropdown, including while signed out. After sign-in, select one of the account's YouTube playlists to load its videos. These playlists are read-only: their videos do not replace or get saved to Local Videos, and add/remove controls are available only in the local list. The main **Open** control adds a video to Local Videos and switches the view there.

Switching the visible list does not interrupt playback; **Next** and **Previous** follow the playlist that started the current video. YouTube lists are fetched again when selected. The API does not include video durations in playlist items, so their durations initially show `--:--`; unavailable items without a video ID are omitted and reported, and videos that cannot be embedded may still fail to play. If loading fails, the previous list remains visible. Local Videos is stored in this browser's storage and may be lost if site data is cleared.

Sign-in can also retrieve video descriptions. If the browser already has a Google session that previously approved your OAuth client, sign-in is attempted automatically on page load.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or choose an existing one).
2. Under **APIs & Services → Library**, enable **YouTube Data API v3**.
3. Under **APIs & Services → OAuth consent screen** (**Google Auth Platform** in newer consoles):
   - Choose **External** as the user type, then enter the app name and a support email.
   - Add the scope `https://www.googleapis.com/auth/youtube.readonly`.
   - While the app is in **Testing** mode, only accounts listed under **Test users** (up to 100) can sign in. Add any accounts you want to use before verification.
4. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application**. Under **Authorized JavaScript origins**, add every origin the app is served from, exactly (scheme, host and port; no trailing slash or path):
   - `https://ericangleton.com` for the unified site
   - `https://audio.ericangleton.com` for the legacy app host
   - `http://localhost:8000` for local runs (Option 2 below)

   Google sign-in does not work from `file://`, and no redirect URI is needed. Origin changes can take a few minutes to apply.
5. In **API SETUP**, enter the client ID (ending in `.apps.googleusercontent.com`) and save. Do not enter the client secret. Click **YOUTUBE LOGIN** to authorize your account.
6. If other accounts need access to your OAuth client, add them as test users or complete Google's publishing and verification process. The `youtube.readonly` scope is sensitive; Google's verification requirements apply.

Troubleshooting:
- `origin_mismatch` / `redirect_uri_mismatch`: the page's origin is not in step 4 exactly as written.
- `access_denied`: the account is not a test user (step 3) and the app is not yet verified.
- If settings cannot be saved, check that browser storage is enabled for the site.

Without a client ID, pasting a YouTube link still works, but account playlists are unavailable. Chapter/timestamp detection still works for public videos if an API key is configured.

### Option 2: Use a local HTTP server

From PowerShell, change to the project folder and start Python's built-in static server:

```powershell
cd C:\path\to\eraudio
py -m http.server 8000
```

Then open <http://localhost:8000> in your browser. If the `py` command is unavailable but Node.js is installed, use:

```powershell
npx serve .
```

Open the local URL printed by `serve`. Press `Ctrl+C` in the terminal to stop either server.

---

## 📁 Repository Structure

```
eraudio/
├── index.html        # HTML5 layout of ErAudio & Pitchfork UI
├── styles.css        # Retro ErAudio classic skin stylesheet
├── app.js            # Player, controls, and saved locations
├── history.js        # Local listening history (IndexedDB spans and heat maps)
├── screenshot-ui.png # Screenshot of the player UI
└── README.md         # Project documentation & reference images
```
