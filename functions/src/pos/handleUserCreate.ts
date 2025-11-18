import * as functions from "firebase-functions/v1";
export const handleUserCreate = functions.auth.user().onCreate(async (user) => {
  console.log("handleUserCreate placeholder fired for", user.uid);
});
