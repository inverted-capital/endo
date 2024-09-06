/* eslint no-underscore-dangle: ["off"] */

import { makeModuleAnalyzer } from './transform-analyze.js';

const { keys, values } = Object;

// Disable readonly markings.
const freeze = /** @type {<T>(v: T) => T} */ (Object.freeze);

// If all ESM implementations were correct, it would be sufficient to
// `import babel` instead of `import * as babel`.
// However, the `node -r esm` emulation of ESM produces a linker error,
// claiming there is no export named default.
// Also, the behavior of `import * as babel` changes from Node.js 14 to 16.
// Node.js 14 produces an extraneous { default } wrapper around the exports
// namespace and 16 introduces lexical static analysis of exported names, so
// comes closer to correct, and at least consistent with `node -r esm`.
//
// Node.js 14:
//   NESM:
//     babel:     exports
//     babelStar: { default: exports }
//   RESM:
//     babel:     linker error: no export named default
//     babelStar: exports
// Node.js 16:
//   NESM:
//     babel:     exports
//     babelStar: exports + trash
//   RESM:
//     babel:     linker error: no export named default
//     babelStar: exports

const analyzeModule = makeModuleAnalyzer();

/**
 * @typedef {object} SourceMapHookDetails
 * @property {string} compartment
 * @property {string} module
 * @property {string} location
 * @property {string} sha512
 */

/**
 * @callback SourceMapHook
 * @param {string} sourceMap
 * @param {SourceMapHookDetails} details
 */

/**
 * @typedef {object} Options
 * @property {string} [sourceUrl]
 * @property {string} [sourceMap]
 * @property {string} [sourceMapUrl]
 * @property {SourceMapHook} [sourceMapHook]
 */

// https://github.com/tc39/proposal-source-phase-imports?tab=readme-ov-file#js-module-source

let AbstractModuleSourcePrototype = {};

// WebAssembly and ModuleSource are both in motion.
// The Source Phase Imports proposal implies an additional AbstractModuleSource
// layer above the existing WebAssembly.Module that would be shared by
// the JavaScript ModuleSource prototype chain.
// This condition is not met at time of writing, but will allow these prototype
// chains to converge
const WebAssembly = globalThis.WebAssembly;
if (WebAssembly !== undefined) {
  const WebAssemblyModuleSource = WebAssembly.Module;
  const WebAssemblyModuleSourcePrototype = WebAssemblyModuleSource.prototype;
  const WebAssemblyModuleSourcePrototypeProto = Object.getPrototypeOf(
    WebAssemblyModuleSourcePrototype,
  );
  if (WebAssemblyModuleSourcePrototypeProto !== Object.prototype) {
    AbstractModuleSourcePrototype = WebAssemblyModuleSourcePrototypeProto;
  }
}

// XXX implements import('ses').PrecompiledModuleSource but adding
// `@implements` errors that this isn't a class and `@returns` errors that
// there's no value returned.
/**
 * ModuleSource captures the effort of parsing and analyzing module text
 * so a cache of ModuleSources may be shared by multiple Compartments.
 *
 * @class
 * @param {string} source
 * @param {string | Options} [opts]
 */
export function ModuleSource(source, opts = {}) {
  if (new.target === undefined) {
    throw TypeError(
      "Class constructor ModuleSource cannot be invoked without 'new'",
    );
  }
  if (typeof opts === 'string') {
    opts = { sourceUrl: opts };
  }
  const {
    imports,
    functorSource,
    liveExportMap,
    reexportMap,
    fixedExportMap,
    exportAlls,
    needsImportMeta,
  } = analyzeModule(source, opts);
  this.imports = freeze([...keys(imports)]);
  this.exports = freeze(
    [
      ...keys(liveExportMap),
      ...keys(fixedExportMap),
      ...values(reexportMap).flatMap(([_, exportName]) => exportName),
    ].sort(),
  );
  this.reexports = freeze([...exportAlls].sort());
  this.__syncModuleProgram__ = functorSource;
  this.__liveExportMap__ = liveExportMap;
  this.__reexportMap__ = reexportMap;
  this.__fixedExportMap__ = fixedExportMap;
  this.__needsImportMeta__ = needsImportMeta;
  freeze(this);
}

Object.setPrototypeOf(ModuleSource.prototype, AbstractModuleSourcePrototype);
