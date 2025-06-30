import os
import json
import streamlit as st
import pyrebase
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore

# === Firebase Configs ===
FIREBASE_CONFIG = json.loads(os.getenv("FIREBASE_CONFIG"))
firebase = pyrebase.initialize_app(FIREBASE_CONFIG)
auth = firebase.auth()

if not firebase_admin._apps:
    firebase_credentials = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT"))
    cred = credentials.Certificate(firebase_credentials)
    firebase_admin.initialize_app(cred)
db = firestore.client()

# === Session State Defaults ===
for k, v in {"logged_in": False, "user_row": None, "user_email": "", "user_name": ""}.items():
    if k not in st.session_state:
        st.session_state[k] = v

def create_or_fetch_user(email, name):
    users_ref = db.collection("users")
    # Query by email
    query = users_ref.where("email", "==", email).stream()
    docs = list(query)
    if docs:
        doc = docs[0]
        user_data = doc.to_dict()
        # Update name if changed
        if user_data.get("name") != name:
            users_ref.document(doc.id).update({"name": name})
            user_data["name"] = name
        return user_data
    # Create new
    user_code = email.split("@")[0]
    user_doc = {
        "email": email,
        "name": name,
        "user_code": user_code,
        "joined": datetime.utcnow().isoformat()
    }
    users_ref.document(user_code).set(user_doc)
    return user_doc

# --- Login/Register UI ---
if not st.session_state["logged_in"]:
    st.title("🔐 Welcome to Falowen!")
    menu = st.radio("Choose an option:", ["Login", "Register"])
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")
    if menu == "Register":
        name = st.text_input("Your Name")
        if st.button("Register"):
            try:
                user = auth.create_user_with_email_and_password(email, password)
                user_profile = create_or_fetch_user(email, name)
                st.session_state["user_email"] = email
                st.session_state["user_name"] = name
                st.session_state["user_row"] = user_profile
                st.session_state["logged_in"] = True
                st.success("Registration successful!")
                st.rerun()
            except Exception as e:
                st.error(f"Registration failed: {e}")
    else:
        if st.button("Login"):
            try:
                user = auth.sign_in_with_email_and_password(email, password)
                # Pull name from Firestore (or fallback to email)
                user_profile = create_or_fetch_user(email, user.get("displayName") or email.split("@")[0])
                st.session_state["user_email"] = email
                st.session_state["user_name"] = user_profile["name"]
                st.session_state["user_row"] = user_profile
                st.session_state["logged_in"] = True
                st.success(f"Welcome, {st.session_state['user_name']}!")
                st.rerun()
            except Exception as e:
                st.error("Login failed. Try again or register first.")

    # --- Google Login Button (Professional UI, Info Only) ---
    st.markdown("---")
    col1, col2 = st.columns([1, 8])
    with col1:
        st.image("https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg", width=32)
    with col2:
        if st.button("Sign in with Google (coming soon)"):
            st.info(
                "One-click Google sign-in is coming soon! "
                "For now, please use Email/Password. "
                "Visit [falowenapp.com](https://falowenapp.com) for updates."
            )

    st.markdown("""
    <style>
    .stButton button {background-color:#fff; color:#444; border:1px solid #ccc; border-radius:4px;}
    </style>
    """, unsafe_allow_html=True)
    st.stop()


# =====================
# 7. VOCABULARY DICTIONARIES & EXAM TOPICS
# =====================

# ---- Example vocab for all levels (abbreviated for brevity) ----
a1_vocab = [("Südseite", "south side"), ("3. Stock", "third floor"), ...]
a2_vocab = [("die Verantwortung", "responsibility"), ...]
b1_vocab = ["Fortschritt", "Eindruck", ...]
b2_vocab = ["Umwelt", "Entwicklung", ...]
c1_vocab = ["Ausdruck", "Beziehung", ...]

VOCAB_LISTS = {
    "A1": a1_vocab,
    "A2": a2_vocab,
    "B1": b1_vocab,
    "B2": b2_vocab,
    "C1": c1_vocab
}

# ---- Exam topics as previously provided (abbreviated) ----
A1_TEIL1 = ["Name", "Alter", ...]
A1_TEIL2 = [("Geschäft", "schließen"), ...]
A1_TEIL3 = ["Radio anmachen", ...]
# (Continue for A2, B1, B2, C1...)

EXAM_TOPICS = {
    "A1": {
        "Teil 1": A1_TEIL1,
        "Teil 2": A1_TEIL2,
        "Teil 3": A1_TEIL3,
    },
    # Continue for A2, B1, B2, C1 as above
}

# =====================
# 8. MAIN TAB SELECTOR
# =====================

tab = st.radio(
    "Choose an area to train:",
    [
        "Dashboard",
        "Exams Mode & Custom Chat",
        "Vocab Trainer",
        "Writing Trainer",
        "My Results & Resources",
        "Grammar Helper"
    ],
    key="main_tab_select"
)

# =====
# You can now build each tab (Dashboard, Exams Mode, Vocab, etc.) using this structure.
# =====

if tab == "Dashboard":
    # --- Welcome, show name or fallback ---
    user_name = st.session_state.get("user_name", "") or "Friend"
    st.title(f"👋 Welcome, {user_name}!")

    # --- Level focus (optional: you can remove if you want only one level at a time) ---
    levels = ["A1", "A2", "B1", "B2", "C1"]
    current_level = st.selectbox("Your current focus level:", levels, key="dashboard_level")

    # --- Sample progress fetching (replace with your real data) ---
    def get_progress(user_code, level):
        # Dummy logic – replace with real DB queries
        vocab_total = len(VOCAB_LISTS.get(level, []))
        vocab_mastered = random.randint(0, vocab_total)
        exams_practiced = random.randint(0, 10)
        writing_attempts = random.randint(0, 10)
        return vocab_total, vocab_mastered, exams_practiced, writing_attempts

    code = st.session_state.get("user_code", "")
    vocab_total, vocab_mastered, exams_practiced, writing_attempts = get_progress(code, current_level)

    # --- Dashboard Metrics ---
    col1, col2, col3 = st.columns(3)
    col1.metric("🧠 Vocab Mastered", f"{vocab_mastered} / {vocab_total}")
    col2.metric("🗣️ Speaking Sessions", exams_practiced)
    col3.metric("✍️ Writing Attempts", writing_attempts)

    # --- Progress bar for vocab ---
    st.markdown("#### Vocabulary Progress")
    st.progress(vocab_mastered / vocab_total if vocab_total else 0)

    # --- Motivational Message ---
    if vocab_mastered < vocab_total // 2:
        st.info("🌱 Keep practicing! Every word gets you closer to fluency.")
    elif vocab_mastered < vocab_total:
        st.success("🚀 Great progress! Can you master all the words this week?")
    else:
        st.balloons()
        st.success("🏅 Amazing! You've mastered all the vocabulary at this level.")

    # --- Quick Access Buttons (optional) ---
    st.markdown("#### Quick Start")
    colA, colB, colC = st.columns(3)
    with colA:
        st.button("Start Speaking Practice", key="go_exam_tab")
    with colB:
        st.button("Review Vocab", key="go_vocab_tab")
    with colC:
        st.button("Write Letter", key="go_writing_tab")

    # --- Add more dashboard features: calendar, tips, leaderboard, etc. ---
    st.markdown("---")
    st.write("💡 **Tip:** The more you practice, the more confident you'll be on exam day! Check your progress and jump into any section using the menu above.")

    # (Optional: Announcements, upcoming events, leaderboard...)

if tab == "Exams Mode & Custom Chat":
    st.header("🎤 Exams Mode & Custom Chat")
    st.markdown(
        "Practice for the official Goethe exams in all parts, or chat freely with instant feedback. "
        "Choose your level and exam part, then start your simulation or conversation!"
    )

    # Stage management – initialize state
    default_state = {
        "falowen_stage": 1,
        "falowen_mode": None,
        "falowen_level": None,
        "falowen_teil": None,
        "falowen_messages": [],
        "falowen_turn_count": 0,
        "custom_topic_intro_done": False,
        "custom_chat_level": None,
        "falowen_exam_topic": None,
        "falowen_exam_keyword": None,
    }
    for key, val in default_state.items():
        if key not in st.session_state:
            st.session_state[key] = val

    # Step 1: Practice Mode Selection
    if st.session_state["falowen_stage"] == 1:
        st.subheader("Step 1: Choose Practice Mode")
        mode = st.radio(
            "How would you like to practice?",
            ["Geführte Prüfungssimulation (Exam Mode)", "Eigenes Thema/Frage (Custom Chat)"],
            key="falowen_mode_center"
        )
        if st.button("Next ➡️", key="falowen_next_mode"):
            st.session_state["falowen_mode"] = mode
            st.session_state["falowen_stage"] = 2
            st.session_state["falowen_level"] = None
            st.session_state["falowen_teil"] = None
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # Step 2: Level Selection
    if st.session_state["falowen_stage"] == 2:
        st.subheader("Step 2: Choose Your Level")
        level = st.radio(
            "Select your level:",
            ["A1", "A2", "B1", "B2", "C1"],
            key="falowen_level_center"
        )
        if st.button("⬅️ Back", key="falowen_back1"):
            st.session_state["falowen_stage"] = 1
            st.stop()
        if st.button("Next ➡️", key="falowen_next_level"):
            st.session_state["falowen_level"] = level
            if st.session_state["falowen_mode"] == "Geführte Prüfungssimulation (Exam Mode)":
                st.session_state["falowen_stage"] = 3
            else:
                st.session_state["falowen_stage"] = 4
            st.session_state["falowen_teil"] = None
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # Step 3: Exam Part (for Exam Mode)
    if st.session_state["falowen_stage"] == 3:
        level = st.session_state["falowen_level"]
        teil_options = {
            "A1": ["Teil 1 – Basic Introduction", "Teil 2 – Question and Answer", "Teil 3 – Making A Request"],
            "A2": ["Teil 1 – Fragen zu Schlüsselwörtern", "Teil 2 – Über das Thema sprechen", "Teil 3 – Gemeinsam planen"],
            "B1": ["Teil 1 – Gemeinsam planen (Dialogue)", "Teil 2 – Präsentation (Monologue)", "Teil 3 – Feedback & Fragen stellen"],
            "B2": ["Teil 1 – Diskussion", "Teil 2 – Präsentation", "Teil 3 – Argumentation"],
            "C1": ["Teil 1 – Vortrag", "Teil 2 – Diskussion", "Teil 3 – Bewertung"]
        }
        # build exam_topics list
        exam_topics = []
        if level == "A2":
            exam_topics = A2_TEIL1 + A2_TEIL2 + A2_TEIL3
        elif level == "B1":
            exam_topics = B1_TEIL1 + B1_TEIL2 + B1_TEIL3
        elif level == "B2":
            exam_topics = b2_teil1_topics + b2_teil2_presentations + b2_teil3_arguments
        elif level == "C1":
            exam_topics = c1_teil1_lectures + c1_teil2_discussions + c1_teil3_evaluations

        st.subheader("Step 3: Choose Exam Part")
        teil = st.radio("Which exam part?", teil_options[level], key="falowen_teil_center")

        # optional topic picker (not for A1)
        if level != "A1" and exam_topics:
            picked = st.selectbox("Choose a topic (optional):", ["(random)"] + exam_topics)
            st.session_state["falowen_exam_topic"] = None if picked == "(random)" else picked
        else:
            st.session_state["falowen_exam_topic"] = None

        if st.button("⬅️ Back", key="falowen_back2"):
            st.session_state["falowen_stage"] = 2
            st.stop()
        if st.button("Start Practice", key="falowen_start_practice"):
            st.session_state["falowen_teil"] = teil
            st.session_state["falowen_stage"] = 4
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
            # Optionally: initialize/load deck here
        st.stop()

    # Step 4: MAIN CHAT LOGIC (show the exam/chat interface)
    if st.session_state["falowen_stage"] == 4:
        st.success("You are ready to start your exam practice or custom chat!")
        # Here, add your full chat logic and AI prompt logic as before

        # Example: show first instruction, render chat messages, input, etc.
        if not st.session_state["falowen_messages"]:
            st.info("Begin by introducing yourself or answering the first prompt!")
        for msg in st.session_state["falowen_messages"]:
            if msg["role"] == "assistant":
                st.markdown(f"🧑‍🏫 Herr Felix: {msg['content']}")
            else:
                st.markdown(f"🗣️ {msg['content']}")
        # Chat input
        user_input = st.text_input("Your answer...", key="exam_chat_input")
        if st.button("Send", key="exam_send_btn"):
            if user_input:
                st.session_state["falowen_messages"].append({"role": "user", "content": user_input})
                # Add your AI call here
                # e.g. st.session_state["falowen_messages"].append({"role": "assistant", "content": ai_reply})
                st.experimental_rerun()
    if st.session_state["falowen_stage"] == 4:
        level = st.session_state["falowen_level"]
        teil = st.session_state.get("falowen_teil", "")
        mode = st.session_state["falowen_mode"]

        # System prompt logic: adjust for exam/custom chat
        def build_exam_system_prompt(level, teil):
            # (Insert your exam prompt builder function here; see your old code!)
            # For demo:
            return f"You are a friendly Goethe examiner. Guide the user through {level} {teil} practice."

        def build_custom_chat_prompt(level):
            # (Insert your custom chat prompt builder here; see your old code!)
            return f"You are a supportive German teacher. Practice free chat at {level}."

        is_exam = mode == "Geführte Prüfungssimulation (Exam Mode)"
        is_custom_chat = mode == "Eigenes Thema/Frage (Custom Chat)"

        # Set system prompt
        if is_exam:
            system_prompt = build_exam_system_prompt(level, teil)
        else:
            system_prompt = build_custom_chat_prompt(level)

        # ---- Render Chat History (Duolingo style: colored, bubbles, assistant/user avatars) ----
        for msg in st.session_state["falowen_messages"]:
            if msg["role"] == "assistant":
                with st.chat_message("assistant", avatar="🧑‍🏫"):
                    st.markdown(msg["content"])
            else:
                with st.chat_message("user"):
                    st.markdown(msg["content"])

        # ---- Initial Instruction ----
        if not st.session_state["falowen_messages"]:
            initial_msg = (
                "👋 Welcome to your practice session! Please introduce yourself, or start by answering the first question."
                if is_exam else
                "Hi! 👋 What would you like to talk about? Give me a topic or ask a question."
            )
            st.session_state["falowen_messages"].append({"role": "assistant", "content": initial_msg})
            st.experimental_rerun()

        # ---- Chat Input ----
        user_input = st.chat_input("Type your answer or message here...", key="falowen_chat_input")
        if user_input:
            st.session_state["falowen_messages"].append({"role": "user", "content": user_input})

            # Call GPT/OpenAI
            from openai import OpenAI
            client = OpenAI()  # Only if not initialized already

            with st.chat_message("assistant", avatar="🧑‍🏫"):
                with st.spinner("Herr Felix is replying..."):
                    messages = [{"role": "system", "content": system_prompt}] + st.session_state["falowen_messages"]
                    try:
                        resp = client.chat.completions.create(
                            model="gpt-4o",
                            messages=messages,
                            temperature=0.15,
                            max_tokens=600
                        )
                        ai_reply = resp.choices[0].message.content.strip()
                    except Exception as e:
                        ai_reply = f"Sorry, an error occurred: {e}"
                st.markdown(ai_reply)
                st.session_state["falowen_messages"].append({"role": "assistant", "content": ai_reply})

            st.experimental_rerun()

        # ---- Session Controls (restart, back, change level) ----
        st.divider()
        col1, col2, col3 = st.columns(3)
        with col1:
            if st.button("Restart Practice"): 
                for key in ["falowen_stage", "falowen_messages", "falowen_teil", "falowen_mode"]:
                    st.session_state[key] = None if key == "falowen_teil" else []
                st.session_state["falowen_stage"] = 1
                st.experimental_rerun()
        with col2:
            if st.button("Back"): 
                st.session_state["falowen_stage"] = max(1, st.session_state["falowen_stage"] - 1)
                st.session_state["falowen_messages"] = []
                st.experimental_rerun()
        with col3:
            if st.button("Change Level"):
                st.session_state["falowen_stage"] = 2
                st.session_state["falowen_messages"] = []
                st.experimental_rerun()
if tab == "Vocab Trainer":
    st.header("📚 Vocab Trainer")
    st.markdown(
        "Practice and master German vocabulary by level. "
        "Type the English meaning of each word or phrase to check your understanding."
    )

    # Level selection
    level = st.selectbox("Choose your level:", list(VOCAB_LISTS.keys()), key="vocab_trainer_level")

    # Get vocab list for level
    full_list = VOCAB_LISTS[level]
    words = [w[0] if isinstance(w, tuple) else w for w in full_list]
    translations = {w[0]: w[1] for w in full_list if isinstance(w, tuple)}
    if isinstance(full_list[0], str):  # just in case B1/B2/C1 vocab is str only
        translations = {w: "" for w in full_list}

    # Session state for this tab
    st.session_state.setdefault("vocab_current_idx", None)
    st.session_state.setdefault("vocab_feedback", None)
    st.session_state.setdefault("vocab_done_set", set())

    # "Next word" or pick random unpracticed word
    unpracticed = [i for i in range(len(words)) if words[i] not in st.session_state["vocab_done_set"]]
    if not unpracticed:
        st.success("🎉 You have practiced all words at this level!")
        if st.button("Restart Practice"):
            st.session_state["vocab_done_set"] = set()
            st.session_state["vocab_current_idx"] = None
            st.session_state["vocab_feedback"] = None
        st.stop()

    if st.session_state["vocab_current_idx"] not in unpracticed:
        st.session_state["vocab_current_idx"] = random.choice(unpracticed)

    idx = st.session_state["vocab_current_idx"]
    word = words[idx]
    answer = translations.get(word, "")

    st.subheader(f"Translate: **{word}**")
    with st.form(f"vocab_form_{idx}"):
        user_ans = st.text_input("Your answer (in English):", key=f"ans_{idx}")
        submit = st.form_submit_button("Check")

        if submit:
            cleaned_user = user_ans.strip().lower()
            cleaned_answer = answer.strip().lower()
            if not answer:
                st.session_state["vocab_feedback"] = "No reference answer for this word."
            elif cleaned_user == cleaned_answer:
                st.session_state["vocab_feedback"] = "✅ Correct!"
                st.session_state["vocab_done_set"].add(word)
            elif cleaned_user in cleaned_answer or cleaned_answer in cleaned_user:
                st.session_state["vocab_feedback"] = f"🟡 Almost! The best answer is: **{answer}**"
                st.session_state["vocab_done_set"].add(word)
            else:
                st.session_state["vocab_feedback"] = f"❌ Not correct. The best answer is: **{answer}**"

    if st.session_state["vocab_feedback"]:
        st.info(st.session_state["vocab_feedback"])
        if st.button("Next Word"):
            st.session_state["vocab_feedback"] = None
            st.session_state["vocab_current_idx"] = None

    # Stats bar (Duolingo style)
    total = len(words)
    practiced = len(st.session_state["vocab_done_set"])
    st.progress(practiced / total)
    st.caption(f"Words practiced: {practiced} / {total}")

if tab == "Schreiben Trainer":
    st.header("✍️ Schreiben Trainer (Writing Practice)")
    st.markdown(
        "Write or paste your German letter/essay below. Our AI coach gives instant, exam-style feedback and a score. "
        "Try to hit at least 17/25 for a ‘Pass’. 🚀"
    )

    SCHREIBEN_DAILY_LIMIT = 3  # Change this if you want more/less per day
    level = st.selectbox("Choose level:", ["A1", "A2", "B1", "B2", "C1"], key="schreiben_level")

    # Daily limit tracking (session-based here; for public app, connect to Firebase for real tracking)
    today = str(date.today())
    usage_key = f"schreiben_{level}_{today}"
    if usage_key not in st.session_state:
        st.session_state[usage_key] = 0

    st.info(f"Today: {st.session_state[usage_key]} / {SCHREIBEN_DAILY_LIMIT} used")

    if st.session_state[usage_key] >= SCHREIBEN_DAILY_LIMIT:
        st.warning("You’ve reached your daily practice limit. Please come back tomorrow.")
        st.stop()

    # Letter input
    text = st.text_area(
        "Paste or write your German letter/essay here:",
        key="schreiben_input",
        height=180,
        placeholder="Schreibe deinen Brief oder Aufsatz hier…"
    )

    # AI Feedback Prompt
    ai_prompt = (
        f"You are Herr Felix, a supportive German writing examiner. The user submitted a {level} letter or essay. "
        "Give clear, exam-style feedback in English: what’s good, what to improve, highlight mistakes. "
        "Assign a score out of 25. If the score is 17 or higher, finish with '**Passed: You may submit to your tutor!**'. "
        "If the score is 16 or less, finish with '**Keep improving before you submit.**'. "
        "Highlight the phrases with errors, and give quick, actionable tips for better German writing."
        "DO NOT rewrite the entire letter for the user."
    )

    feedback = ""
    if st.button("Get Feedback", type="primary") and text.strip():
        with st.spinner("Herr Felix is marking..."):
            try:
                completion = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": ai_prompt},
                        {"role": "user", "content": text},
                    ],
                    temperature=0.4,
                )
                feedback = completion.choices[0].message.content
            except Exception as e:
                feedback = f"AI feedback failed: {e}"
        # Save usage (for now, session only)
        st.session_state[usage_key] += 1

        # Extract score and pass/fail
        import re
        score_match = re.search(r"(\d{1,2})\s*/\s*25", feedback)
        score = int(score_match.group(1)) if score_match else 0

        st.markdown("---")
        st.markdown("#### 📝 Feedback from Herr Felix")
        st.markdown(feedback)

        if score >= 17:
            st.success("✅ Passed! Submit to your tutor if you wish.")
        else:
            st.info("Keep improving before you submit. Review the tips above!")

        # Download as PDF (optional)
        from fpdf import FPDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        pdf.multi_cell(0, 10, f"Your Letter:\n\n{text}\n\nFeedback from Herr Felix:\n\n{feedback}")
        pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
        st.download_button(
            "⬇️ Download Feedback as PDF",
            pdf_bytes,
            file_name=f"Feedback_{level}_{today}.pdf",
            mime="application/pdf"
        )
if tab == "My Results and Resources":
    st.header("📈 My Results and Resources Hub")
    st.markdown("Review your practice history and download your feedback for future reference. All your results are private.")

    # For a public app, store results in Firebase. Here’s a session-based example for demo:
    # Replace this with your real DB call in production!

    # DEMO: Pull results from session (simulate DB)
    if "practice_history" not in st.session_state:
        st.session_state["practice_history"] = []

    # (In your practice tabs, after feedback, append results like this:)
    # st.session_state["practice_history"].append({
    #     "level": level,
    #     "type": "Schreiben",  # or "Vocab", etc.
    #     "input": text,
    #     "feedback": feedback,
    #     "score": score,
    #     "date": str(date.today())
    # })

    history = st.session_state["practice_history"]

    if not history:
        st.info("No results yet. Start practicing to see your progress!")
        st.stop()

    # Show filter options
    df = pd.DataFrame(history)
    level_options = df['level'].unique().tolist()
    typ_options = df['type'].unique().tolist()
    level = st.selectbox("Level:", ["All"] + level_options)
    typ = st.selectbox("Practice Type:", ["All"] + typ_options)

    filtered = df.copy()
    if level != "All":
        filtered = filtered[filtered['level'] == level]
    if typ != "All":
        filtered = filtered[filtered['type'] == typ]

    st.subheader("Practice History")
    st.dataframe(filtered[["date", "level", "type", "score", "input", "feedback"]].sort_values(by="date", ascending=False), use_container_width=True)

    # Download as CSV
    csv = filtered.to_csv(index=False).encode("utf-8")
    st.download_button("Download as CSV", csv, file_name="practice_history.csv")

    # Download as PDF
    from fpdf import FPDF
    if st.button("Download as PDF"):
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=10)
        pdf.cell(0, 8, "Practice History", ln=1)
        pdf.ln(2)
        for _, row in filtered.iterrows():
            pdf.cell(0, 8, f"Date: {row['date']} | Level: {row['level']} | Type: {row['type']}", ln=1)
            pdf.multi_cell(0, 7, f"Input: {row['input']}\nScore: {row['score']}\nFeedback: {row['feedback']}\n")
            pdf.ln(2)
        pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
        st.download_button(
            label="Download PDF",
            data=pdf_bytes,
            file_name="practice_history.pdf",
            mime="application/pdf"
        )
if tab == "Grammar Helper":
    st.markdown("""
        <style>
            .grammar-card {
                background: #f8fff4;
                border-radius: 18px;
                box-shadow: 0 2px 8px #b4e1c5;
                padding: 18px 22px 14px 22px;
                margin-bottom: 18px;
            }
            .grammar-title {
                font-size: 20px;
                font-weight: 700;
                color: #1dbf73;
                margin-bottom: 3px;
            }
        </style>
    """, unsafe_allow_html=True)

    st.header("🧩 Grammar Helper")
    st.markdown(
        "🔍 *Ask about any German grammar rule, word, or concept!*\n\n"
        "💡 If it’s not in our quick-list, Falowen AI will explain it with examples."
    )

    GRAMMAR_TOPICS = [
        {"level": "A1", "keyword": "Perfekt", "title": "Perfekt (Present Perfect)", "explanation": "Perfekt is used for things that happened in the past. *Ich habe gegessen* (I have eaten)."},
        {"level": "A1", "keyword": "weil", "title": "weil (because)", "explanation": "‘weil’ means because and sends the verb to the end: *Ich bleibe zu Hause, weil es regnet.*"},
        {"level": "A2", "keyword": "dass", "title": "dass (that)", "explanation": "Introduces a clause with the verb at the end: *Ich weiß, dass du müde bist.*"},
        {"level": "B1", "keyword": "Relativsatz", "title": "Relativsatz (Relative Clause)", "explanation": "Adds extra info: *Das ist der Mann, der hier arbeitet.*"},
        {"level": "B2", "keyword": "Konjunktiv II", "title": "Konjunktiv II", "explanation": "For wishes or unreal things: *Ich wünschte, ich hätte mehr Zeit.*"},
        {"level": "C1", "keyword": "Nominalisierung", "title": "Nominalisierung (Nominalization)", "explanation": "Change verbs/adjectives to nouns: *lernen → das Lernen*."},
    ]

    query = st.text_input("🔎 Enter any grammar topic/question:", key="grammar_query").strip().lower()
    level_filter = st.selectbox("Level", ["All", "A1", "A2", "B1", "B2", "C1"], key="grammar_level")

    found = []
    if query or level_filter != "All":
        found = [
            g for g in GRAMMAR_TOPICS
            if (query in g["keyword"].lower() or query in g["title"].lower() or query in g["explanation"].lower())
            and (level_filter == "All" or g["level"] == level_filter)
        ]

    if query:
        if found:
            for topic in found:
                st.markdown(f"""
                    <div class="grammar-card">
                        <div class="grammar-title">📘 {topic['title']} <span style='font-size:0.7em;'>[{topic['level']}]</span></div>
                        <div>{topic['explanation']}</div>
                    </div>
                """, unsafe_allow_html=True)
        else:
            # AI to the rescue!
            with st.spinner("🦉 Falowen is thinking..."):
                ai_prompt = (
                    "You are a friendly German language teacher. Give a simple, clear, student-level explanation of this grammar topic, with one easy example. "
                    "Topic/question: " + query +
                    " Explain in plain English, then give a sample German sentence with English translation."
                )
                try:
                    ai_resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=[{"role": "system", "content": ai_prompt}],
                        max_tokens=300,
                        temperature=0.2,
                    )
                    reply = ai_resp.choices[0].message.content.strip()
                except Exception as e:
                    reply = f"Sorry, an error occurred: {e}"

                st.markdown(f"""
                    <div class="grammar-card">
                        <div class="grammar-title">🤖 {query.title()}</div>
                        <div>{reply}</div>
                    </div>
                """, unsafe_allow_html=True)
    else:
        st.info("Try keywords like *weil*, *Perfekt*, or *Konjunktiv II*—or just ask any grammar question!")

    with st.expander("📋 See All Topics"):
        for topic in GRAMMAR_TOPICS:
            st.markdown(f"""
                <div class="grammar-card">
                    <div class="grammar-title">📗 {topic['title']} <span style='font-size:0.8em;'>[{topic['level']}]</span></div>
                    <div>{topic['explanation']}</div>
                </div>
            """, unsafe_allow_html=True)

