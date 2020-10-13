// These tests exercise all forms of import and export between a pair of
// modules using a single Compartment.

import test from 'ava';
import '../ses.js';
import { resolveNode, makeNodeImporter } from './node.js';

test('import for side effect', async t => {
  t.plan(0);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-for-side-effect.js': `
      // empty
    `,
    'https://example.com/main.js': `
      import './import-for-side-effect.js';
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  await compartment.import('./main.js');
});

test('import all from module', async t => {
  t.plan(2);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-all-from-me.js': `
      export const a = 10;
      export const b = 20;
    `,
    'https://example.com/main.js': `
      import * as bar from './import-all-from-me.js';
      export default bar;
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.default.a, 10);
  t.is(namespace.default.b, 20);
});

test('import named exports from me', async t => {
  t.plan(2);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-named-exports-from-me.js': `
      export const fizz = 10;
      export const buzz = 20;
    `,
    'https://example.com/main.js': `
      import { fizz, buzz } from './import-named-exports-from-me.js';
      export default { fizz, buzz };
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.default.fizz, 10);
  t.is(namespace.default.buzz, 20);
});

test('import color from module', async t => {
  t.plan(1);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-named-export-and-rename.js': `
      export const color = 'blue';
    `,
    'https://example.com/main.js': `
      import { color as colour } from './import-named-export-and-rename.js';
      export const color = colour;
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.color, 'blue');
});

test('import and reexport', async t => {
  t.plan(1);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-and-reexport-name-from-me.js': `
      export const qux = 42;
    `,
    'https://example.com/main.js': `
      export { qux } from './import-and-reexport-name-from-me.js';
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.qux, 42);
});

test('import and export all', async t => {
  t.plan(2);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-and-export-all-from-me.js': `
      export const alpha = 0;
      export const omega = 23;
    `,
    'https://example.com/main.js': `
      export * from './import-and-export-all-from-me.js';
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.alpha, 0);
  t.is(namespace.omega, 23);
});

test('live binding', async t => {
  t.plan(1);

  const makeImportHook = makeNodeImporter({
    'https://example.com/import-live-export.js': `
      export let quuux = null;
      // Live binding of an exported variable.
      quuux = 'Hello, World!';
    `,
    'https://example.com/main.js': `
      import { quuux } from './import-live-export.js';
      export default quuux;
    `,
  });

  const compartment = new Compartment(
    {},
    {},
    {
      resolveHook: resolveNode,
      importHook: makeImportHook('https://example.com'),
    },
  );

  const { namespace } = await compartment.import('./main.js');

  t.is(namespace.default, 'Hello, World!');
});
