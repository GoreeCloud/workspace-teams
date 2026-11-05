# Real-browser acceptance — opt-in alpha checks

The repository includes an **optional**, self-contained Chromium/Puppeteer smoke test that exercises the running Workspace Teams web interface through an actual loopback HTTP server. It does **not** navigate a production instance, access existing databases, install a browser, modify server configuration, or use real user content. Tests generate a private, temporary SQLite database and synthetic account/file data, then remove the database after the run.

## Prerequisites and execution

- Node.js 22.16 or newer and a Chromium binary capable of running headlessly.
- An already-reviewed, locally installed Puppeteer package. It is not a required application dependency and is not installed by npm test or by the smoke script itself.
- An environment where local loopback browser navigation and Chromium sandboxing are permitted. Do not bypass a host or browser administrator's restrictions to make this test pass.

Set the paths to **your installed** Puppeteer module and Chromium binary; do not copy device-specific paths from another environment:

    PUPPETEER_MODULE=/path/to/node_modules/puppeteer CHROMIUM_PATH=/path/to/chromium npm run qa:browser

For screenshots containing **synthetic data only**, set QA_SCREENSHOT_DIR to an existing private location or a new directory you control. The script creates that directory with restricted permissions where supported and saves workspace-desktop.png and workspace-mobile.png. Without the variable, no screenshots are saved. Keep images and logs private if later extended to real data.

## What is checked

The script launches a fresh temporary Node server at a dynamic 127.0.0.1 port with matching APP_ORIGIN. It tests the actual browser flow for first-owner setup, authenticated message/task creation, permission-scoped search, file upload, attachment-inclusive owner export, account-security dialog, 390px mobile layout without horizontal overflow, mobile account-dialog sign-out, desktop sign-out, and uncaught JavaScript errors. Each request is made against the temporary server and does not reuse any existing session or application data.

Run npm run check and npm test in addition to the optional smoke check. The standard test suite does not require Chromium or Puppeteer.

## Verified development result and limits

On **November 3, 2026**, a fresh checkout of GoreeCloud/workspace-teams was tested on the authorized Linux laptop using Node.js 24.19.0 and a preinstalled Chromium/Puppeteer environment. The original live-browser run exposed an inaccessible mobile logout control; the revised dialog flow passed. The opt-in repeatable smoke test passed **12/12** checks with the Chromium sandbox enabled. Syntax checks and the core 34-test suite passed after the fix.

This is evidence of **one synthetic development environment**, not comprehensive visual approval, accessibility certification, cross-browser/device compatibility, performance testing, native client acceptance, production security assessment, or host-level disaster recovery. Screenshots require manual inspection and comparison with current GoreeCloud UI design authority. Do not describe CI as running real browsers unless its workflow actually provisions and executes them.
## Status feedback layout check

The optional real-browser harness verifies that an authenticated workspace status notification appears **inside the main content flow**, below the header, rather than floating across export actions. The temporary sign-in screen continues to use a polite, floating status notification. Both use the existing `role="status"` live region without moving keyboard focus. This layout check is desktop-sized; mobile geometry, zoom, and screen-reader acceptance remain separate release gates.
