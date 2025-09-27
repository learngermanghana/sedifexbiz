// web/src/controllers/storeController.ts
import { getAuth } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';

type ContactPayload = {
  phone?: string | null;
  firstSignupEmail?: string | null;
};

type CreateMyFirstStoreOptions = {
  contact: ContactPayload;
};

export async function createMyFirstStore(options: CreateMyFirstStoreOptions) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const storeId = user.uid;
  const contact = options.contact ?? {};
  const ownerPhone = contact.phone ?? null;
  const firstSignupEmail = contact.firstSignupEmail ?? user.email ?? null;

  const storeRef = doc(db, 'stores', storeId);
  const existingStore = await getDoc(storeRef);

  const storePayload: Record<string, unknown> = {
    storeId,
    ownerId: user.uid,
    ownerEmail: user.email ?? null,
    updatedAt: serverTimestamp(),
  };

  if (ownerPhone !== undefined) {
    storePayload.ownerPhone = ownerPhone;
  }

  const currentFirstSignupEmail = existingStore.exists() ? existingStore.data()?.firstSignupEmail : undefined;
  if (!currentFirstSignupEmail && firstSignupEmail !== undefined) {
    storePayload.firstSignupEmail = firstSignupEmail;
  }

  if (!existingStore.exists()) {
    storePayload.createdAt = serverTimestamp();
  }

  // 1) Create the store (id == uid)
  await setDoc(storeRef, storePayload, { merge: true });

  const ownerMetadata = {
    storeId,
    uid: user.uid,
    role: 'owner',
    email: user.email ?? null,
    phone: ownerPhone,
    firstSignupEmail,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 2) Create the owner membership (members/{uid})
  await setDoc(doc(db, 'stores', storeId, 'members', user.uid), ownerMetadata, { merge: true });

  // 3) Store owner lookup (storeUsers/{storeId}_{uid})
  await setDoc(doc(db, 'storeUsers', `${storeId}_${user.uid}`), ownerMetadata, { merge: true });

  // 4) Ensure backend initialization + refreshed claims
  const initializeStore = httpsCallable(functions, 'initializeStore');
  await initializeStore({
    contact: {
      phone: ownerPhone,
      firstSignupEmail,
    },
  });

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
