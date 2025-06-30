import os
import json
import streamlit as st
import pyrebase
from datetime import datetime
import firebase_admin
import random
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

if st.session_state["logged_in"]:
    st.sidebar.image("https://falowenapp.com/static/logo.png", width=80)  # Optional: your logo
    st.sidebar.markdown(f"👤 **{st.session_state['user_name']}**")
    st.sidebar.markdown("---")
    tab = st.sidebar.radio(
        "Go to...",
        [
            "🏠 Dashboard",
            "📝 Exams Mode & Custom Chat",
            "🧠 Vocab Trainer",
            "✍️ Writing Practice",
            "🧩 Grammar Helper",
            "📈 My Progress"
        ]
    )

if tab == "🏠 Dashboard":
    # ---- HEADER ----
    st.markdown("""
        <h2 style='margin-bottom:0;'>👋 Welcome, {name}!</h2>
        <span style='font-size: 18px; color:#5CB85C;'>Your German practice starts here.</span>
        <hr style='margin-top:10px; margin-bottom:25px;'/>
    """.format(name=st.session_state["user_name"]), unsafe_allow_html=True)

    # ---- XP/LEVEL/PROGRESS ----
    col1, col2, col3 = st.columns([1.2,1,1])
    with col1:
        st.metric("🔥 XP", random.randint(20, 1300))
    with col2:
        st.metric("⭐ Streak", random.randint(1, 15), "days")
    with col3:
        st.metric("🏅 Level", random.randint(1, 6))

    # ---- QUICK ACTIONS / TIPS ----
    st.markdown("""
    ### Quick Start
    - 📝 <b>Practice Exams</b>: Try an exam simulation in “Exams Mode & Custom Chat”.
    - 🧠 <b>Vocabulary</b>: Drill your German vocab in “Vocab Trainer”.
    - 🧩 <b>Grammar</b>: Search & get instant grammar help.
    - 📈 <b>Progress</b>: Track your learning stats.

    <span style='color:#1976D2'>Tip: Practice a little every day for the best results!</span>
    """, unsafe_allow_html=True)

    # ---- Optional: Motivational Section or Badges ----
    st.info("🌟 Keep up your daily streak for bonus XP!")

if tab == "Exams Mode & Custom Chat":
    st.header("🎤 Exams Mode & Custom Chat")

    # ---- Mode Selection ----
    if "exam_stage" not in st.session_state:
        st.session_state["exam_stage"] = 1
        st.session_state["exam_mode"] = None
        st.session_state["exam_level"] = None
        st.session_state["exam_teil"] = None
        st.session_state["exam_messages"] = []

    # Stage 1: Choose mode
    if st.session_state["exam_stage"] == 1:
        st.subheader("Step 1: Choose Practice Mode")
        mode = st.radio(
            "How do you want to practice?",
            ["Goethe Exam Simulation", "Custom Chat with Herr Felix"],
            key="exammode_radio"
        )
        if st.button("Next ➡️", key="exam_next1"):
            st.session_state["exam_mode"] = mode
            st.session_state["exam_stage"] = 2
            st.session_state["exam_level"] = None
            st.session_state["exam_teil"] = None
            st.session_state["exam_messages"] = []
            st.experimental_rerun()
        st.stop()

    # Stage 2: Choose level
    if st.session_state["exam_stage"] == 2:
        st.subheader("Step 2: Select Level")
        level = st.radio("Choose your exam level:", ["A1", "A2", "B1", "B2", "C1"], key="examlevel_radio")
        if st.button("⬅️ Back", key="exam_back1"):
            st.session_state["exam_stage"] = 1
            st.experimental_rerun()
        if st.button("Next ➡️", key="exam_next2"):
            st.session_state["exam_level"] = level
            st.session_state["exam_stage"] = 3
            st.session_state["exam_teil"] = None
            st.session_state["exam_messages"] = []
            st.experimental_rerun()
        st.stop()

    # Stage 3: Choose Teil (exam part)
    if st.session_state["exam_stage"] == 3:
        teil_options = {
            "A1": ["Teil 1 – Introduction", "Teil 2 – Q&A", "Teil 3 – Request"],
            "A2": ["Teil 1 – Questions", "Teil 2 – Speaking", "Teil 3 – Planning"],
            "B1": ["Teil 1 – Planning", "Teil 2 – Presentation", "Teil 3 – Feedback"],
            "B2": ["Teil 1 – Discussion", "Teil 2 – Presentation", "Teil 3 – Argumentation"],
            "C1": ["Teil 1 – Lecture", "Teil 2 – Discussion", "Teil 3 – Evaluation"]
        }
        teil = st.radio("Select Exam Part (Teil):", teil_options[st.session_state["exam_level"]], key="examteil_radio")
        if st.button("⬅️ Back", key="exam_back2"):
            st.session_state["exam_stage"] = 2
            st.experimental_rerun()
        if st.button("Start Practice", key="exam_next3"):
            st.session_state["exam_teil"] = teil
            st.session_state["exam_stage"] = 4
            st.session_state["exam_messages"] = []
            st.experimental_rerun()
        st.stop()

    # Stage 4: Chat Mode (exam or custom)
    if st.session_state["exam_stage"] == 4:
        st.info(f"Level: {st.session_state['exam_level']}  |  Teil: {st.session_state['exam_teil']}")
        st.write("---")

        # Build system prompt based on exam mode & teil
        def build_prompt(level, teil, mode):
            # (Short version; use your full prompt builders as you want)
            if mode == "Goethe Exam Simulation":
                return f"You are Herr Felix, a Goethe {level} examiner. Simulate Teil: {teil} with me. Correct me, give feedback, and guide like a real oral exam."
            else:
                return "You are Herr Felix, a friendly AI German teacher. Help me practice conversation, answer my questions, and give gentle feedback."
        system_prompt = build_prompt(st.session_state["exam_level"], st.session_state["exam_teil"], st.session_state["exam_mode"])

        # Display chat history
        for msg in st.session_state["exam_messages"]:
            role = "assistant" if msg["role"] == "assistant" else "user"
            with st.chat_message(role):
                st.markdown(msg["content"])

        # Chat input
        user_input = st.chat_input("Type your answer (or question)...")
        if user_input:
            st.session_state["exam_messages"].append({"role": "user", "content": user_input})

            # AI response
            with st.chat_message("assistant"):
                with st.spinner("Falowen is thinking..."):
                    try:
                        from openai import OpenAI
                        client = OpenAI()
                        history = [{"role": "system", "content": system_prompt}]
                        history += st.session_state["exam_messages"]
                        resp = client.chat.completions.create(
                            model="gpt-4o",
                            messages=history,
                            temperature=0.25,
                            max_tokens=600,
                        )
                        ai_reply = resp.choices[0].message.content.strip()
                    except Exception as e:
                        ai_reply = f"Sorry, error: {e}"
                st.markdown(ai_reply)
                st.session_state["exam_messages"].append({"role": "assistant", "content": ai_reply})

        # Controls
        col1, col2 = st.columns(2)
        if col1.button("Restart Conversation"):
            for k in ["exam_stage", "exam_mode", "exam_level", "exam_teil", "exam_messages"]:
                if k in st.session_state: del st.session_state[k]
            st.experimental_rerun()
        if col2.button("Back to Teil Selection"):
            st.session_state["exam_stage"] = 3
            st.session_state["exam_messages"] = []
            st.experimental_rerun()
if tab == "Vocab Trainer":
    st.header("📚 Vocab Trainer")

    VOCAB_LIST = GERMAN_VOCAB  # <-- Uses your main vocab dictionary!

    if "vocab_progress" not in st.session_state:
        st.session_state["vocab_progress"] = {"correct": 0, "total": 0}
    if "vocab_idx" not in st.session_state:
        st.session_state["vocab_idx"] = 0

    if st.button("🔄 New Session (Shuffle)"):
        random.shuffle(VOCAB_LIST)
        st.session_state["vocab_idx"] = 0
        st.session_state["vocab_progress"] = {"correct": 0, "total": 0}
        st.experimental_rerun()

    idx = st.session_state["vocab_idx"]
    word = VOCAB_LIST[idx % len(VOCAB_LIST)]

    st.markdown(f"### What is **'{word['de']}'** in English?")
    user_answer = st.text_input("Your answer:", key=f"vocab_{idx}")

    if st.button("Check", key=f"check_{idx}"):
        st.session_state["vocab_progress"]["total"] += 1
        correct = word["en"].strip().lower()
        answer = user_answer.strip().lower()
        if answer == correct:
            st.success("✅ Correct!")
            st.session_state["vocab_progress"]["correct"] += 1
        else:
            st.error(f"❌ Wrong! The correct answer is: **{correct}**")
        st.session_state["vocab_idx"] += 1
        st.experimental_rerun()

    st.info(
        f"Score: {st.session_state['vocab_progress']['correct']} / {st.session_state['vocab_progress']['total']} "
        f" | Word {idx+1} of {len(VOCAB_LIST)}"
    )

    if st.button("Restart Vocab Trainer"):
        st.session_state["vocab_idx"] = 0
        st.session_state["vocab_progress"] = {"correct": 0, "total": 0}
        st.experimental_rerun()

if tab == "Schreiben Trainer":
    st.header("✍️ Schreiben Trainer")

    # Sample writing prompts (customize or randomize as you wish)
    SCHREIBEN_PROMPTS = [
        "Beschreiben Sie Ihren Tagesablauf.",
        "Schreiben Sie über Ihr Lieblingsessen.",
        "Erzählen Sie von einem Ausflug, den Sie gemacht haben.",
        "Schreiben Sie eine E-Mail an einen Freund und laden Sie ihn zu einer Party ein.",
        "Berichten Sie über Ihr letztes Wochenende.",
    ]

    # Save progress in session state
    if "writing_idx" not in st.session_state:
        st.session_state["writing_idx"] = 0
    if "writing_history" not in st.session_state:
        st.session_state["writing_history"] = []

    # Choose a random prompt each session, or go in order
    idx = st.session_state["writing_idx"] % len(SCHREIBEN_PROMPTS)
    prompt = SCHREIBEN_PROMPTS[idx]

    st.markdown(f"### Prompt:\n**{prompt}**")

    # User writes their answer
    user_text = st.text_area("Schreiben Sie Ihre Antwort hier:", key=f"schreiben_{idx}")

    # Optional: Ask for AI feedback (using OpenAI)
    if st.button("Feedback erhalten (AI)"):
        with st.spinner("Falowen is thinking ..."):
            # Simple prompt for OpenAI (can be made smarter!)
            system_prompt = (
                "You are a helpful Goethe German writing coach. "
                "Please give gentle corrections and suggestions in English, and show the improved German text for this writing: "
            )
            try:
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_text}
                    ],
                    temperature=0.15,
                    max_tokens=350
                )
                ai_feedback = response.choices[0].message.content.strip()
                st.markdown("#### Feedback:")
                st.info(ai_feedback)
            except Exception as e:
                st.error(f"Could not get feedback: {e}")

        # Save this writing + feedback to history
        st.session_state["writing_history"].append({"prompt": prompt, "text": user_text, "feedback": ai_feedback})

    if st.button("Next Writing Prompt"):
        st.session_state["writing_idx"] += 1
        st.experimental_rerun()

    # Optional: View writing history
    if st.checkbox("Show my previous writings"):
        for i, item in enumerate(st.session_state["writing_history"], 1):
            st.markdown(f"**{i}. Prompt:** {item['prompt']}")
            st.markdown(f"**Your Text:** {item['text']}")
            st.markdown(f"**AI Feedback:** {item.get('feedback', 'No feedback yet')}")
            st.markdown("---")
if tab == "My Results and Resources":
    st.header("📊 My Results & Resources")

    # ---- Sample progress bar (replace with real stats from Firestore later) ----
    def get_progress(email, level):
        # Placeholder logic - fetch from DB in production!
        vocab_total = 120
        vocab_mastered = 75
        exams_practiced = 10
        writing_attempts = 6
        return vocab_total, vocab_mastered, exams_practiced, writing_attempts

    user_email = st.session_state.get("user_email", "")
    current_level = st.session_state.get("user_row", {}).get("current_level", "A1")
    vocab_total, vocab_mastered, exams_practiced, writing_attempts = get_progress(user_email, current_level)

    st.subheader("Your Progress")
    st.write(f"**Level:** {current_level}")
    st.progress(vocab_mastered / vocab_total if vocab_total else 0)
    st.write(f"Vocabulary Mastered: {vocab_mastered} / {vocab_total}")
    st.write(f"Exams Practiced: {exams_practiced}")
    st.write(f"Writing Tasks Completed: {writing_attempts}")

    # ---- Resource Links ----
    st.subheader("Learning Resources")
    st.markdown("""
    - [Goethe A1 Exam Guide](https://www.goethe.de/projekte/pruefungen/de/a1.html)
    - [Duolingo German Practice](https://www.duolingo.com/course/de/en/Learn-German)
    - [Falowen Vocabulary Sheet](https://your-falowen-vocab-link.com)
    - [German Grammar Explanation](https://mein-deutschbuch.de/grammatik.html)
    """)

    st.info("More resources and personal downloads coming soon!")

    # ---- Option: Download your results (future) ----
    st.button("Download My Progress (PDF)", disabled=True)

if tab == "Grammar Helper":
    st.header("🤖 Grammar Helper")

    st.markdown("""
    _Type a grammar topic, question, or example sentence. Falowen will explain, correct, or give resources!_
    """)

    query = st.text_input(
        "What do you want to know about German grammar?",
        placeholder="e.g. What is the difference between 'sein' and 'haben'?",
        key="grammar_query"
    )

    if query:
        with st.spinner("Falowen is thinking..."):
            # Prompt AI for grammar explanation (OpenAI)
            try:
                ai_response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": (
                            "You are a patient German teacher. Explain any grammar topic, question, or sentence "
                            "at the user's level. If it's a sentence, check for mistakes and explain in simple language. "
                            "Suggest examples, point to external resources if needed, and use simple tables for rules."
                        )},
                        {"role": "user", "content": query}
                    ],
                    temperature=0.15,
                    max_tokens=700,
                )
                response_text = ai_response.choices[0].message.content
            except Exception as e:
                response_text = f"Sorry, something went wrong: {e}"

            st.success(response_text)
    else:
        st.info("Enter any grammar question or paste a sentence for explanation or correction!")

    # Optionally, show a few example queries
    st.markdown("""
    **Try:**
    - "How do I use 'weil' and 'denn'?"
    - "Correct this: Ich habe gegessen Pizza."
    - "German cases explained simply"
    """)

if tab == "Exams Mode & Custom Chat":
    st.header("🎤 Exams Mode & Custom Chat")

    st.markdown("""
    _Practice official Goethe speaking exam parts (A1–C1) or have an open chat on any topic. Your progress is tracked!_
    """)

    # ---- Step 1: Select Practice Mode ----
    if "exam_stage" not in st.session_state:
        st.session_state.exam_stage = 1
    if "exam_mode" not in st.session_state:
        st.session_state.exam_mode = ""
    if "exam_level" not in st.session_state:
        st.session_state.exam_level = ""
    if "exam_teil" not in st.session_state:
        st.session_state.exam_teil = ""
    if "exam_topic" not in st.session_state:
        st.session_state.exam_topic = ""

    if st.session_state.exam_stage == 1:
        mode = st.radio(
            "Choose mode:",
            ["Exams Mode", "Custom Chat"],
            key="exam_mode_radio"
        )
        if st.button("Next", key="exam_mode_next"):
            st.session_state.exam_mode = mode
            st.session_state.exam_stage = 2
            st.experimental_rerun()
        st.stop()

    # ---- Step 2: Select Level ----
    if st.session_state.exam_stage == 2:
        level = st.radio(
            "Select level:",
            ["A1", "A2", "B1", "B2", "C1"],
            key="exam_level_radio"
        )
        if st.button("Back", key="exam_level_back"):
            st.session_state.exam_stage = 1
            st.experimental_rerun()
        if st.button("Next", key="exam_level_next"):
            st.session_state.exam_level = level
            st.session_state.exam_stage = 3
            st.experimental_rerun()
        st.stop()

    # ---- Step 3: Exams Mode: Select Teil and (optional) topic ----
    if st.session_state.exam_stage == 3 and st.session_state.exam_mode == "Exams Mode":
        level = st.session_state.exam_level
        teil_dict = {
            "A1": ["Teil 1 – Basic Introduction", "Teil 2 – Question & Answer", "Teil 3 – Making a Request"],
            "A2": ["Teil 1 – Fragen zu Schlüsselwörtern", "Teil 2 – Über das Thema sprechen", "Teil 3 – Gemeinsam planen"],
            "B1": ["Teil 1 – Gemeinsam planen", "Teil 2 – Präsentation", "Teil 3 – Feedback & Fragen stellen"],
            "B2": ["Teil 1 – Diskussion", "Teil 2 – Präsentation", "Teil 3 – Argumentation"],
            "C1": ["Teil 1 – Vortrag", "Teil 2 – Diskussion", "Teil 3 – Bewertung"],
        }
        teil = st.radio("Choose Exam Part (Teil):", teil_dict[level], key="exam_teil_radio")
        
        # Show random topic button (except A1, which can be random inside logic)
        topic = ""
        topic_lists = {
            "A1": A1_TEIL1 + [x[0] for x in A1_TEIL2] + A1_TEIL3,
            "A2": A2_TEIL1 + A2_TEIL2 + A2_TEIL3,
            "B1": B1_TEIL1 + B1_TEIL2 + B1_TEIL3,
            "B2": b2_teil1_topics + b2_teil2_presentations + b2_teil3_arguments,
            "C1": c1_teil1_lectures + c1_teil2_discussions + c1_teil3_evaluations,
        }
        if level != "A1":
            topic = st.selectbox("Pick a topic (or leave random):", ["(random)"] + topic_lists[level], key="exam_topic_select")
            if topic == "(random)":
                topic = random.choice(topic_lists[level])
        if st.button("Back", key="exam_teil_back"):
            st.session_state.exam_stage = 2
            st.experimental_rerun()
        if st.button("Start Practice", key="exam_teil_next"):
            st.session_state.exam_teil = teil
            st.session_state.exam_topic = topic if topic else ""
            st.session_state.exam_stage = 4
            st.experimental_rerun()
        st.stop()

    # ---- Step 3b: Custom Chat (skip teil/topic selection) ----
    if st.session_state.exam_stage == 3 and st.session_state.exam_mode == "Custom Chat":
        if st.button("Back", key="custom_chat_back"):
            st.session_state.exam_stage = 2
            st.experimental_rerun()
        st.info("Start a conversation on any topic at your chosen level. Just type your first message below!")
        if st.button("Start Chat", key="custom_chat_start"):
            st.session_state.exam_teil = "Custom Chat"
            st.session_state.exam_topic = ""
            st.session_state.exam_stage = 4
            st.experimental_rerun()
        st.stop()

    # ---- Step 4: Main Chat Logic ----
    if st.session_state.exam_stage == 4:
        # Show chosen settings
        st.markdown(f"**Level:** {st.session_state.exam_level}")
        st.markdown(f"**Mode:** {st.session_state.exam_mode}")
        if st.session_state.exam_mode == "Exams Mode":
            st.markdown(f"**Teil:** {st.session_state.exam_teil}")
            if st.session_state.exam_topic:
                st.markdown(f"**Topic:** {st.session_state.exam_topic}")

        # Display chat interface
        if "exam_messages" not in st.session_state:
            st.session_state.exam_messages = []

        for msg in st.session_state.exam_messages:
            if msg["role"] == "assistant":
                st.markdown(f"🧑‍🏫 **Falowen:** {msg['content']}")
            else:
                st.markdown(f"🗣️ {msg['content']}")

        # Prompt builder for each mode/teil/level (keep your previous system prompt logic here!)
        if st.session_state.exam_mode == "Exams Mode":
            prompt = build_exam_system_prompt(
                st.session_state.exam_level, st.session_state.exam_teil
            )
            # Add topic for prompt if needed
            if st.session_state.exam_topic:
                prompt += f" Thema: {st.session_state.exam_topic}."
        else:
            prompt = build_custom_chat_prompt(st.session_state.exam_level)

        # Chat input
        user_input = st.text_input("Type your answer or message...", key="exam_chat_input")
        if user_input:
            st.session_state.exam_messages.append({"role": "user", "content": user_input})
            with st.spinner("Falowen is thinking..."):
                try:
                    ai_resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=[{"role": "system", "content": prompt}]
                                 + [{"role": m["role"], "content": m["content"]} for m in st.session_state.exam_messages],
                        temperature=0.18, max_tokens=600
                    )
                    ai_text = ai_resp.choices[0].message.content
                except Exception as e:
                    ai_text = f"Sorry, error: {e}"
                st.session_state.exam_messages.append({"role": "assistant", "content": ai_text})
                st.experimental_rerun()

        if st.button("Restart Practice", key="exam_restart"):
            for k in ["exam_stage", "exam_mode", "exam_level", "exam_teil", "exam_topic", "exam_messages"]:
                if k in st.session_state:
                    del st.session_state[k]
            st.experimental_rerun()


