# ErAudio YouTube Web Player (with Pitchfork High-Granularity Control)

**No installation. No browser extension. No account required to start listening.**

Open [ErAudio](https://ericangleton.com/eraudio/) in your browser for Winamp-inspired YouTube playback, precise speed controls, and private listening statistics. Google sign-in is optional for history sync; live audio visualization and automatic BPM detection require permission to share the ErAudio tab's audio.

**ErAudio’s TOP panel ranks both whole videos and specific segments by time actually played in ErAudio.** See which videos you listen to most and which parts you keep coming back to.

**ErAudio:** /ɛr ˈɔdi.oʊ/ (“air-AW-dee-oh”)

A retro YouTube audio web player interface inspired by the classic **Winamp 2.x skin**, branded as **ErAudio**, and paired with a **Pitchfork**-style playback speed control.

---

## ▶️ Quick Start (no install needed)

1. **Open the player:** <https://ericangleton.com/eraudio/>
2. **Start listening:** Click **Open** and enter a YouTube link or video ID; no account needed. On later visits, the last video that played is selected and cued without playing automatically. Press **Play** to start it from the beginning. Previously added videos are still available in **YT**. The selection is stored in this browser; clearing site data removes it. Videos played from YouTube playlists or history are restored individually, not with their original playlist queue.
3. **Optional account features:** **AUTHORIZE GOOGLE AND YOUTUBE** in the main window requests Google identity for **TOP** sync and optional read-only YouTube playlist access together. History sync does not require YouTube permission. If combined authorization fails, a Google-only fallback remains available. The app supplies a public Google client ID; **API SETUP** accepts a YouTube Data API key for public video information. See [YouTube API setup](#youtube-api-setup) and [listening history sync](#private-listening-history-sync).
4. **Show more windows:** **YT** opens the Videos window, **VID** shows the current video, **PL** opens detected chapters and timestamps, **DJ** opens the speed control, and **TOP** opens your listening history above the main player, ranked by total listening time. Use the **−** button in an optional pane’s top-right corner to hide it, and its main-player button to reopen it. The border-only video pane has no title bar; use **VID** again to hide it without stopping audio.
5. **See live audio levels:** Follow [Enable live audio levels](#enable-live-audio-levels) to share audio from the ErAudio tab.

> If Google warns that an app is unverified, review the app identity and requested permissions before proceeding. Don't continue if you don't recognize or trust the app. Google identity connects history sync; read-only YouTube account access is optional.

### Prefer to download it?

1. On this page, click the green **Code** button, then **Download ZIP**, and unzip it.
2. Open a terminal in the unzipped folder and run `py -m http.server 8000` (Windows; needs [Python](https://www.python.org/downloads/)).
3. Visit <http://localhost:8000> in your browser.

Pasting links works this way. For YouTube API features, configure your own credentials and authorize `http://localhost:8000` as described below.

## Privacy and website hosting

Read the [ErAudio Privacy Policy](https://ericangleton.com/privacy.html). The source is [`privacy.html`](./privacy.html), and the player links to it from its footer.

Squarespace holds the `ericangleton.com` registration and DNS; GitHub Pages hosts the site. The homepage currently redirects to ErAudio at `/eraudio/`, and the blog is at `/blog/`. Squarespace's apex A records point to GitHub Pages. Preserve email-related DNS records if making future web-hosting changes.

The HTML pages include a limited Content Security Policy that blocks base URL changes and embedded objects. It does not restrict scripts or prevent framing. GitHub Pages does not support custom response headers; HSTS and framing protection require a hosting service or proxy that can set HTTP headers.

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

The main title bar displays **ErAudio**, Google sign-in or the connected account with **SIGN OUT**, optional **CONNECT YOUTUBE** or the YouTube channel name, and **API SETUP**. The optional Pitchfork window, opened with **DJ**, contains playback-speed adjustments, two independent BPM counters, BPM matching, speed ramps, and beat-based nudging. **YT** opens the video list, while **PL** opens detected chapters and timestamps.

The interface remains audio-first: **VID** optionally reveals the same embedded YouTube player in a video pane with a thin beveled border and no ErAudio toolbar or title bar. The video fills the pane; YouTube handles letterboxing for different video aspect ratios. The pane starts hidden, and showing or hiding it does not reload the player or restart playback. Single-left-click the video picture to pause or resume through YouTube's native player; ErAudio's playback indicators follow the player state. Clicks on native controls keep their normal function. YouTube's native auto-hiding overlay includes playback controls, Settings (including Quality when available), and CC for videos with captions. YouTube controls which options appear and their styling; ErAudio cannot show only Quality and CC or customize the overlay's transparency.

![ErAudio player showing saved locations, Pitchfork controls, videos, and chapters](screenshot-ui.png)
<br>
*Earlier interface with example videos, chapters, BPM, and saved locations; playback is simulated for this screenshot.*

### Enable live audio levels

1. Open ErAudio over HTTPS or localhost (`file://` does not work for the meter). Click **Share Tab Audio for Visualizer** beside the meter, or start playback with ErAudio's **Play** button to open the picker automatically on your first Play.
2. In desktop Chrome, Edge, or Brave, choose **This Tab** or the browser's tab category in the picker. Select the ErAudio tab you're using, turn on **Share tab audio** (sometimes **Also share tab audio**), and click **Share**. The audio option is in the picker, not in ErAudio or the browser tab menu. Do not select **Window** or **Entire Screen**.
3. While sharing is active, a high-resolution continuous spectrum shows real-time levels from bass on the left to treble on the right. The fill rises and changes color from green through yellow to red as each frequency band gets louder. White peak markers briefly hold the peaks, then fall more slowly than the fill; they change gradually from dots to rectangular lights as the band count is reduced. Right-click the visualizer pane to open or close its frequency-band settings, or focus the spectrum and press Shift+F10 to open them. Choose from 8 to 512 frequency bands; the setting is saved in browser storage. The instructions and **Share Tab Audio for Visualizer** button return when sharing stops. If the picker closes before you can share, or if you cancel or share without audio, click **Share Tab Audio for Visualizer** again. You don't need to reload or pause playback. If the browser is unsupported, try the [hosted player](https://ericangleton.com/eraudio/) in desktop Chrome, Edge, or Brave.

Adjusting the frequency-band slider or number field does not pause or resume playback. Clicking the visualizer outside its settings still toggles play/pause. While tab audio is shared, hold either **Shift** key and drag with the left mouse button over the spectrum to draw a line without toggling playback. The line becomes a spectrum using the same live audio, with levels extending perpendicular to your drawing direction (a left-to-right line rises upward). Each finished line disappears after five seconds. Release Shift or the mouse button to finish; multiple lines can coexist. Drawing is limited to 32 simultaneous lines, and the oldest is removed if that limit is reached.

The browser grants access to the selected tab's audio and video, not a levels-only permission. ErAudio verifies the selection is this tab, stops the video track, and measures frequency levels locally without recording or uploading audio. Canceling leaves playback working without the spectrum. Use the browser's sharing controls to stop.

While playback is paused, the colored spectrum holds its last frame, but the white peak markers keep falling until they disappear. Resuming playback restores live updates for both.

The **BPM** readout to the right of **LOCATIONS**, above **DJ**, estimates the tempo of the shared audio at the current playback speed. If audio isn't shared, use **Share Tab Audio for Visualizer**; no Google sign-in is needed. The readout shows a gray `-- BPM` until it detects a tempo, then turns yellow during playback. Automatic detection needs at least six seconds of steady playback in the visible tab and resets on pause, seek, or speed change. Brief delays between animation frames do not restart detection; longer gaps do. While the audio remains active, the last confident estimate stays visible for up to three seconds through dips in confidence. A moving spectrum confirms that audio is shared, but it doesn't guarantee a tempo estimate. The detector checks for quieter beats between strong accents to avoid reporting half tempo, though some rhythms can still register at half or double tempo. Verify the tempo by ear before relying on it for a live mix. The estimate does not change the manual Pitchfork BPM counters or playback speed.

If the estimate is off or shows `-- BPM`, tap the main **BPM** readout or either **DJ** BPM button in time with the music. The main readout keeps its text-only appearance and also accepts **Enter** or **Space** when focused. All three use the same tap measurement; the main readout's taps do not change either independent DJ counter or playback speed. After two taps, the main readout follows the latest tapped tempo for up to 3 seconds after the last tap, even without audio sharing. With shared audio playing, four steady taps in the supported range (55-200 BPM) also give the detector a 30-second hint. The hint is strongest for 10 seconds, then fades over 20 seconds. It can favor a weaker audio-supported beat near your tap tempo, but it won't report a beat the audio doesn't support. Pause, seek, track or speed changes reset the hint.

### Visualizer preview and customization

Open [`visualizer/preview.html`](./visualizer/preview.html) directly in a browser to try simulated levels without audio, YouTube, sign-in, or tab sharing. The preview and player share the same renderer. See the [visualizer guide](./visualizer/README.md) for customization and tests.

For a small Windows console experiment, see the [PowerShell audio visualizer](./experiments/powershell-audio-visualizer/README.md). It recreates the 16-band idea using system-audio loopback and can open a YouTube URL with `.\experiments\powershell-audio-visualizer\ErAudio.ps1 -v <URL>`.

---

## 🚀 Project Overview & Architecture

### Current Stage: Version 5.0
* **Standalone UI (`index.html`, `styles.css`, `app.js`):** Pixel-styled HTML5 layout for the ErAudio player, audio playlist, and Pitchfork plugin deck.
  The interface fills the browser window; the spectrum and open lists expand when more height is available. Drag the main player's bottom edge to change its height, or focus the resize handle and press **Up** or **Down**. The chosen height is saved in this browser and capped at the visible browser height. In smaller windows, scroll to reach the remaining controls. Transport and pane-button tooltips appear above the controls without adding an internal scrollbar. Browser zoom remains available to adjust the overall size.
* **Audio-First Design:** Focuses on pure audio playlist playback with no embedded video player screen.
* **Granular Controls:** The horizontal speed slider spans the bottom of Pitchfork, from -50% (`0.5x`) to +50% (`1.5x`), with normal speed (0%) at its midpoint. The slider marker and main speed readout show the requested value, rounded to `0.0001x`; the arrow keys adjust it by that amount. The separate **YouTube actual** readout shows the rate reported by the player. YouTube may round unsupported requests toward normal speed, so the reported rate may differ or remain unchanged until a supported step is reached. The actual rate is unavailable until a video is loaded.
* **Semantic Controls:** Transport buttons, toggle buttons, playlist items, checkboxes, and range sliders are real HTML controls with keyboard focus and accessible names.
* **Copy list items:** Right-click an item in **YT**, **TOP**, or the Video Chapters or Timestamps window, then choose **COPY TEXT** or **COPY LINK**. Alternatively, focus an item, press Shift+F10, use the arrow keys to choose, and press Enter; Escape closes the menu. Text includes the displayed number and timestamp or duration. Video links open the video on YouTube; TOP segment, chapter, timestamp, and saved-location links also start at that position, rounded down to whole seconds. A brief notification confirms a successful copy. Clipboard access requires browser permission and a supported secure context, such as HTTPS or localhost.
* **Play control:** Press **Play** to start or resume playback. While playing, a green triangle appears inside the time display without shifting the digits, and the button changes to **Pause** with a slowly pulsing yellow border; press it to pause. The border remains static when reduced motion is requested. While paused, the button looks the same as when stopped.
* **Previous and Next:** Right-click either transport button (or focus it and press Shift+F10) to choose **VIDEOS** or **CURRENT PL** for both buttons. Videos is the default: they follow the list that started the current video, in its original order, and wrap at either end. In current PL mode they seek through the selected chapters, timestamps, or saved locations for the current video, preserving play/pause state. Previous goes to the item before the current one, Next goes to the next item, and navigation stops at the ends. Before the first item, Next goes to it. Unplayable entries are skipped; if no items are available, the status reports why. This choice is saved in browser storage when available and does not change automatic next-video playback.
* **Time display:** Click the timer to switch between elapsed and remaining video time. Remaining time has a minus sign; `--:--` means the duration is not available. You can also focus the timer and press **Enter** or **Space**.
* **Scrolling title:** Click anywhere in the title area to show the beginning. Hold the left mouse button and drag left to see the end, or drag right to move the beginning across the title area instead of stopping at the left edge. Scrolling resumes from where you release it. Right-button dragging starts at the beginning and pauses briefly after release. The title does not affect playback. Right-click the spectrum below it for visualizer settings.
* **Visualizer playback:** Left-click the visualizer outside the title area to play or pause, or focus its playback control and press **Enter** or **Space**. The timer and audio-sharing button keep their own actions.
* **Visualizer fullscreen:** Once tab audio is shared, click the fullscreen button at the upper right of the frequency display. The timer and scrolling title stay at the top. Click **×** or press any key, including **Esc**, to return without interrupting playback. Fullscreen also closes if audio sharing stops.
* **Keyboard shortcut:** Press **Space** to play or pause when the page is focused. Space keeps its normal behavior in focused controls and editable fields; the shortcut is inactive while a dialog or copy menu is open.
* **Listening history:** ErAudio records which parts of each video you actually play, locally in this browser's IndexedDB (no account or network needed). Each record is a span of video seconds, written when playback pauses, seeks, ends, or the video changes. Time spent paused or buffering is not counted, a seek through a part of the video is not a listen (spans under 5 seconds are ignored), and resuming where you left off continues the same span. Because spans are positions in the video, playback speed does not affect them, and chapters or timestamps are only labels applied when the history is read, so they also work for videos that have none or whose markers change. A playback session counts as one play when it records a span of at least 5 seconds. The position bar has a heat strip below it, and each chapter or timestamp in the Chapters window shows a badge such as `x1.5`, the average number of times that section was heard; hotter colors mean more listening. In **TOP**, select **SEGMENTS** or **VIDEOS** to rank passages or whole videos by total listening time, highest first. Time is measured in video time; listen count for segments and play count for whole videos break ties. **EXPORT** and **IMPORT** back up or merge history as a JSON file. **MANAGE HISTORY** explains the deletion scope, offers a backup, and requires typing `DELETE HISTORY` before deletion. The browser may delete site data, so export it if you want to keep it. Tracking is approximate and unavailable if the browser blocks IndexedDB.
  History is associated with the YouTube video ID, so listening to the same video in Local Videos and YouTube playlists contributes to the same TOP entry and heat map. Segment listens count qualifying spans; whole-video plays count playback sessions, so these numbers can differ.
  **TIME PERIOD** filters TOP to all time (the default), today, this week, this month, or this year. Periods follow the browser's local calendar and time zone; the week begins Sunday. Time crossing a period boundary is estimated, and older spans without an end timestamp are assigned to the period when they began. Period-specific video plays count qualifying sessions started during that period. Older history lacks session identifiers, so `≥` marks counts that may be incomplete; all-time counts remain unchanged. The filter does not change the stored history, heat map, or export.

  Drag the bottom edge of **TOP** up for a compact view with room for about one or two entries, or down to show more. Even a full history list can shrink; scroll to see the rest. You can also focus the resize handle and use **Up** and **Down**. Your chosen height is saved in this browser.
* **Open Input:** The Open control accepts an 11-character video ID or a YouTube watch, short, embed, Shorts, or live URL. It validates the ID format, adds the video, and starts playback through the YouTube player; a valid ID does not guarantee that the video exists or is playable. It also emits an `eraudio:control` event with the video ID.
* **Chapters and timestamps:** The Video Chapters or Timestamps window detects timestamp lines in the current video's description. Entries show the time and name, wrapping long names across lines. It infers chapters from the first contiguous group that starts at 0:00, has at least three ascending entries at least 10 seconds apart, and has a final chapter at least 10 seconds long. Entries at or beyond the video's duration are excluded from the inference but remain visible, disabled, in the timestamps view. If the two lists differ, use the button in the window footer to switch between them; identical lists are shown once. Use **SHOW MY LOCATIONS** to switch to a separate chronological list of locations saved with **M+**, or **SHOW VIDEO MARKERS** to return. Select a saved location to seek without changing play/pause state; manage or edit it through **LOCATIONS**. These saved locations are stored per video in browser storage and do not require a YouTube API key. A missing duration prevents chapter inference. Inferred chapters are estimates, not YouTube's actual chapter data, and automatically generated chapters not present in the description are not detected. For public videos description detection works without signing in when a YouTube Data API key is configured; otherwise a configured YouTube login can provide access.
* **Jump from history:** Select a **TOP** entry to play from the start of its chapter or timestamp. Whole-video entries play from the beginning. Opening a video from history does not add it to **YT**.
  A gold edge marks the video that's playing in **YT** and **TOP**'s Videos view, and the current part in **PL** and **TOP**'s Segments view when it has a row there.
* **Remove a video:** In **Local Videos**, right-click a **YT** entry and choose **REMOVE FROM VIDEOS** to remove just that entry, regardless of which videos are selected. This doesn't erase its listening history or saved locations. YouTube playlists are read-only.
* **Sort a YouTube playlist:** In **YT**, select a YouTube playlist to see columns for view counts, your ErAudio play counts, and your total listening time. Use **?** beside the playlist selector to show or hide playlist guidance; loading messages and problems remain visible. Select a column heading to sort, and select it again to reverse the order; **VIDEO** restores playlist order. View counts are loaded using additional YouTube API requests only when you select **VIEWS**; `--` means they have not loaded or are unavailable, and unavailable values sort last. Personal metrics use all-time history for each video (including synced history when signed in), not just listens from that playlist. Listening time is measured in video time, as in **TOP**. Ties keep playlist order. Sorting changes only the display: in VIDEOS mode, Next and Previous follow the original playlist order, and nothing changes on YouTube. The sort resets when switching playlists.
* **Event Hooks:** Controls dispatch an `eraudio:control` `CustomEvent` on `document`. The interface can be opened directly as a local file; if browser storage is unavailable, other preferences fall back to in-memory values for that page session.
* **BPM buttons:** The two independent counters have stable IDs `bpm-left` and `bpm-right`; their control events use those IDs as their names even when the displayed BPM changes. Check **AUTO** beside a counter to follow the live detected BPM. Switching AUTO on or off preserves the current reading; when AUTO is on, the next change to the detected BPM updates it. Unchecking AUTO holds the reading in **MANUAL**, or tap the button to measure a tempo and switch to manual automatically. Right-click a BPM button (or focus it and press Shift+F10) to select AUTO or MANUAL for that counter. Right-click either AUTO checkbox (or focus it and press Shift+F10) for options to enable or disable AUTO on both counters. **AC** resets both counters to AUTO and resets playback speed.
* **BPM matching:** After measuring both BPM values, **M2=M** sets the speed to right BPM divided by left BPM; **M-M2** uses left BPM divided by right BPM. Values outside the slider's range are limited to its nearest endpoint. The YouTube player may not support the requested rate.
* **Speed steps:** Each **+**, **-**, **++**, or **--** button displays its step in percentage points. Right-click it (or press Shift+F10 while focused) to edit the nonnegative value. Press Enter or move focus away to save, or Escape to cancel. Positive and negative buttons share the same step within each size and side; the left side is permanent and the right side is temporary. While a right-side button is held, the solid slider marker stays at the original speed, a translucent marker shows the temporary speed, and the value is labeled **TEMP**. Initial defaults come from `ErAudio.json` when served over HTTP, and edits persist in browser storage, overriding the corresponding file values without modifying the file. Browser storage must be available to save edits.
* **Speed reset:** Hold **=** for 0% (normal speed); releasing it restores the prior speed. **=0=** permanently resets speed to 0%. Neither clears BPM values or saved locations.
* **Nudging:** **◄N** and **N►** move the playback position backward or forward by one-sixteenth of a beat in video time, using the left BPM if measured, or 130 BPM otherwise. The fallback does not set the BPM counter. If a saved location is selected, nudging updates that location instead, even if playback has moved elsewhere. The updated location is saved before the preview and remains changed if the preview fails. Save or cancel an open location edit before nudging a selected location. The player pauses, plays an approximately 100 ms preview, then returns to the requested position paused. YouTube may seek to an earlier keyframe when the target is not buffered, and buffering or browser scheduling can affect preview timing, so precise beat alignment is not guaranteed.
* **Saved playback locations:** Press **M+** while a video is playing or paused to save its current position; select a marker on the position bar to seek back. **LOCATIONS** opens a chronological list for the current video with millisecond timestamps; select an entry to seek without changing play/pause state. Double-click an entry or focus it and press **F2** to edit it as `MM:SS` or `MM:SS.sss`. Save a changed value within the loaded video's duration to update the marker and seek there; an unchanged value does not save or seek again. **Escape** or **CANCEL** discards the edit. An arrow marks the last location selected from the list or bar, until the video changes or the location is cleared. Use **REMOVE SELECTED** to delete that one location; even an unavailable location can be selected in the list for removal. Up to 50 locations per video are stored in browser storage across reloads. **AC** clears the saved locations for all videos as well as resetting speed and BPM. Browser storage must be available to save or clear locations.
* **Sharing locations:** Use **EXPORT LOCATIONS** to download a JSON text file containing saved locations for the current video. The filename includes its title with special characters removed (or its video ID if the title has no usable characters). **IMPORT LOCATIONS** merges a file into local storage, skipping exact duplicates; it also accepts older exports containing multiple videos. If any video would exceed 50 locations, the entire import is rejected without changing existing locations. Importing and exporting require browser storage; exports are not automatically synchronized, and AC does not delete exported files.
* **Automatic speed ramps:** The up/down triangle buttons change speed by 1 percentage point per second by default. Moving toward normal speed stops at 0%; otherwise the ramp stops at the slider limit or the current YouTube video's reported supported limit, whichever is closer. Click the same button to stop, the opposite button to reverse, or use another speed control to stop the ramp. YouTube may apply speed changes in steps instead of continuously; check **YouTube actual** for its reported rate. Set `ramp.percentPerSecond` to a positive number in `ErAudio.json` to change the rate; the file is loaded over HTTP at launch.

### Private listening history sync

See the [Cloudflare sync guide](./cloudflare/README.md) for why ErAudio uses Cloudflare and how to use cross-browser history sync.

TOP's **SEARCH** matches track titles, segment names, and video IDs (case-insensitive; all entered words must match). Search examines all history in the selected period, including entries beyond the 200-row display limit. The footer shows how many entries or matches are displayed.

Click **RANK**, **TRACK / SEGMENT**, **PLAYS** or **LISTENS**, **TIME**, or **DURATION** to sort; click again to reverse direction. **YOUR LISTENING** groups the count and TIME columns with a compact border legend instead of an extra header row, and coordinated highlighting on hover or keyboard focus. **TIME** is time listened in ErAudio, while the separate **DURATION** column is video duration in VIDEOS or segment duration in SEGMENTS. Unknown durations show `--` and sort last in either direction. To compare longer sets, select VIDEOS and sort DURATION; sort TIME or PLAYS to compare popularity. Rank always preserves each entry's popularity position by listening time within the selected period, regardless of search or sorting. Legacy counts marked `≥` are lower bounds, not complete counts. Search and sorting do not change playback or exported history.

When sync is configured, select **?** in **TOP** to show history help, sync status, and shared-computer options. Sign-in and sign-out controls are in the main window.

Sign in once with Google in the main window to connect **TOP**. Sign in with the same account in each browser to combine listening spans, play counts, and heat maps. The first sign-in for each account in a browser asks before copying existing local history. Declining keeps it local. ErAudio uploads video IDs, titles and timeline labels, played ranges, timestamps, playback-session identifiers, and counts to Cloudflare D1; there is no public view. History uses a Google identity token; optional YouTube access uses a separate OAuth access token. In the combined flow, the Worker receives that token from Google and passes it to the browser without storing it.

After a successful sign-in, ErAudio remembers a reconnection preference and asks Google to reconnect on later visits or after history sign-in expires. Google may still require interaction, and the main-window button remains available. With the default sign-in flow, each successful Google history sign-in also makes a best-effort YouTube connection attempt without consent screens, using the verified account email as a login hint, even if this browser has no saved YouTube connection preference. First-time consent, expired permissions, browser popup restrictions, or multiple Google accounts may still require a manual **CONNECT YOUTUBE** click. Failed YouTube attempts never undo Google sign-in or prevent TOP sync; the two tokens remain separate.

The configured combined authorization flow uses one **AUTHORIZE GOOGLE AND YOUTUBE** button to start consent directly from your click. Declining YouTube permission still connects TOP when Google identity is granted. If the popup or authorization service fails, the same location offers **Sign in with Google** for TOP only; **CONNECT YOUTUBE** is then available there without a second login button elsewhere. Previously connected accounts use best-effort reconnection, and YouTube failures never prevent TOP sync. See the [Cloudflare guide](./cloudflare/README.md#testing-combined-google-and-youtube-authorization) for service configuration and testing.

**SIGN OUT** in the main window clears both ErAudio account sessions and disables automatic Google reconnection until you sign in again. It does not sign you out of Google on other websites or revoke previously granted permissions. Tokens and the account login hint remain in page memory; browser storage contains only reconnection preferences, not tokens.

Only listening history is synced. Settings, saved locations, and the Local Videos list remain in browser storage and do not automatically follow your account. Browser storage is also separate between origins, such as `localhost` and the hosted site. Export saved locations or history if you want a backup.

For a shared computer, open **TOP**, select **?**, and choose **USE SHARED COMPUTER**. On a trusted phone, open [ErAudio](https://ericangleton.com/eraudio/) directly from a bookmark or by typing its address, rather than following a link from the shared computer. Sign in with Google in the main window on the phone, open **TOP** and **?**, choose **APPROVE SHARED COMPUTER**, and enter the displayed code within five minutes. The shared computer receives an ErAudio-only session for up to eight hours; Google credentials and the Google identity token stay on the phone. Pairing cancels automatic Google reconnection, and paired sessions cannot connect a YouTube account. The session can read and add listening history, but cannot clear it. Use **SIGN OUT** in the main window to end a shared session. On the phone, **REVOKE SHARED SESSIONS** ends all shared sessions for that account.

The shared session is held in page memory, so a reload requires approval again. Signing out attempts to sync and revoke the session, but a local history copy and any unsynced listens remain on the computer for later reconnection. A revoked or expired session also retains unsynced listens locally; reconnect to the same account to retry. Use a private browser window to reduce locally retained data, and verify Google itself is signed out if it was previously used there. A compromised computer can still misuse the ErAudio session and view or alter listening history while it is active; it cannot be made fully trustworthy by this feature.

Sync checks about once a minute while the page is in use, and when you open **TOP** or return online. It does not interrupt playback. If the network or service is unavailable after sign-in, new listens are saved in that account's local browser storage and retried. If automatic sign-in cannot reconnect after a reload or expiration, use the main-window Google button. While signed out, ErAudio shows and records only this browser's separate local history. Signing out hides the account history in the app; it does not erase its local database. Use separate browser profiles on a shared computer.

Period-specific play details require the updated history Worker. If the app connects to an older Worker, ordinary history continues to sync, while period details remain in the local account database and a sync warning is shown. Deploy the updated Worker to sync those details; no D1 schema migration is required.

While signed in, **EXPORT** includes the combined history, **IMPORT** adds to the active account history, and confirmed deletion under **MANAGE HISTORY** deletes it from the service. Other browsers see the deletion on their next sync; pending changes from before the clear cannot restore it. Any separate signed-out history is unaffected. Existing JSON imports deduplicate identical spans, but old backups only have per-video play counts, so copying the same old backup from multiple browsers may overcount plays.

#### Enable sync on a deployment

The hosted app is configured for history sync. Shared-computer pairing additionally requires the database migration described in the [Cloudflare sync guide](./cloudflare/README.md#shared-computer-pairing-migration). To configure or replace a deployment, follow [Configure your own deployment](./cloudflare/README.md#configure-your-own-deployment), including its verification steps.

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

The app does not ship a YouTube Data API key or read `config.js`. When history sync is configured, its public Google client ID is also the default for optional **CONNECT YOUTUBE** authorization. Each user can enter a YouTube API key or override the YouTube client ID through **API SETUP**; opening **PL** without usable credentials also opens the setup dialog. Both fields are optional. Saving settings does not sign you in. Use **API SETUP** again to change a value or clear a field and save to remove the browser override. Changing or removing the client ID ends the current YouTube session and disables its saved reconnection preference, without signing out of history sync. Without history sync configuration, the original **YOUTUBE LOGIN** flow remains available and requires your own client ID.

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

When a video's description loads successfully but contains no timestamps, ErAudio checks up to 50 relevance-ordered top-level YouTube comments for a possible tracklist. It looks for at least three distinct, labeled timestamps, then chooses the most-liked plausible comment in that sample (using relevance order to break ties). This is a heuristic, not a verified tracklist, and neither pinned comments nor the most-liked comments across the whole video are guaranteed to appear. The list identifies its commenter and links back to the original; comments and their extracted timestamps are not stored in listening history. Disabled comments and request failures are reported without changing playback or saved locations.

#### YouTube account playlists

An OAuth client ID is needed for account playlists, not for public chapters when you use an API key. The hosted app supplies a default; you can configure your own using the steps below. Sign in with Google in the main window, then choose **CONNECT YOUTUBE**. On deployments without history sync, use **YOUTUBE LOGIN** instead. **Local Videos** is always the first option in the Videos window's **PLAYLISTS** dropdown, including while signed out. After connecting YouTube, select one of the account's playlists to load its videos. These playlists are read-only: their videos do not replace or get saved to Local Videos, and add/remove controls are available only in the local list. The main **Open** control adds a video to Local Videos and switches the view there.

Account playlists are listed alphabetically after Local Videos. Type in **FIND** to filter playlist names as you type; matching ignores case. Filtering does not change the current playlist or interrupt playback, so the current selection remains displayed even if it does not match. Clear the filter to show all playlists again.

Switching the visible list does not interrupt playback; in VIDEOS mode, **Next** and **Previous** follow the playlist that started the current video. YouTube lists are fetched again when selected. The API does not include video durations in playlist items, so their durations initially show `--:--`; unavailable items without a video ID are omitted and reported, and videos that cannot be embedded may still fail to play. If loading fails, the previous list remains visible. Local Videos is stored in this browser's storage and may be lost if site data is cleared.

YouTube authorization can also retrieve video descriptions. With history sync configured, automatic YouTube reconnection is attempted only after Google sign-in succeeds and this browser has previously connected YouTube. Without history sync, the original page-load authorization attempt remains available for a configured client ID.

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
5. In **API SETUP**, enter the client ID (ending in `.apps.googleusercontent.com`) and save. Do not enter the client secret. Click **CONNECT YOUTUBE** after Google sign-in, or **YOUTUBE LOGIN** on a deployment without history sync, to authorize your account.
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
