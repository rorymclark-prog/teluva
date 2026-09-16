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

/* Copies the scanic-ml corner-detection model into public/ so it is served
 * from OUR origin.
 *
 * scanic's ML detector defaults to fetching its model and WASM from a public
 * CDN (cdn.jsdelivr.net). That is a third-party request made at the exact
 * moment someone is photographing a birth certificate, and it would need a CSP
 * exception to a host we do not control for a feature that handles the most
 * sensitive documents in the app. Self-hosting costs a copy step and removes
 * the question entirely.
 *
 * Copied rather than committed: the payload is a 1.9MB model plus a 1.5MB
 * WASM runtime, which does not belong in git when npm already has it pinned in
 * package-lock.json. Runs in dev and in build, and is a no-op when the files
 * are already in place, so it costs nothing on a warm tree.
 */
function copyScanicMlAssets(): Plugin {
  return {
    name: 'copy-scanic-ml-assets',
    buildStart() {
      const from = path.resolve(__dirname, 'node_modules/scanic-ml/dist');
      const to = path.resolve(__dirname, 'public/scanic-ml');
      try {
        if (!fs.existsSync(from)) return;   // dependency absent: the app falls back to the classical detector
        fs.mkdirSync(to, {recursive: true});
        for (const f of fs.readdirSync(from)) {
          const src = path.join(from, f);
          const dest = path.join(to, f);
          if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) continue;
          fs.copyFileSync(src, dest);
        }
      } catch (e) {
        // Never fail the build for this. Without the assets the scanner still
        // works — it just uses the classical edge detector for every shot.
        console.warn('[copy-scanic-ml-assets] skipped:', (e as Error)?.message);
      }
    },
    // DEV ONLY. The ONNX runtime loads its glue with a dynamic import() of
    // /scanic-ml/ort-wasm-simd-threaded.mjs. Vite's dev server refuses to serve
    // a public/ file as a JS module ("should not be imported from source
    // code") and answers 500, so in `npm run dev` the ML detector always failed
    // and every hard shot fell to manual cropping — the fallback could not be
    // exercised before a deploy. Serving these files raw, ahead of Vite's own
    // middleware, is what production (plain static files) already does.
    configureServer(server) {
      const dir = path.resolve(__dirname, 'public/scanic-ml');
      const types: Record<string, string> = {'.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm'};
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/scanic-ml/')) return next();
        const file = path.join(dir, path.basename(url));
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copyScanicMlAssets(), emitVersionJson()],
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
    // The scanner's live page-detection worker imports scanic, which
    // code-splits (its ML path is a dynamic import); Vite's default IIFE worker
    // format cannot code-split, so workers are built as ES modules. Every
    // browser that can run this app supports module workers.
    worker: {
      format: 'es' as const,
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
