// web/src/controllers/storeController.ts
import { getAuth } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';

type ContactPayload = {
  phone?: string | null;
  firstSignupEmail?: string | null;
};

type CreateMyFirstStoreOptions = {
  storeCode: string;
  contact: ContactPayload;
};

export async function createMyFirstStore(options: CreateMyFirstStoreOptions) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const rawStoreCode = options.storeCode?.trim().toUpperCase();
  if (!rawStoreCode) {
    throw new Error('Enter a store code before continuing.');
  }
  if (!/^[A-Z]{6}$/.test(rawStoreCode)) {
    throw new Error('Store code must be six letters.');
  }

  const storeId = rawStoreCode;
  const contact = options.contact ?? {};
  const ownerPhone = contact.phone ?? null;
  const firstSignupEmail = contact.firstSignupEmail ?? user.email ?? null;

  const ownerMetadata = {
    storeId,
    uid: user.uid,
    role: 'owner',
    email: user.email ?? null,
    phone: ownerPhone,
    firstSignupEmail,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    updatedAt: serverTimestamp(),
  };

  const initializeStore = httpsCallable(functions, 'initializeStore');
  try {
    await initializeStore({
      storeCode: storeId,
      contact: {
        phone: ownerPhone,
        firstSignupEmail,
      },
    });
  } catch (error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'functions/already-exists') {
      throw new Error('That store code is already taken. Try another one.');
    }
    throw error;
  }

  // After the callable succeeds the membership exists, so local writes comply with rules.

  // 1) Ensure owner membership metadata is up to date (members/{uid})
  await setDoc(doc(db, 'stores', storeId, 'members', user.uid), ownerMetadata, { merge: true });

  // 2) Store owner lookup (storeUsers/{storeId}_{uid})
  await setDoc(doc(db, 'storeUsers', `${storeId}_${user.uid}`), ownerMetadata, { merge: true });

  // Optional: if any legacy code still checks custom claims, refresh token
  await user.getIdToken(true);
}

type ManageStaffAccountPayload = {
  storeId: string;
  email: string;
  role: string;
  password?: string;
};

type ManageStaffAccountResult = {
  ok: boolean;
  storeId: string;
  role: string;
  email: string;
  uid: string;
  created: boolean;
  claims?: unknown;
};

export async function manageStaffAccount(payload: ManageStaffAccountPayload) {
  const callable = httpsCallable<ManageStaffAccountPayload, ManageStaffAccountResult>(
    functions,
    'manageStaffAccount',
  );
  const response = await callable(payload);
  return response.data;
}
