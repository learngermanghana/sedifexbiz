import { readFileSync } from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteField,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

const PROJECT_ID = 'sedifexbiz-security-tests';
const STORE_ID = 'store-123';
const OTHER_STORE_ID = 'store-456';

let testEnv: RulesTestEnvironment;

async function seedDocument(collection: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `${collection}/doc`), data);
  });
}

describe('Firestore security rules - store isolation', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(
          new URL('../../firestore.rules', import.meta.url),
          'utf8',
        ),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const userClaims = {
    stores: [STORE_ID],
    roleByStore: {
      [STORE_ID]: 'manager',
    },
  } as const;

  const collections = ['products', 'sales', 'expenses'] as const;

  test.each(collections)('prevents changing storeId on %s update', async (collection) => {
    await seedDocument(collection, { storeId: STORE_ID, name: 'Original' });

    const db = testEnv.authenticatedContext('user', userClaims).firestore();
    const ref = doc(db, `${collection}/doc`);

    await assertFails(
      updateDoc(ref, {
        storeId: OTHER_STORE_ID,
      }),
    );
  });

  test.each(collections)('prevents removing storeId on %s update', async (collection) => {
    await seedDocument(collection, { storeId: STORE_ID, name: 'Original' });

    const db = testEnv.authenticatedContext('user', userClaims).firestore();
    const ref = doc(db, `${collection}/doc`);

    await assertFails(
      updateDoc(ref, {
        storeId: deleteField(),
      }),
    );
  });

  test.each(collections)('allows updating other fields for %s', async (collection) => {
    await seedDocument(collection, { storeId: STORE_ID, name: 'Original' });

    const db = testEnv.authenticatedContext('user', userClaims).firestore();
    const ref = doc(db, `${collection}/doc`);

    await assertSucceeds(
      updateDoc(ref, {
        name: 'Updated',
      }),
    );
  });
});
