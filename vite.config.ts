import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// One build stamp per `vite build`, shared by the value baked into the bundle
// (__APP_VERSION__) and the emitted dist/version.json. A running tab compares
// the two: when the deployed version.json no longer matches the constant the
// tab was built with, it knows it is running an older build and offers a refresh.
const BUILD_ID = String(Date.now());

// A short, human-written "what changed" list (plus a friendly "v100"-style
// label) for the current deploy — lives at repo root as CHANGES.json, updated
// by hand right before each real deploy build. Read here (not imported as a
// module) so editing it never needs a second build step. Missing/malformed
// file just means no label/changelog shows.
function readDeployMeta(): { label: string; changes: string[] } {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'CHANGES.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      label: typeof parsed.label === 'string' ? parsed.label : '',
      changes: Array.isArray(parsed.changes) ? parsed.changes.filter((c: unknown) => typeof c === 'string') : [],
    };
  } catch {
    return { label: '', changes: [] };
  }
}

// Writes dist/version.json after the build so the server can serve it.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      fs.mkdirSync(outDir, {recursive: true});
      const meta = readDeployMeta();
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify({version: BUILD_ID, label: meta.label, changes: meta.changes}) + '\n',
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), emitVersionJson()],
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_ID),
      // The human-readable release label ("v177"), baked in so the app can SAY
      // which build it is. __APP_VERSION__ is a millisecond build stamp — fine
      // for the newer-than comparison UpdateBanner does, useless to read aloud
      // when someone asks "did the update land?". Read at config time from the
      // same CHANGES.json that feeds version.json, so the label in Settings and
      // the label in the update toast can never disagree.
      __APP_LABEL__: JSON.stringify(readDeployMeta().label),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
