// This is a test fixture for minimal spot checks of the XS-specific variant of
// SES.
// The script ../scripts/generate-test-xs.js generates the _meaning.pre-mjs.json
// module by precompiling _meaning.js, then bundles this module with the "xs"
// package export/import condition so that it entrains ../src-xs/shim.js instead
// of the ordinary SES shim.
// This generates ../tmp/test-xs.js, which can be run with xst directly for
// validation of the XS environment under SES-for-XS.

// Eslint does not know about package reflexive imports (importing your own
// package), which in this case is necessary to go through the conditional
// export in package.json.
// eslint-disable-next-line import/no-extraneous-dependencies
import 'ses';

// The dependency below is generated by ../scripts/generate-test-xs.js
// eslint-disable-next-line import/no-unresolved
import precompiledModuleSource from '../tmp/_meaning.pre-mjs.json';

lockdown();

// spot checks
assert(Object.isFrozen(Object));

// import a precompiled module source in a shim compartment
{
  const virtualCompartment = new Compartment({
    __options__: true,
    modules: {
      '.': {
        source: precompiledModuleSource,
      },
    },
  });
  assert(
    virtualCompartment.importNow('.').default === 42,
    'can import precompiled module source',
  );
}

// import a native module source in a native compartment
{
  const nativeCompartment = new Compartment({
    __options__: true,
    __native__: true,
    modules: {
      '.': {
        source: new ModuleSource(`
        export default 42;
      `),
      },
      virtual: {
        source: precompiledModuleSource,
      },
    },
  });

  assert(
    nativeCompartment.importNow('.').default === 42,
    'can import native module source',
  );
}

// fail to import a native module source in a shim compartment
{
  let threw = null;
  try {
    new Compartment({
      __options__: true,
      modules: {
        '.': {
          source: new ModuleSource(''),
        },
      },
    }).importNow('.');
  } catch (error) {
    threw = error;
  }
  assert(
    threw,
    'attempting to import a native module source on a virtual compartment should fail',
  );
}

// fail to import a precompiled module source in a native compartment
{
  let threw = null;
  try {
    new Compartment({
      __options__: true,
      __native__: true,
      modules: {
        '.': {
          source: precompiledModuleSource,
        },
      },
    }).importNow('.');
  } catch (error) {
    threw = error;
  }
  assert(
    threw,
    'attempting to import a precompiled module source in a native compartment should fail',
  );
}

// To be continued in hardened262...
