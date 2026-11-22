// After `vite build`: delete the onnxruntime wasm files Vite copies into dist/assets from @huggingface/transformers.
// The recogniser loads its runtime from the site's own stt/ folder (src/gl/sttWorker.ts sets the wasm paths), so these
// copies (~27 MB) are never fetched. Same as Magic Block's dropOrtWasm plugin — done here so vite.config.ts stays as it is.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('dist/assets');
let n = 0, bytes = 0;
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (/^ort-wasm[^/]*\.wasm$/.test(f)) { bytes += fs.statSync(path.join(dir, f)).size; fs.unlinkSync(path.join(dir, f)); n++; }
}
console.log(`drop_ort_wasm: removed ${n} file(s), ${(bytes / 1048576).toFixed(1)} MB`);
