# Important feature walkthroughs

Rory requested animated feature announcements on 5 November 2026, then explicitly
asked for Teluva's animation to loop by default. ImbewuField remains play-once.

Only important releases get `feature` in CHANGES.json and the identical metadata
in their public/changelog.json entry. Omit it for routine releases. A new demo
needs an implemented visual and an explicit allowlist entry in featureUpdates.ts.
Use a stable feature ID: acknowledging it records a per-device seen preference.

Automatic cards retain Settings → Show update notes on this device (default off).
First launches stay quiet. What's new always retains the feature card for replay.
Dismiss and Learn more acknowledge the announcement without refreshing the app.

The eight-second illustration loops while visible. Pause, offscreen history cards
and hidden browser tabs pause its CSS animations. Reduced motion displays a
complete still image. Unmounting disconnects the visibility observer/listener;
there is no repeating JavaScript timer, video download or paid generation.
