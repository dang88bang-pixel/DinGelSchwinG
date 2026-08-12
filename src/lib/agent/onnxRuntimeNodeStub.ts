/**
 * Stub für onnxruntime-node (wird von @huggingface/transformers nur im
 * Node-Kontext dynamisch importiert). Im Browser/WebView läuft die App
 * ausschließlich über onnxruntime-web (WASM) – dieser Stub verhindert,
 * dass Vite das native Node-Paket zu bündeln versucht.
 */
const stub = new Proxy(
  {},
  {
    get() {
      throw new Error('onnxruntime-node ist nur für Node.js gedacht – im Browser wird onnxruntime-web (WASM) verwendet.');
    },
  },
);

export default stub;
