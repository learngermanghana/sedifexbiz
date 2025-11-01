// web/src/firebaseClient.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// TODO: fill these from Firebase Console → Project settings → Your apps (Web)
const firebaseConfig = {
  apiKey: "AIzaSyDwqED5PminaTUDRAquyFMhSA6vroj1Ccw",
  authDomain: "sedifex-ac2b0.firebaseapp.com",
  projectId: "sedifex-ac2b0",
  storageBucket: "sedifex-ac2b0.appspot.com",
  messagingSenderId: "G-3V9RHWEWNT",
  appId: "1:519571382805:web:d0f4653d62a71dfa58a41c",
};

const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");

// Call this before any Firestore/Functions use
export async function ensureSignedIn(): Promise<void> {
  if (auth.currentUser) return;
  await new Promise<void>((res) => {
    const unsub = onAuthStateChanged(auth, () => { unsub(); res(); });
  });
  if (!auth.currentUser) await signInWithPopup(auth, new GoogleAuthProvider());
}
