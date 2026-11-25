import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The retries are for diagnosis. A test that passes only on a retry is listed (flaky-summary-reporter.ts,
  // observe mode). failOnFlakyTests: !!process.env.CI comes once the fixes of the flaky specs have landed and the
  // count has stayed at 0 for 10 runs in a row (the author's decision, docs/verification-practices-study.md §3.1).
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["./flaky-summary-reporter.ts"]] : "list",
  // CI runners are slow to first paint; the debounce/fetch chains need headroom.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // The headless shell has no getUserMedia: the field report's spec runs in full Chromium with a fake
    // camera and microphone (examples/state-field-report, docs/seam-apps.md).
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /state-field-report\.spec\.ts/ },
    {
      name: "chromium-media",
      testMatch: /state-field-report\.spec\.ts/,
      // one worker for the file: a fake camera encoding in many browsers at once starves the encoder
      // (a short take comes out as a header-only WebM)
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } },
    },
    // The production form differs between browsers where the CSP / SRI guides once said "Chromium only": import map
    // integrity and Trusted Types. prod-booking's checks tagged @browsers run in Firefox too (examples/prod-booking).
    // So do the router's fragment links, which read Firefox's NavigateEvent (router-fragment-links), and the
    // city-library seam app's skip link, pagination, login under view transitions, time zones and languages.
    // And @wcstack/audio's context waiting for the first gesture, whose warning Firefox printed on load (audio-gesture).
    // And @wcstack/signals' delegateEvents, which leans on composedPath() and an overridden currentTarget (signals-delegate).
    // And an I/O node in a row a reorder moves: Firefox's moveBefore() calls connectedMoveCallback too (io-move-row).
    // And the ekiden-entry seam app's guards, which redirect the page-load navigation after an import (ekiden-entry).
    // And <wcs-infinite-scroll>, whose sentinel reported before state had written the url — never a first page in Firefox
    // (fetch-infinite-scroll).
    // And the town-archive seam app: a $watch on a getter over the first width an element hands over, which did not
    // fire in Firefox either, the command that carries its url, and Back to the card (town-archive).
    // And the router's route paths: a static segment as written, the URL's segments percent-decoded (router-encoded-paths, #694).
    // And the screen and sensor nodes: Firefox reports a refused pointer lock as an event, with no rejected promise
    // (io-screen-sensors).
    // And the stamp-rally seam app: its device check as Firefox is (no Picture-in-Picture, eye dropper or saved
    // passwords; a forbidding frame told only by fullscreenEnabled), the orientation lock Firefox refuses while
    // fullscreen, the pointer lock, and saved passwords where the browser has no PasswordCredential (stamp-rally).
    // And <wcs-sse> when the page leaves: Firefox logged a stream open at a full navigation (sse-unload).
    // And the lending-desk seam app: its live updates with no listener of its own around <wcs-sse> (reloads, sign-out
    // in another tab, a restart), the counter screen, and its dates in three time zones (lending-desk).
    // And the garden-plots seam app: parts that arrive late (a DCC from its file, a class), a dialog's focus, the
    // pager's focus kept by key, the settings saved straight into a volume and read by another tab, a row moved
    // with a part open in it, and the previous / next links between plots (garden-plots).
    // And the street-reports seam app (a React team's app moved over): the board's move from a second context, the
    // leave dialog on a link and on Back, the lightbox's focus, the debounced search, the event streams not
    // leaking over three visits, and the theme in a second tab (street-reports).
    {
      name: "firefox",
      testMatch: /(prod-booking|router-fragment-links|city-library|audio-gesture|signals-delegate|io-move-row|ekiden-entry|fetch-infinite-scroll|town-archive|router-encoded-paths|io-screen-sensors|stamp-rally|sse-unload|lending-desk|garden-plots|street-reports)\.spec\.ts/,
      grep: /@browsers/,
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: "node serve.mjs",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
