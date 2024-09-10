// Copyright (C) 2019 Agoric, under Apache License 2.0
// @ts-check

// To ensure that this module operates without special privilege, it should
// not reference the free variable `console` except for its own internal
// debugging purposes in the declaration of `internalDebugConsole`, which is
// normally commented out.

// This module however has top level mutable state which is observable to code
// given access to the `loggedErrorHandler`, such as the causal console
// of `console.js`. However, for code that does not have such access, this
// module should not be observably impure.

import {
  RangeError,
  TypeError,
  WeakMap,
  arrayJoin,
  arrayMap,
  arrayPop,
  arrayPush,
  assign,
  freeze,
  defineProperty,
  globalThis,
  is,
  isError,
  regexpTest,
  stringIndexOf,
  stringReplace,
  stringSlice,
  stringStartsWith,
  weakmapDelete,
  weakmapGet,
  weakmapHas,
  weakmapSet,
  AggregateError,
  SuppressedError,
  getOwnPropertyDescriptors,
  ownKeys,
  objectHasOwnProperty,
} from '../commons.js';
import { an, bestEffortStringify } from './stringify-utils.js';
import './types.js';
import './internal-types.js';
import { makeNoteLogArgsArrayKit } from './note-log-args.js';

/**
 * @import {BaseAssert, Assert, AssertionFunctions, AssertionUtilities, StringablePayload, DetailsToken, MakeAssert} from '../../types.js'
 */

// For our internal debugging purposes, uncomment
// const internalDebugConsole = console;

// /////////////////////////////////////////////////////////////////////////////

/** @type {WeakMap<StringablePayload, any>} */
const declassifiers = new WeakMap();

/** @type {AssertionUtilities['quote']} */
const quote = (payload, spaces = undefined) => {
  const result = freeze({
    toString: freeze(() => bestEffortStringify(payload, spaces)),
  });
  weakmapSet(declassifiers, result, payload);
  return result;
};
freeze(quote);

const canBeBare = freeze(/^[\w:-]( ?[\w:-])*$/);

/**
 * @type {AssertionUtilities['bare']}
 */
const bare = (payload, spaces = undefined) => {
  if (typeof payload !== 'string' || !regexpTest(canBeBare, payload)) {
    return quote(payload, spaces);
  }
  const result = freeze({
    toString: freeze(() => payload),
  });
  weakmapSet(declassifiers, result, payload);
  return result;
};
freeze(bare);

// /////////////////////////////////////////////////////////////////////////////

/**
 * @typedef {object} HiddenDetails
 *
 * Captures the arguments passed to the `details` template string tag.
 *
 * @property {TemplateStringsArray | string[]} template
 * @property {any[]} args
 */

/**
 * @type {WeakMap<DetailsToken, HiddenDetails>}
 *
 * Maps from a details token which a `details` template literal returned
 * to a record of the contents of that template literal expression.
 */
const hiddenDetailsMap = new WeakMap();

/**
 * @param {HiddenDetails} hiddenDetails
 * @returns {string}
 */
const getMessageString = ({ template, args }) => {
  const parts = [template[0]];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    let argStr;
    if (weakmapHas(declassifiers, arg)) {
      argStr = `${arg}`;
    } else if (isError(arg)) {
      argStr = `(${an(arg.name)})`;
    } else {
      argStr = `(${an(typeof arg)})`;
    }
    arrayPush(parts, argStr, template[i + 1]);
  }
  return arrayJoin(parts, '');
};

/**
 * Give detailsTokens a toString behavior. To minimize the overhead of
 * creating new detailsTokens, we do this with an
 * inherited `this` sensitive `toString` method, even though we normally
 * avoid `this` sensitivity. To protect the method from inappropriate
 * `this` application, it does something interesting only for objects
 * registered in `redactedDetails`, which should be exactly the detailsTokens.
 *
 * The printing behavior must not reveal anything redacted, so we just use
 * the same `getMessageString` we use to construct the redacted message
 * string for a thrown assertion error.
 */
const DetailsTokenProto = freeze({
  toString() {
    const hiddenDetails = weakmapGet(hiddenDetailsMap, this);
    if (hiddenDetails === undefined) {
      return '[Not a DetailsToken]';
    }
    return getMessageString(hiddenDetails);
  },
});
freeze(DetailsTokenProto.toString);

/**
 * Normally this is the function exported as `assert.details` and often
 * spelled `X`. However, if the `{errorTaming: 'unsafe'}` or
 * `{errorTaming: 'unsafe-debug'}` option is
 * given to `lockdown`, then `unredactedDetails` is used instead.
 *
 * There are some unconditional uses of `redactedDetails` in this module. All
 * of them should be uses where the template literal has no redacted
 * substitution values. In those cases, the two are equivalent.
 *
 * @type {AssertionUtilities['details']}
 */
const redactedDetails = (template, ...args) => {
  // Keep in mind that the vast majority of calls to `details` creates
  // a details token that is never used, so this path must remain as fast as
  // possible. Hence we store what we've got with little processing, postponing
  // all the work to happen only if needed, for example, if an assertion fails.
  const detailsToken = freeze({ __proto__: DetailsTokenProto });
  weakmapSet(hiddenDetailsMap, detailsToken, { template, args });
  return /** @type {DetailsToken} */ (/** @type {unknown} */ (detailsToken));
};
freeze(redactedDetails);

/**
 * `unredactedDetails` is like `details` except that it does not redact
 * anything. It acts like `details` would act if all substitution values
 * were wrapped with the `quote` function above (the function normally
 * spelled `q`). If the `{errorTaming: 'unsafe'}`
 * or `{errorTaming: 'unsafe-debug'}` option is given to
 * `lockdown`, then the lockdown-shim arranges for the global `assert` to be
 * one whose `details` property is `unredactedDetails`.
 * This setting optimizes the debugging and testing experience at the price
 * of safety. `unredactedDetails` also sacrifices the speed of `details`,
 * which is usually fine in debugging and testing.
 *
 * @type {AssertionUtilities['details']}
 */
const unredactedDetails = (template, ...args) => {
  args = arrayMap(args, arg =>
    weakmapHas(declassifiers, arg) ? arg : quote(arg),
  );
  return redactedDetails(template, ...args);
};
freeze(unredactedDetails);
export { unredactedDetails };

/**
 * @param {HiddenDetails} hiddenDetails
 * @returns {LogArgs}
 */
const getLogArgs = ({ template, args }) => {
  const logArgs = [template[0]];
  for (let i = 0; i < args.length; i += 1) {
    let arg = args[i];
    if (weakmapHas(declassifiers, arg)) {
      arg = weakmapGet(declassifiers, arg);
    }
    // Remove the extra spaces (since console.error puts them
    // between each cause).
    const priorWithoutSpace = stringReplace(arrayPop(logArgs) || '', / $/, '');
    if (priorWithoutSpace !== '') {
      arrayPush(logArgs, priorWithoutSpace);
    }
    const nextWithoutSpace = stringReplace(template[i + 1], /^ /, '');
    arrayPush(logArgs, arg, nextWithoutSpace);
  }
  if (logArgs[logArgs.length - 1] === '') {
    arrayPop(logArgs);
  }
  return logArgs;
};

/**
 * @type {WeakMap<Error, LogArgs>}
 *
 * Maps from an error object to the log args that are a more informative
 * alternative message for that error. When logging the error, these
 * log args should be preferred to `error.message`.
 */
const hiddenMessageLogArgs = new WeakMap();

// So each error tag will be unique.
let errorTagNum = 0;

/**
 * @type {WeakMap<Error, string>}
 */
const errorTags = new WeakMap();

/**
 * @param {Error} err
 * @param {string=} optErrorName
 * @returns {string}
 */
const tagError = (err, optErrorName = err.name) => {
  let errorTag = weakmapGet(errorTags, err);
  if (errorTag !== undefined) {
    return errorTag;
  }
  errorTagNum += 1;
  errorTag = `${optErrorName}#${errorTagNum}`;
  weakmapSet(errorTags, err, errorTag);
  return errorTag;
};

/**
 * The own properties that we expect to see on an error object when it is
 * first constructed. Any other properties added by the constructor are
 * beyond what is standard. When sanitizing, these should be removed
 * immediately after construction.
 * Currently known examples:
 * - `fileName` and `lineNumber` on Firefox/SpiderMonkey
 * - `line` on Safari/JSC
 *
 * These example properties in particular carry information that should
 * normally be redacted.
 */
const expectedErrorOwnProps = freeze({
  __proto__: null, // this is syntax, not a property named "__proto__"
  message: true,
  stack: true,
  cause: true,
  errors: true,
  error: true,
  suppressed: true,
});

/**
 * Make reasonable best efforts to make a `Passable` error.
 *   - `sanitizeError` will remove any "extraneous" own properties already added
 *     by the host,
 *     such as `fileName`,`lineNumber` on FireFox or `line` on Safari.
 *   - If any such "extraneous" properties were removed, `sanitizeError` will
 *     annotate
 *     the error with them, so they still appear on the causal console
 *     log output for diagnostic purposes, but not be otherwise visible.
 *   - `sanitizeError` will ensure that any expected properties already
 *     added by the host are data
 *     properties, converting accessor properties to data properties as needed,
 *     such as `stack` on v8 (Chrome, Brave, Edge?)
 *
 * However, `sanitizeError` will not, for example, `harden`
 * (i.e., deeply freeze)
 * or ensure that the `cause`, `errors`, `error`, or `suppressed` properties
 * satisfy the `Passable` constraints.
 * The purpose of `sanitizeError` is only to protect against
 * mischief the host may have already added to the error as created,
 * not to ensure that the error is actually Passable. For that,
 * see `toPassableError` in `@endo/pass-style`.
 *
 * @param {Error} err
 */
export const sanitizeError = err => {
  const descs = getOwnPropertyDescriptors(err);
  let needNote = false;
  const droppedNote = {};

  for (const name of ownKeys(err)) {
    if (expectedErrorOwnProps[name]) {
      // @ts-expect-error TS still confused by symbols as property names
      const desc = descs[name];
      if (desc && objectHasOwnProperty(desc, 'get')) {
        defineProperty(err, name, {
          value: err[name], // invoke the getter to convert to data property
        });
      }
    } else {
      needNote = true;
      defineProperty(droppedNote, name, {
        value: err[name], // invoke the getter to convert to data property
      });
      delete err[name];
    }
  }
  if (needNote) {
    // eslint-disable-next-line no-use-before-define
    note(
      err,
      redactedDetails`originally with properties ${quote(droppedNote)}`,
    );
  }
};

/**
 * @type {AssertionUtilities['error']}
 */
const makeError = (
  optDetails = redactedDetails`Assert failed`,
  errConstructor = globalThis.Error,
  {
    errorName = undefined,
    sanitize = true,
    options = undefined,
    properties = undefined,

    cause = undefined, // Deprecated. Should be provided in `properties`
    errors = undefined, // Deprecated. Should be provided in `properties`
  } = {},
) => {
  if (typeof optDetails === 'string') {
    // If it is a string, use it as the literal part of the template so
    // it doesn't get quoted.
    optDetails = redactedDetails([optDetails]);
  }
  const hiddenDetails = weakmapGet(hiddenDetailsMap, optDetails);
  if (hiddenDetails === undefined) {
    throw TypeError(`unrecognized details ${quote(optDetails)}`);
  }
  // The messageString is overridden by `message` if provided.
  const messageString = getMessageString(hiddenDetails);

  let err;
  if (
    typeof AggregateError !== 'undefined' &&
    errConstructor === AggregateError
  ) {
    // First arg overridden by `errors` is provided.
    // A `cause` in `options` is overridden by `cause` if provided.
    err = AggregateError([], messageString, options);
  } else if (
    typeof SuppressedError !== 'undefined' &&
    errConstructor === SuppressedError
  ) {
    // First two args overridden by `error` and `suppressed` if provided.
    // Bizarrely, `SuppressedError` has no options argument and therefore
    // no direct way to endow it with a `cause`. Nevertheless,
    // it will be given a `cause` if provided.
    err = SuppressedError(undefined, undefined, messageString);
  } else {
    // A `cause` in `options` is overridden by `cause` if provided.
    err = /** @type {ErrorConstructor} */ (errConstructor)(
      messageString,
      options,
    );
  }
  if (sanitize) {
    sanitizeError(err);
  }

  weakmapSet(hiddenMessageLogArgs, err, getLogArgs(hiddenDetails));
  if (errorName !== undefined) {
    tagError(err, errorName);
  }

  // TODO This silently drops non-enumerable properties. Do we care?
  const props = { ...properties };
  if (cause !== undefined) {
    props.cause = cause;
  }
  if (errors !== undefined) {
    props.errors = errors;
  }
  for (const name of ownKeys(props)) {
    defineProperty(err, name, {
      value: props[name],
    });
  }
  if (sanitize) {
    freeze(err);
  }
  // The next line is a particularly fruitful place to put a breakpoint.
  return err;
};
freeze(makeError);

// /////////////////////////////////////////////////////////////////////////////

const { addLogArgs, takeLogArgsArray } = makeNoteLogArgsArrayKit();

/**
 * @type {WeakMap<Error, NoteCallback[]>}
 *
 * An augmented console will normally only take the hidden noteArgs array once,
 * when it logs the error being annotated. Once that happens, further
 * annotations of that error should go to the console immediately. We arrange
 * that by accepting a note-callback function from the console as an optional
 * part of that taking operation. Normally there will only be at most one
 * callback per error, but that depends on console behavior which we should not
 * assume. We make this an array of callbacks so multiple registrations
 * are independent.
 */
const hiddenNoteCallbackArrays = new WeakMap();

/** @type {AssertionUtilities['note']} */
const note = (error, detailsNote) => {
  if (typeof detailsNote === 'string') {
    // If it is a string, use it as the literal part of the template so
    // it doesn't get quoted.
    detailsNote = redactedDetails([detailsNote]);
  }
  const hiddenDetails = weakmapGet(hiddenDetailsMap, detailsNote);
  if (hiddenDetails === undefined) {
    throw TypeError(`unrecognized details ${quote(detailsNote)}`);
  }
  const logArgs = getLogArgs(hiddenDetails);
  const callbacks = weakmapGet(hiddenNoteCallbackArrays, error);
  if (callbacks !== undefined) {
    for (const callback of callbacks) {
      callback(error, logArgs);
    }
  } else {
    addLogArgs(error, logArgs);
  }
};
freeze(note);

/**
 * The unprivileged form that just uses the de facto `error.stack` property.
 * The start compartment normally has a privileged `globalThis.getStackString`
 * which should be preferred if present.
 *
 * @param {Error} error
 * @returns {string}
 */
const defaultGetStackString = error => {
  if (!('stack' in error)) {
    return '';
  }
  const stackString = `${error.stack}`;
  const pos = stringIndexOf(stackString, '\n');
  if (stringStartsWith(stackString, ' ') || pos === -1) {
    return stackString;
  }
  return stringSlice(stackString, pos + 1); // exclude the initial newline
};

/** @type {LoggedErrorHandler} */
const loggedErrorHandler = {
  getStackString: globalThis.getStackString || defaultGetStackString,
  tagError: error => tagError(error),
  resetErrorTagNum: () => {
    errorTagNum = 0;
  },
  getMessageLogArgs: error => weakmapGet(hiddenMessageLogArgs, error),
  takeMessageLogArgs: error => {
    const result = weakmapGet(hiddenMessageLogArgs, error);
    weakmapDelete(hiddenMessageLogArgs, error);
    return result;
  },
  takeNoteLogArgsArray: (error, callback) => {
    const result = takeLogArgsArray(error);
    if (callback !== undefined) {
      const callbacks = weakmapGet(hiddenNoteCallbackArrays, error);
      if (callbacks) {
        arrayPush(callbacks, callback);
      } else {
        weakmapSet(hiddenNoteCallbackArrays, error, [callback]);
      }
    }
    return result || [];
  },
};
freeze(loggedErrorHandler);
export { loggedErrorHandler };

// /////////////////////////////////////////////////////////////////////////////

/**
 * @type {MakeAssert}
 */
const makeAssert = (optRaise = undefined, unredacted = false) => {
  const details = unredacted ? unredactedDetails : redactedDetails;
  const assertFailedDetails = details`Check failed`;

  /** @type {AssertionFunctions['fail']} */
  const fail = (
    optDetails = assertFailedDetails,
    errConstructor = undefined,
    options = undefined,
  ) => {
    const reason = makeError(optDetails, errConstructor, options);
    if (optRaise !== undefined) {
      // @ts-ignore returns `never` doesn't mean it isn't callable
      optRaise(reason);
    }
    throw reason;
  };
  freeze(fail);

  /** @type {AssertionUtilities['Fail']} */
  const Fail = (template, ...args) => fail(details(template, ...args));

  // Don't freeze or export `baseAssert` until we add methods.
  // TODO If I change this from a `function` function to an arrow
  // function, I seem to get type errors from TypeScript. Why?
  /** @type {BaseAssert} */
  function baseAssert(
    flag,
    optDetails = undefined,
    errConstructor = undefined,
    options = undefined,
  ) {
    flag || fail(optDetails, errConstructor, options);
  }

  /** @type {AssertionFunctions['equal']} */
  const equal = (
    actual,
    expected,
    optDetails = undefined,
    errConstructor = undefined,
    options = undefined,
  ) => {
    is(actual, expected) ||
      fail(
        optDetails || details`Expected ${actual} is same as ${expected}`,
        errConstructor || RangeError,
        options,
      );
  };
  freeze(equal);

  /** @type {AssertionFunctions['typeof']} */
  const assertTypeof = (specimen, typename, optDetails) => {
    // This will safely fall through if typename is not a string,
    // which is what we want.
    // eslint-disable-next-line valid-typeof
    if (typeof specimen === typename) {
      return;
    }
    typeof typename === 'string' || Fail`${quote(typename)} must be a string`;

    if (optDetails === undefined) {
      // Embed the type phrase without quotes.
      const typeWithDeterminer = an(typename);
      optDetails = details`${specimen} must be ${bare(typeWithDeterminer)}`;
    }
    fail(optDetails, TypeError);
  };
  freeze(assertTypeof);

  /** @type {AssertionFunctions['string']} */
  const assertString = (specimen, optDetails = undefined) =>
    assertTypeof(specimen, 'string', optDetails);

  // Note that "assert === baseAssert"
  /** @type {Assert} */
  const assert = assign(baseAssert, {
    error: makeError,
    fail,
    equal,
    typeof: assertTypeof,
    string: assertString,
    note,
    details,
    Fail,
    quote,
    bare,
    makeAssert,
  });
  return freeze(assert);
};
freeze(makeAssert);
export { makeAssert };

/** @type {Assert} */
const assert = makeAssert();
export { assert };

// Internal, to obviate polymorphic dispatch, but may become rigorously
// consistent with @endo/error:

/** @type {AssertionFunctions['equal']} */
const assertEqual = assert.equal;

export {
  assertEqual,
  makeError,
  note as annotateError,
  redactedDetails as X,
  quote as q,
  bare as b,
};
