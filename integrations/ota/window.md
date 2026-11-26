# Persistent update window

The shared Sun/Night update window keeps the browser document rendered through the restart. It shows native update phases tied to the request ID, suppresses background LuCI polling during the operation, and uses direct same-origin status requests so an expired login session cannot replace the window. It never automatically navigates or reloads an unavailable router page.

The small read-only CGI beacon exposes only product, firmware version, build, revision and boot identity. It accepts GET/HEAD only and has no update controls or configuration data. Completion requires a different boot identity and repeated matches of the expected firmware build and revision. A mismatch is reported rather than called a successful update. The client is told to reconnect to Wi-Fi/LAN and refresh if the window does not refresh. Session storage permits confirmation after a manual refresh and new sign-in.

The header has no leaf beside System Update; the large centered green leaf remains. Desktop and mobile layouts use the existing blue/neutral palette. No countdown or estimated flash percentage is displayed. The optional-service recovery state stays open until the backend reports restoration complete.

Tests cover phase/request matching, disconnect and expired-session behavior, firmware mismatch, positive confirmation, recovery status, and K45P detached-worker verification failures. Browser previews cover both themes, 390×844 and 375×667 phone layouts, failure, recovery and confirmation states. K43P OTA resource/recovery tests remain in place.
