import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

export default function App() {
  const [userEmail, setUserEmail] = useState("");
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const sub = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.data.subscription.unsubscribe();
  }, []);

  const login = async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: userEmail });
    if (error) alert(error.message);
    else alert("Check your email for the magic link");
  };

  const logout = async () => { await supabase.auth.signOut(); };

  return (
    <div style={{ padding: 24 }}>
      <h1>Sedifex Auth Test</h1>
      {user ? (
        <>
          <p>Signed in as: {user.email}</p>
          <button onClick={logout}>Sign out</button>
        </>
      ) : (
        <>
          <input
            placeholder="you@example.com"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
          />
          <button onClick={login}>Send magic link</button>
        </>
      )}
    </div>
  );
}
