import { Far } from '@endo/far';
import { assertPetName } from './pet-name.js';
import { makeChangeTopic } from './pubsub.js';
import { makeIteratorRef } from './reader-ref.js';

const { quote: q } = assert;

const validIdPattern = /^[0-9a-f]{128}$/;
const validFormulaPattern =
  /^(?:host|pet-store|(?:readable-blob-sha512|worker-id512|pet-store-id512|eval-id512|import-unsafe-id512|import-bundle-id512|host-id512|guest-id512):[0-9a-f]{128}|web-bundle:[0-9a-f]{32})$/;

/**
 * @param {import('./types.js').DiskPowers} powers
 * @param {string} petNameDirectoryPath
 */
const makePetStoreAtPath = async (powers, petNameDirectoryPath) => {
  /** @type {Map<string, string>} */
  const petNames = new Map();
  /** @type {Map<string, Set<string>>} */
  const formulaIdentifiers = new Map();
  /** @type {import('./types.js').Topic<unknown>} */
  const changesTopic = makeChangeTopic();

  /** @param {string} petName */
  const read = async petName => {
    const petNamePath = powers.joinPath(petNameDirectoryPath, petName);
    const petNameText = await powers.readFileText(petNamePath);
    const formulaIdentifier = petNameText.trim();
    if (!validFormulaPattern.test(formulaIdentifier)) {
      throw new Error(
        `Invalid formula identifier ${q(formulaIdentifier)} for pet name ${q(
          petName,
        )}`,
      );
    }
    return formulaIdentifier;
  };

  await powers.makePath(petNameDirectoryPath);

  const fileNames = await powers.readDirectory(petNameDirectoryPath);
  await Promise.all(
    fileNames.map(async petName => {
      assertPetName(petName);
      const formulaIdentifier = await read(petName);
      petNames.set(petName, formulaIdentifier);
      const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
      if (formulaPetNames !== undefined) {
        formulaPetNames.add(petName);
      } else {
        formulaIdentifiers.set(formulaIdentifier, new Set([petName]));
      }
    }),
  );

  /** @param {string} petName */
  const lookup = petName => {
    assertPetName(petName);
    return petNames.get(petName);
  };

  /**
   * @param {string} petName
   * @param {string} formulaIdentifier
   */
  const write = async (petName, formulaIdentifier) => {
    assertPetName(petName);
    if (!validFormulaPattern.test(formulaIdentifier)) {
      throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
    }

    petNames.set(petName, formulaIdentifier);

    const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
    if (formulaPetNames === undefined) {
      formulaIdentifiers.set(formulaIdentifier, new Set([petName]));
    } else {
      formulaPetNames.add(petName);
    }

    const petNamePath = powers.joinPath(petNameDirectoryPath, petName);
    const petNameText = `${formulaIdentifier}\n`;
    await powers.writeFileText(petNamePath, petNameText);
    changesTopic.publisher.next({ add: petName });
  };

  const list = () => harden([...petNames.keys()].sort());

  const follow = async () =>
    makeIteratorRef(
      (async function* currentAndSubsequentNames() {
        const changes = changesTopic.subscribe();
        for (const name of [...petNames.keys()].sort()) {
          yield { add: name };
        }
        yield* changes;
      })(),
    );

  /**
   * @param {string} petName
   */
  const remove = async petName => {
    assertPetName(petName);
    const formulaIdentifier = petNames.get(petName);
    if (formulaIdentifier === undefined) {
      throw new Error(
        `Formula does not exist for pet name ${JSON.stringify(petName)}`,
      );
    }
    if (!validFormulaPattern.test(formulaIdentifier)) {
      throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
    }

    const petNamePath = powers.joinPath(petNameDirectoryPath, petName);
    await powers.removePath(petNamePath);
    petNames.delete(petName);
    const formulaPetNames = formulaIdentifiers.get(petName);
    if (formulaPetNames !== undefined) {
      formulaPetNames.delete(petName);
    }
    changesTopic.publisher.next({ remove: petName });
    // TODO consider retaining a backlog of deleted names for recovery
    // TODO consider tracking historical pet names for formulas
  };

  /**
   * @param {string} fromName
   * @param {string} toName
   */
  const rename = async (fromName, toName) => {
    assertPetName(fromName);
    assertPetName(toName);
    if (fromName === toName) {
      return;
    }
    const formulaIdentifier = petNames.get(fromName);
    const overwrittenFormulaIdentifier = petNames.get(toName);
    if (formulaIdentifier === undefined) {
      throw new Error(
        `Formula does not exist for pet name ${JSON.stringify(fromName)}`,
      );
    }
    if (!validFormulaPattern.test(formulaIdentifier)) {
      throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
    }
    if (
      overwrittenFormulaIdentifier !== undefined &&
      !validFormulaPattern.test(overwrittenFormulaIdentifier)
    ) {
      throw new Error(
        `Invalid formula identifier ${q(overwrittenFormulaIdentifier)}`,
      );
    }

    const fromPath = powers.joinPath(petNameDirectoryPath, fromName);
    const toPath = powers.joinPath(petNameDirectoryPath, toName);
    await powers.renamePath(fromPath, toPath);
    petNames.set(toName, formulaIdentifier);
    petNames.delete(fromName);

    // Delete the back-reference for the overwritten pet name if it existed.
    if (overwrittenFormulaIdentifier !== undefined) {
      const overwrittenFormulaPetNames = formulaIdentifiers.get(
        overwrittenFormulaIdentifier,
      );
      if (overwrittenFormulaPetNames !== undefined) {
        overwrittenFormulaPetNames.delete(toName);
      }
    }

    // Change the back-reference for the old pet name.
    const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
    if (formulaPetNames !== undefined) {
      formulaPetNames.delete(fromName);
      formulaPetNames.add(toName);
    }

    changesTopic.publisher.next({ add: toName });
    changesTopic.publisher.next({ remove: fromName });
    // TODO consider retaining a backlog of overwritten names for recovery
  };

  /**
   * @param {string} formulaIdentifier
   */
  const reverseLookup = formulaIdentifier => {
    if (!validFormulaPattern.test(formulaIdentifier)) {
      throw new Error(`Invalid formula identifier ${q(formulaIdentifier)}`);
    }
    const formulaPetNames = formulaIdentifiers.get(formulaIdentifier);
    if (formulaPetNames === undefined) {
      return harden([]);
    }
    return harden([...formulaPetNames]);
  };

  return Far('PetStore', {
    lookup,
    reverseLookup,
    list,
    follow,
    write,
    remove,
    rename,
  });
};

/**
 * @param {import('./types.js').DiskPowers} powers
 * @param {import('./types.js').Locator} locator
 * @param {string} id
 */
export const makeIdentifiedPetStore = (powers, locator, id) => {
  if (!validIdPattern.test(id)) {
    throw new Error(`Invalid identifier for pet store ${q(id)}`);
  }
  const prefix = id.slice(0, 2);
  const suffix = id.slice(3);
  const petNameDirectoryPath = powers.joinPath(
    locator.statePath,
    'pet-store-id512',
    prefix,
    suffix,
  );
  return makePetStoreAtPath(powers, petNameDirectoryPath);
};

/**
 * @param {import('./types.js').DiskPowers} powers
 * @param {import('./types.js').Locator} locator
 * @param {string} name
 */
export const makeOwnPetStore = (powers, locator, name) => {
  const petNameDirectoryPath = powers.joinPath(locator.statePath, name);
  return makePetStoreAtPath(powers, petNameDirectoryPath);
};
