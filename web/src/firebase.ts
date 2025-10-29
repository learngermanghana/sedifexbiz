// firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const app = initializeApp(firebaseConfig);

// DEFAULT DB
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true, // <-- key fix
  // useFetchStreams: false,               // leave false if you still see errors
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
  ignoreUndefinedProperties: true,
});

// ROSTER DB
export const rosterDb = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
  ignoreUndefinedProperties: true,
  databaseId: "roster",
});
