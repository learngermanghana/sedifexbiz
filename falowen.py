<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0ea5e9" />
  <title>Falowen</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:#0b1220; --bg2:#0e172a; --card:rgba(255,255,255,0.08); --card-opaque:#ffffff;
      --text:#0f172a; --muted:#6b7280; --border:rgba(255,255,255,0.14);
      --primary:#0ea5e9; --accent:#6366f1; --shadow:0 10px 30px rgba(2,132,199,0.18), 0 2px 10px rgba(0,0,0,0.2);
    }
    @media (prefers-color-scheme: light) {
      :root { --bg:#f6f8fb; --bg2:#eef2ff; --card:#ffffff; --card-opaque:#ffffff; --text:#0f172a; --muted:#64748b; --border:rgba(15,23,42,0.08); --shadow:0 12px 30px rgba(2,132,199,0.10), 0 2px 8px rgba(2,6,23,0.06); }
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";
      color:var(--text);
      background:
        radial-gradient(1200px 1200px at -10% -10%, var(--bg2) 0%, transparent 40%),
        radial-gradient(1000px 1000px at 110% 10%, rgba(99,102,241,0.25) 0%, transparent 40%),
        linear-gradient(180deg, var(--bg) 0%, #0b1324 100%);
      -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    }
    .decorations::before,.decorations::after{
      content:"";position:fixed;inset:auto auto 10% -120px;width:380px;height:380px;
      background:radial-gradient(circle at 30% 30%, rgba(14,165,233,0.45), transparent 60%),
                 radial-gradient(circle at 70% 70%, rgba(99,102,241,0.45), transparent 60%);
      filter:blur(60px);transform:rotate(12deg);z-index:0;pointer-events:none;
    }
    .decorations::after{
      inset:8% -120px auto auto;transform:rotate(-8deg);
      background:radial-gradient(circle at 30% 30%, rgba(99,102,241,0.35), transparent 60%),
                 radial-gradient(circle at 70% 70%, rgba(14,165,233,0.35), transparent 60%);
    }
    .shell{position:relative;max-width:1120px;margin:48px auto;padding:0 24px;z-index:1}
    .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
    .brand{display:flex;align-items:center;gap:12px}
    .badge{width:36px;height:36px;display:grid;place-items:center;background:conic-gradient(from 90deg,var(--primary),var(--accent));color:white;border-radius:10px;box-shadow:var(--shadow);font-weight:800;letter-spacing:.5px}
    .brand h1{margin:0;font-size:1.45rem;font-weight:800;background:linear-gradient(90deg,var(--primary),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
    /* Single-column grid (login removed) */
    .grid{display:grid;grid-template-columns:1fr;gap:28px}
    @media (max-width:600px){ .shell{margin:32px auto;padding:0 16px} .grid{gap:20px} .hero.card{padding:22px} .hero h2{font-size:1.75rem} }
    @media (max-width:480px){ .shell{margin:24px auto;padding:0 12px} .header{flex-direction:column;align-items:flex-start;gap:12px} .brand h1{font-size:1.25rem} .hero h2{font-size:1.5rem} }
    .card{background:var(--card);backdrop-filter:saturate(140%) blur(10px);-webkit-backdrop-filter:saturate(140%) blur(10px);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow)}
    .hero.card{padding:28px}
    .hero h2{margin:0 0 8px;font-size:2rem;color:#0ea5e9;letter-spacing:-.02em}
    .hero p{margin:0;color:var(--muted);line-height:1.65}
    .cta{margin-top:14px;color:var(--muted);font-weight:600}
    .features{margin-top:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
    .feature{padding:16px;background:var(--card-opaque);border:1px solid var(--border);border-radius:14px;transition:transform .2s ease,box-shadow .2s ease}
    .feature:hover{transform:translateY(-3px);box-shadow:0 10px 20px rgba(2,6,23,0.08)}
    .feature h3{margin:6px 0 6px;font-size:1rem}
    .feature p{margin:0;color:var(--muted);font-size:.95rem;line-height:1.55}
    .icon{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:linear-gradient(135deg,var(--primary),var(--accent));color:white;box-shadow:0 6px 14px rgba(14,165,233,0.32)}
    .stats{margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
    .stat{background:var(--card-opaque);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center}
    .stat strong{display:block;font-size:1.35rem;letter-spacing:-.02em}
    .stat span{color:var(--muted);font-size:.92rem}
    /* Animations */
    [data-animate]{opacity:0;transform:translateY(10px);animation:fadeUp .6s ease forwards}
    [data-animate="2"]{animation-delay:.05s}[data-animate="3"]{animation-delay:.1s}[data-animate="4"]{animation-delay:.15s}[data-animate="5"]{animation-delay:.2s}
    @keyframes fadeUp{to{opacity:1;transform:translateY(0)}}
  </style>
</head>
<body>
  <div class="decorations" aria-hidden="true"></div>
  <div class="shell">
    <header class="header">
      <div class="brand">
        <div class="badge">F</div>
        <h1>Falowen</h1>
      </div>
      <div style="font-weight:600; color: var(--muted);">Learn Language Education Academy</div>
    </header>

    <div class="grid">
      <section class="hero card" data-animate>
        <h2>Welcome to Falowen</h2>
        <p>Falowen is an all-in-one German learning platform with courses from A1 to C1, live tutor support, and tools that keep you on track.</p>
        <p class="cta">👇 Scroll to sign in or create your account.</p>

        <div class="features">
          <div class="feature" data-animate="2">
            <div class="icon" aria-hidden="true">📊</div>
            <h3>Dashboard</h3>
            <p>Track streaks, assignment progress, and active contracts at a glance.</p>
          </div>
          <div class="feature" data-animate="3">
            <div class="icon" aria-hidden="true">📘</div>
            <h3>Course Book</h3>
            <p>Lecture videos, grammar modules, and assignment submissions A1–C1.</p>
          </div>
          <div class="feature" data-animate="4">
            <div class="icon" aria-hidden="true">📝</div>
            <h3>Exams & Quizzes</h3>
            <p>Practice tests and official exam prep—right in the app.</p>
          </div>
          <div class="feature" data-animate="5">
            <div class="icon" aria-hidden="true">📓</div>
            <h3>Journal</h3>
            <p>Submit A1–C1 writing for free feedback from your tutors.</p>
          </div>
          <div class="feature" data-animate="5">
            <div class="icon" aria-hidden="true">🏅</div>
            <h3>Results Tab</h3>
            <p>See your performance history and celebrate improvements.</p>
          </div>
          <div class="feature" data-animate="5">
            <div class="icon" aria-hidden="true">🔤</div>
            <h3>Vocabulary Trainer</h3>
            <p>Spaced repetition quizzes and custom lists that grow with you.</p>
          </div>
        </div>

        <div class="stats">
          <div class="stat" data-animate="2"><strong>300+</strong><span>Active learners</span></div>
          <div class="stat" data-animate="3"><strong>1,200+</strong><span>Assignments submitted</span></div>
          <div class="stat" data-animate="4"><strong>4.5★</strong><span>Avg. tutor feedback</span></div>
          <div class="stat" data-animate="5"><strong>100%</strong><span>Course coverage</span></div>
        </div>
      </section>
    </div>
  </div>
</body>
</html>
