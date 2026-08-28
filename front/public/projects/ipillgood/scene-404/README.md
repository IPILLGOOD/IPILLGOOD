# IPILLGOOD 404 illustration

Original artwork created for IPILLGOOD: a green capsule looking for its way home.
No third-party illustration, fonts, raster images, expressions, or external assets.

- `lottie.json`: 480 × 320, 30 fps, 132 frames (4.4 seconds); loops seamlessly.
- `poster.svg`: matching first frame for initial render, reduced motion, and load failures.
- Rebuild both files from the repository root with `node front/scripts/generate-not-found-animation.mjs`.

The app loads the SVG-only `lottie-web` player dynamically on `/404`, pauses when
hidden or outside the viewport, and destroys it on unmount. Playback loops
automatically without controls, with subframe interpolation for smooth motion.
Reduced motion skips the player and JSON download. Artwork was checked at
frames 0, 66, and 131 in the official diffusionstudio/lottie Skottie player,
then in the application.
