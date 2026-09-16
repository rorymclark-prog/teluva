// Keep the Vite URL import in a lazy browser-only module. Node test imports of
// docText must not evaluate a bundler-only asset; Vite must see a static URL import.
export { default } from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
