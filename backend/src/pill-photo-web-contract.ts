// Shared browser/server upload constants; no server dependencies.
export const PILL_WEB_PREPROCESSING_VERSION = "pill-web-canvas-jpeg-v1";
export const PILL_WEB_MAX_BODY_BYTES = 6 * 1024 * 1024;
export const PILL_WEB_IMAGE_NAMES = ["front-context", "back-context", ...["front", "back"].flatMap(side => ["color", "contrast"].flatMap(kind => [0, 90, 180, 270].map(angle => `${side}-${kind}-${angle}`)))];
