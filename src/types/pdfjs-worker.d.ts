// pdf.js ships the worker as an ES module without type declarations. It is
// imported for its side effect only (registering the worker so the server
// runtime never has to resolve a module path at request time).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
