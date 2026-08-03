/// <reference types="vite/client" />

// Injected at build time by Vite `define` in vite.config.ts (the build stamp).
declare const __APP_VERSION__: string;

// The human-readable release label from CHANGES.json ("v177"). Empty string in
// dev, where there is no deploy to label.
declare const __APP_LABEL__: string;
