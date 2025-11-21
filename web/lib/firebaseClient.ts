import { initializeApp, getApps, getApp } from "firebase/app";
import { firebaseEnv } from "../path/to/firebaseEnv"; // the file you showed

const appConfig = {
  apiKey: firebaseEnv.apiKey,
  authDomain: firebaseEnv.authDomain,
  projectId: firebaseEnv.projectId,
  storageBucket: firebaseEnv.storageBucket,
  appId: firebaseEnv.appId,
};

export const firebaseApp =
  getApps().length ? getApp() : initializeApp(appConfig);
