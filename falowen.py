# =========================
# 1. IMPORTS & CORE SETUP
# =========================

import os
import json
from datetime import datetime
import random
import difflib
import pandas as pd
import streamlit as st
import requests
import io
import urllib.parse

from openai import OpenAI
from fpdf import FPDF
from st_cookies_manager import EncryptedCookieManager

import firebase_admin
from firebase_admin import credentials, firestore
import pyrebase

# =========================
# 2. FIREBASE & OPENAI INITIALIZATION
# =========================

# ---- Pyrebase config (for Authentication) ----
FIREBASE_CONFIG = json.loads(os.getenv("FIREBASE_CONFIG"))
firebase = pyrebase.initialize_app(FIREBASE_CONFIG)
auth = firebase.auth()

# ---- Firebase Admin SDK (for Firestore DB) ----
if not firebase_admin._apps:
    firebase_credentials = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT"))
    cred = credentials.Certificate(firebase_credentials)
    firebase_admin.initialize_app(cred)
db = firestore.client()

# ---- OpenAI Setup ----
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or st.secrets.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    st.error("Missing OpenAI API key.")
    st.stop()
os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
client = OpenAI()

# ---- Cookie Manager for login persistence ----
COOKIE_SECRET = os.getenv("COOKIE_SECRET") or st.secrets.get("COOKIE_SECRET")
if not COOKIE_SECRET:
    st.error("COOKIE_SECRET environment variable not set!")
    st.stop()
cookie_manager = EncryptedCookieManager(prefix="falowen_", password=COOKIE_SECRET)
cookie_manager.ready()

# =========================
# 3. SESSION DEFAULTS & LOGIN/REGISTER UI
# =========================

for k, v in {
    "logged_in": False,
    "user_row": None,
    "user_email": "",
    "user_name": "",
    "pro_user": False,
    "user_google_id": "",
}.items():
    if k not in st.session_state:
        st.session_state[k] = v

def create_or_fetch_user(email, name, google_id=None):
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
        if google_id and user_data.get("google_id") != google_id:
            users_ref.document(doc.id).update({"google_id": google_id})
            user_data["google_id"] = google_id
        return user_data
    # Create new
    user_code = email.split("@")[0]
    user_doc = {
        "email": email,
        "name": name,
        "user_code": user_code,
        "joined": datetime.utcnow().isoformat(),
    }
    if google_id:
        user_doc["google_id"] = google_id
    users_ref.document(user_code).set(user_doc)
    return user_doc

# --- Login/Register UI (with email, password) ---
if not st.session_state["logged_in"]:
    st.title("🔐 Welcome to Falowen!")
    menu = st.radio("Choose an option:", ["Login", "Register"])
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")

    # --- Google Login Button ---
    # You can add a Google sign-in button here using an external OAuth package for Streamlit
    # For now, just placeholder
    st.markdown("---")
    st.info("Coming soon: Google Login (Sign in with Google for instant access)")

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
    st.stop()

# -- End of base code --

# ========= MY VOCAB HELPERS (Firestore) =========

def add_my_vocab(user_code, level, word, translation):
    """
    Save a word for the user/level in Firestore.
    Each entry: {user_code, level, word, translation, date}
    """
    doc_id = f"{user_code}_{level}_{word}_{int(datetime.utcnow().timestamp())}"
    db.collection("my_vocab").document(doc_id).set({
        "user_code": user_code,
        "level": level,
        "word": word,
        "translation": translation,
        "date": datetime.utcnow().strftime("%Y-%m-%d")
    })

def get_my_vocab(user_code, level):
    """
    Returns list of [doc_id, word, translation, date] for the user/level.
    """
    docs = db.collection("my_vocab") \
        .where("user_code", "==", user_code) \
        .where("level", "==", level).stream()
    rows = []
    for doc in docs:
        d = doc.to_dict()
        rows.append([doc.id, d.get("word", ""), d.get("translation", ""), d.get("date", "")])
    # Sort by most recent
    rows.sort(key=lambda x: x[3], reverse=True)
    return rows

def delete_my_vocab(doc_id, user_code):
    """
    Delete a vocab entry by its Firestore doc_id and user_code.
    """
    # (user_code check optional—security on server side!)
    db.collection("my_vocab").document(doc_id).delete()
# ========= VOCAB PRACTICE PROGRESS HELPERS (Firestore) =========

def save_vocab_submission(user_code, user_name, level, word, answer, is_correct):
    """
    Records each vocab submission attempt.
    Fields: user_code, user_name, level, word, answer, is_correct, date
    """
    doc_id = f"{user_code}_{level}_{word}_{int(datetime.utcnow().timestamp())}"
    db.collection("vocab_progress").document(doc_id).set({
        "user_code": user_code,
        "user_name": user_name,
        "level": level,
        "word": word,
        "answer": answer,
        "is_correct": bool(is_correct),
        "date": datetime.utcnow().strftime("%Y-%m-%d")
    })

def get_personal_vocab_stats(user_code):
    """
    Returns a dict: {level: number of personal vocab words}
    """
    result = {}
    for level in ["A1", "A2", "B1", "B2", "C1"]:
        docs = db.collection("my_vocab") \
            .where("user_code", "==", user_code) \
            .where("level", "==", level).stream()
        result[level] = sum(1 for _ in docs)
    return result

def get_progress(user_code, level):
    """
    Returns stats: vocab_total, vocab_mastered, exams_practiced, writing_attempts.
    - vocab_total: total words in level (from VOCAB_LISTS)
    - vocab_mastered: words user got correct (is_correct=True)
    - exams_practiced, writing_attempts: set to 0 for now (or implement as needed)
    """
    # Example only; tune as needed!
    vocab_total = len(VOCAB_LISTS.get(level, []))
    vocab_mastered = 0
    docs = db.collection("vocab_progress") \
        .where("user_code", "==", user_code) \
        .where("level", "==", level) \
        .where("is_correct", "==", True).stream()
    practiced_words = set()
    for doc in docs:
        practiced_words.add(doc.to_dict()["word"])
    vocab_mastered = len(practiced_words)
    exams_practiced = 0  # Placeholder for your logic
    writing_attempts = 0  # Placeholder for your logic
    return vocab_total, vocab_mastered, exams_practiced, writing_attempts

# =========================
# 4. MAIN TAB SELECTOR & FREE PREVIEW LOGIC
# =========================

# --------- Free Preview/Trial Control ----------
MAX_FREE_TRIAL = 3  # e.g., let non-logged-in users try 3 actions per tab

def trial_too_many(key):
    """Check if the trial limit has been exceeded for a section."""
    count = st.session_state.get(f"trial_{key}", 0)
    return count >= MAX_FREE_TRIAL

def increment_trial(key):
    k = f"trial_{key}"
    st.session_state[k] = st.session_state.get(k, 0) + 1

def trial_warning(tab_key):
    st.warning(
        f"You've reached your free trial limit for this section. "
        f"Please **register or log in** to unlock unlimited access! 🚀"
    )
    st.stop()

# --------- Main Tab Selector ----------
tab = st.radio(
    "How do you want to practice?",
    [
        "Dashboard",
        "Vocab Trainer",
        "Schreiben Trainer",
        "Exams Mode & Custom Chat",
        "Grammar Helper (A.I. Search)"
    ],
    key="main_tab_select"
)

# --------- Tab Logic with Trial Preview ---------
# We'll show a **trial preview** for users not logged in,
# and full content if logged in.

if not st.session_state["logged_in"]:
    # --- Show welcome and preview tabs only, limit trial usage ---
    st.info("👋 Try a free preview of each section below! You can chat, practice, or solve up to 3 times per tab.")
    
    if tab == "Dashboard":
        if trial_too_many("dashboard"):
            trial_warning("dashboard")
        st.subheader("Dashboard Preview")
        st.write("See your learning stats, progress, and daily goals. (Demo Only)")
        if st.button("Do a Demo Action"):
            increment_trial("dashboard")
            st.success("Demo action performed!")

    elif tab == "Vocab Trainer":
        if trial_too_many("vocab"):
            trial_warning("vocab")
        st.subheader("Vocab Trainer Preview")
        st.write("Practice a few A1/A2 German words! (Demo Only)")
        if st.button("Try a Vocab Demo"):
            increment_trial("vocab")
            st.success("Nice! Try more by logging in.")

    elif tab == "Schreiben Trainer":
        if trial_too_many("schreiben"):
            trial_warning("schreiben")
        st.subheader("Schreiben Trainer Preview")
        st.write("Write a short letter or message. Get instant feedback. (Demo Only)")
        if st.button("Try a Writing Demo"):
            increment_trial("schreiben")
            st.success("Great! Upgrade to unlock full writing corrections.")

    elif tab == "Exams Mode & Custom Chat":
        if trial_too_many("exams"):
            trial_warning("exams")
        st.subheader("Exam Practice Preview")
        st.write("Try one sample speaking exam. (Demo Only)")
        if st.button("Try Exam Demo"):
            increment_trial("exams")
            st.success("Good job! Sign up for full exam simulations.")

    elif tab == "Grammar Helper (A.I. Search)":
        if trial_too_many("grammar"):
            trial_warning("grammar")
        st.subheader("Grammar Helper Preview")
        st.write("Ask the A.I. to explain a German grammar topic. (Demo Only)")
        if st.button("Try Grammar Demo"):
            increment_trial("grammar")
            st.success("Awesome! Log in to search any topic.")

    elif tab == "My Results and Resources":
        st.info("Login to see your personalized results and download resources!")

    st.markdown("---")
    st.info("🚀 To unlock unlimited practice, [register](#) or log in!")

else:
    # --- FULL APP EXPERIENCE BELOW THIS LINE (for logged in users) ---
    # Here you put your full logic for each tab.
    pass  # Will continue with detailed tab implementations next!

# =========================
# 5. DASHBOARD TAB (Logged-in User)
# =========================

if st.session_state["logged_in"] and tab == "Dashboard":
    user_row = st.session_state.get("user_row", {})
    name = user_row.get("name", "User")
    email = user_row.get("email", "")
    user_code = user_row.get("user_code", "")
    join_date = user_row.get("joined", "—")
    
    # (You’ll want to fetch real stats here in the future)
    vocab_total = 120      # Example
    vocab_mastered = 40    # Example
    exams_practiced = 5    # Example
    writing_attempts = 2   # Example

    # Main Welcome
    st.markdown(f"""
        <div style='text-align:center;margin-bottom:2em'>
            <h2>👋 Welcome back, <span style="color:#06B6D4">{name}</span>!</h2>
            <p style="font-size:18px;">Ready to level up your German with Falowen?</p>
        </div>
    """, unsafe_allow_html=True)

    # Progress Card Section
    col1, col2 = st.columns(2)
    with col1:
        st.metric("📚 Vocab Mastered", f"{vocab_mastered}/{vocab_total}")
        st.metric("✍️ Writing Attempts", writing_attempts)
    with col2:
        st.metric("🎤 Exams Practiced", exams_practiced)
        st.metric("📅 Member Since", join_date[:10] if join_date else "-")
    
    st.markdown("---")
    st.subheader("Your Learning Streak & Achievements (coming soon)")
    st.info("Streak, badges and XP will be added for more motivation!")

    # Action Buttons
    st.markdown("""
        <div style='text-align:center;margin-top:1em;'>
            <a href='#' style='padding:0.5em 1.2em;background:#06B6D4;color:white;border-radius:2em;font-size:18px;text-decoration:none;margin-right:0.8em;'>Start Vocab Trainer</a>
            <a href='#' style='padding:0.5em 1.2em;background:#14B8A6;color:white;border-radius:2em;font-size:18px;text-decoration:none;'>Go to Exam Mode</a>
        </div>
    """, unsafe_allow_html=True)
    
    st.markdown("---")
    st.write("Tip: Use the tabs above to explore all features.")

# Other tabs will be filled in below, as you say “next”


if tab == "Schreiben Trainer":
    st.header("✍️ Schreiben Trainer (Writing Practice)")

    # 1. Choose Level (remember previous)
    schreiben_levels = ["A1", "A2", "B1", "B2"]
    prev_level = st.session_state.get("schreiben_level", "A1")
    schreiben_level = st.selectbox(
        "Choose your writing level:",
        schreiben_levels,
        index=schreiben_levels.index(prev_level) if prev_level in schreiben_levels else 0,
        key="schreiben_level_selector"
    )
    st.session_state["schreiben_level"] = schreiben_level

    # 2. Daily limit tracking (by email & date)
    user_email = st.session_state.get("user_email", "demo@demo.com")
    user_name = st.session_state.get("user_name", "")
    today_str = str(date.today())
    limit_key = f"{user_email}_schreiben_{today_str}"
    if "schreiben_usage" not in st.session_state:
        st.session_state["schreiben_usage"] = {}
    st.session_state["schreiben_usage"].setdefault(limit_key, 0)
    daily_so_far = st.session_state["schreiben_usage"][limit_key]

    # 3. Show overall writing performance (DB-driven, mobile-first)
    attempted, passed, accuracy = get_writing_stats(user_email)
    st.markdown(f"""**📝 Your Overall Writing Performance**
- 📨 **Submitted:** {attempted}
- ✅ **Passed (≥17):** {passed}
- 📊 **Pass Rate:** {accuracy}%
- 📅 **Today:** {daily_so_far} / {SCHREIBEN_DAILY_LIMIT}
""")

    # 4. Level-Specific Stats (optional)
    stats = get_student_stats(user_email)
    lvl_stats = stats.get(schreiben_level, {}) if stats else {}
    if lvl_stats and lvl_stats.get("attempted"):
        correct = lvl_stats.get("correct", 0)
        attempted_lvl = lvl_stats.get("attempted", 0)
        st.info(f"Level `{schreiben_level}`: {correct} / {attempted_lvl} passed")
    else:
        st.info("_No previous writing activity for this level yet._")

    st.divider()

    # 5. Input Box (disabled if limit reached)
    user_letter = st.text_area(
        "Paste or type your German letter/essay here.",
        key="schreiben_input",
        disabled=(daily_so_far >= SCHREIBEN_DAILY_LIMIT),
        height=180,
        placeholder="Write your German letter here..."
    )

    # 6. AI prompt (always define before calling the API)
    ai_prompt = (
        f"You are Herr Felix, a supportive and innovative German letter writing trainer. "
        f"The student has submitted a {schreiben_level} German letter or essay. "
        "Write a brief comment in English about what the student did well and what they should improve while highlighting their points so they understand. "
        "Check if the letter matches their level. Talk as Herr Felix talking to a student and highlight the phrases with errors so they see it. "
        "Don't just say errors—show exactly where the mistakes are. "
        "1. Give a score out of 25 marks and always display the score clearly. "
        "2. If the score is 17 or more (17, 18, ..., 25), write: '**Passed: You may submit to your tutor!**'. "
        "3. If the score is 16 or less (16, 15, ..., 0), write: '**Keep improving before you submit.**'. "
        "4. Only write one of these two sentences, never both, and place it on a separate bolded line at the end of your feedback. "
        "5. Always explain why you gave the student that score based on grammar, spelling, vocabulary, coherence, and so on. "
        "6. Also check for AI usage or if the student wrote with their own effort. "
        "7. List and show the phrases to improve on with tips, suggestions, and what they should do. Let the student use your suggestions to correct the letter, but don't write the full corrected letter for them. "
        "Give scores by analyzing grammar, structure, vocabulary, etc. Explain to the student why you gave that score."
    )

    # 7. Submit & AI Feedback
    feedback = ""
    submit_disabled = daily_so_far >= SCHREIBEN_DAILY_LIMIT or not user_letter.strip()
    if submit_disabled and daily_so_far >= SCHREIBEN_DAILY_LIMIT:
        st.warning("You have reached today's writing practice limit. Please come back tomorrow.")

    if st.button("Get Feedback", type="primary", disabled=submit_disabled):
        with st.spinner("🧑‍🏫 Herr Felix is typing..."):
            try:
                completion = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": ai_prompt},
                        {"role": "user", "content": user_letter},
                    ],
                    temperature=0.6,
                )
                feedback = completion.choices[0].message.content
            except Exception as e:
                st.error("AI feedback failed. Please check your OpenAI setup.")
                feedback = None

        if feedback:
            import re
            # Robust regex for score detection
            score_match = re.search(
                r"score\s*(?:[:=]|is)?\s*(\d+)\s*/\s*25",
                feedback,
                re.IGNORECASE,
            )
            if not score_match:
                score_match = re.search(r"Score[:\s]+(\d+)\s*/\s*25", feedback, re.IGNORECASE)
            if score_match:
                score = int(score_match.group(1))
            else:
                st.warning("Could not detect a score in the AI feedback.")
                score = 0

            # === Update usage and save to DB ===
            st.session_state["schreiben_usage"][limit_key] += 1
            save_schreiben_submission(
                user_email, user_name, schreiben_level, user_letter, score, feedback
            )

            # --- Show Feedback ---
            st.markdown("---")
            st.markdown("#### 📝 Feedback from Herr Felix")
            st.markdown(feedback)

            # === Download as PDF ===
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            pdf.multi_cell(0, 10, f"Your Letter:\n\n{user_letter}\n\nFeedback from Herr Felix:\n\n{feedback}")
            pdf_output = f"Feedback_{user_email}_{schreiben_level}.pdf"
            pdf.output(pdf_output)
            with open(pdf_output, "rb") as f:
                pdf_bytes = f.read()
            st.download_button(
                "⬇️ Download Feedback as PDF",
                pdf_bytes,
                file_name=pdf_output,
                mime="application/pdf"
            )
            import os
            os.remove(pdf_output)

            # === WhatsApp Share ===
            wa_message = f"Hi, here is my German letter and AI feedback:\n\n{user_letter}\n\nFeedback:\n{feedback}"
            wa_url = (
                "https://api.whatsapp.com/send"
                "?phone=233205706589"
                f"&text={urllib.parse.quote(wa_message)}"
            )
            st.markdown(
                f"[📲 Send to Tutor on WhatsApp]({wa_url})",
                unsafe_allow_html=True
            )



# =========================
# 4. MAIN TAB SELECTOR & FREE PREVIEW LOGIC
# =========================

# --------- Free Preview/Trial Control ----------
MAX_FREE_TRIAL = 3  # e.g., let non-logged-in users try 3 actions per tab

def trial_too_many(key):
    """Check if the trial limit has been exceeded for a section."""
    count = st.session_state.get(f"trial_{key}", 0)
    return count >= MAX_FREE_TRIAL

def increment_trial(key):
    k = f"trial_{key}"
    st.session_state[k] = st.session_state.get(k, 0) + 1

def trial_warning(tab_key):
    st.warning(
        f"You've reached your free trial limit for this section. "
        f"Please **register or log in** to unlock unlimited access! 🚀"
    )
    st.stop()

# --------- Main Tab Selector ----------
tab = st.radio(
    "How do you want to practice?",
    [
        "Dashboard",
        "Vocab Trainer",
        "Schreiben Trainer",
        "Exams Mode & Custom Chat",
        "My Results and Resources",
        "Grammar Helper (A.I. Search)"
    ],
    key="main_tab_select"
)

# --------- Tab Logic with Trial Preview ---------
# We'll show a **trial preview** for users not logged in,
# and full content if logged in.

if not st.session_state["logged_in"]:
    # --- Show welcome and preview tabs only, limit trial usage ---
    st.info("👋 Try a free preview of each section below! You can chat, practice, or solve up to 3 times per tab.")
    
    if tab == "Dashboard":
        if trial_too_many("dashboard"):
            trial_warning("dashboard")
        st.subheader("Dashboard Preview")
        st.write("See your learning stats, progress, and daily goals. (Demo Only)")
        if st.button("Do a Demo Action"):
            increment_trial("dashboard")
            st.success("Demo action performed!")

    elif tab == "Vocab Trainer":
        if trial_too_many("vocab"):
            trial_warning("vocab")
        st.subheader("Vocab Trainer Preview")
        st.write("Practice a few A1/A2 German words! (Demo Only)")
        if st.button("Try a Vocab Demo"):
            increment_trial("vocab")
            st.success("Nice! Try more by logging in.")

    elif tab == "Schreiben Trainer":
        if trial_too_many("schreiben"):
            trial_warning("schreiben")
        st.subheader("Schreiben Trainer Preview")
        st.write("Write a short letter or message. Get instant feedback. (Demo Only)")
        if st.button("Try a Writing Demo"):
            increment_trial("schreiben")
            st.success("Great! Upgrade to unlock full writing corrections.")

    elif tab == "Exams Mode & Custom Chat":
        if trial_too_many("exams"):
            trial_warning("exams")
        st.subheader("Exam Practice Preview")
        st.write("Try one sample speaking exam. (Demo Only)")
        if st.button("Try Exam Demo"):
            increment_trial("exams")
            st.success("Good job! Sign up for full exam simulations.")

    elif tab == "Grammar Helper (A.I. Search)":
        if trial_too_many("grammar"):
            trial_warning("grammar")
        st.subheader("Grammar Helper Preview")
        st.write("Ask the A.I. to explain a German grammar topic. (Demo Only)")
        if st.button("Try Grammar Demo"):
            increment_trial("grammar")
            st.success("Awesome! Log in to search any topic.")

    elif tab == "My Results and Resources":
        st.info("Login to see your personalized results and download resources!")

    st.markdown("---")
    st.info("🚀 To unlock unlimited practice, [register](#) or log in!")

else:
    # --- FULL APP EXPERIENCE BELOW THIS LINE (for logged in users) ---
    # Here you put your full logic for each tab.
    pass  # Will continue with detailed tab implementations next!

# =========================================
# VOCAB TRAINER TAB (A1–C1) + MY VOCAB
# =========================================

if tab == "Vocab Trainer":
    # Use a dictionary like:
    # VOCAB_LISTS = {"A1": [("Haus", "house"), ...], ...}
    # Make sure to define VOCAB_LISTS at the top of your code!
    tab_mode = st.radio("Choose mode:", ["Practice", "My Vocab"], horizontal=True)
    
    # -- Safe session state init --
    st.session_state.setdefault("vocab_feedback", "")
    st.session_state.setdefault("show_next_button", False)
    st.session_state.setdefault("last_was_correct", False)
    st.session_state.setdefault("current_vocab_idx", None)
    st.session_state.setdefault("vocab_completed", set())

    def ai_vocab_feedback(word, student, correct):
        """Direct match and fallback to AI for nuanced feedback."""
        student_ans = student.strip().lower()
        if correct is not None:
            valid = ([c.strip().lower() for c in correct]
                     if isinstance(correct, (list, tuple))
                     else [correct.strip().lower()])
            if student_ans in valid:
                return "<span style='color:green;font-weight:bold'>✅ Correct!</span>", True, False
        # Fallback to AI
        target = correct or word
        prompt = (
            f"The student answered '{student.strip()}' for the German word '{word.strip()}'. "
            f"The expected answer is '{target.strip()}'.\n"
            "1. Reply 'True' or 'False' on the first line if the student's answer is correct.\n"
            "2. If False, write: 'Correct answer: {target}'.\n"
            "3. If the student's answer is close, include 'You were close!'."
        )
        try:
            resp = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=100,
                temperature=0.2,
            )
            reply = resp.choices[0].message.content.strip()
            lines = reply.splitlines()
            is_correct = lines[0].strip().lower().startswith("true")
            is_close = "close" in reply.lower()
            if is_correct:
                prefix = "<span style='color:green;font-weight:bold'>✅ Correct!</span>\n\n"
            elif is_close:
                prefix = "<span style='color:orange;font-weight:bold'>⚠️ You were close!</span>\n\n"
            else:
                prefix = "<span style='color:red;font-weight:bold'>❌ Not quite.</span>\n\n"
            feedback = prefix + "\n".join(lines[1:])
            return feedback, is_correct, is_close
        except Exception as e:
            return f"<span style='color:red'>AI check failed: {e}</span>", False, False

    # Pull user info
    user_row = st.session_state.get("user_row", {})
    student_code = user_row.get("user_code", "demo")
    student_name = user_row.get("name", "Demo")

    # Level selector
    level_opts = ["A1", "A2", "B1", "B2", "C1"]
    selected = st.selectbox("Choose level", level_opts, key="vocab_level_select")
    if selected != st.session_state.get("vocab_level", "A1"):
        st.session_state["vocab_level"] = selected
        st.session_state["vocab_feedback"] = ""
        st.session_state["show_next_button"] = False
        st.session_state["vocab_completed"] = set()
        st.session_state["current_vocab_idx"] = None

    vocab_list = VOCAB_LISTS.get(selected, [])
    is_tuple = bool(vocab_list and isinstance(vocab_list[0], (list, tuple)))
    completed = st.session_state.get("vocab_completed", set())
    if not isinstance(completed, set):
        completed = set(completed)
        st.session_state["vocab_completed"] = completed
    pending_idxs = [i for i in range(len(vocab_list)) if i not in completed]

    # =============== PRACTICE MODE ===============
    if tab_mode == "Practice":
        st.header("🧠 Vocabulary Practice")

        st.progress(
            min(len(completed), len(vocab_list))/max(1, len(vocab_list)),
            text=f"{len(completed)}/{len(vocab_list)} mastered"
        )

        if st.button("🔄 Reset Progress"):
            st.session_state["vocab_completed"] = set()
            st.session_state["vocab_feedback"] = ""
            st.session_state["show_next_button"] = False
            st.session_state["current_vocab_idx"] = None
            st.session_state["last_was_correct"] = False
            st.session_state.pop("vocab_answer_box", None)
            st.rerun()

        # If feedback exists and waiting for Next:
        if st.session_state["vocab_feedback"] and st.session_state["show_next_button"]:
            st.markdown(st.session_state["vocab_feedback"], unsafe_allow_html=True)
            if st.button("➡️ Next"):
                if st.session_state["last_was_correct"]:
                    st.session_state["vocab_completed"].add(st.session_state["current_vocab_idx"])
                # Reset for next round
                st.session_state["vocab_feedback"] = ""
                st.session_state["show_next_button"] = False
                st.session_state["current_vocab_idx"] = None
                st.session_state["last_was_correct"] = False
                st.session_state.pop("vocab_answer_box", None)
                st.rerun()
            st.stop()  # Don't show input again until Next is pressed

        if pending_idxs:
            idx = st.session_state.get("current_vocab_idx")
            if idx is None or idx not in pending_idxs:
                import random
                idx = random.choice(pending_idxs)
                st.session_state["current_vocab_idx"] = idx
                st.session_state.pop("vocab_answer_box", None)
            word = vocab_list[idx][0] if is_tuple else vocab_list[idx]
            corr = vocab_list[idx][1] if is_tuple else None

            st.markdown(f"**Translate:** {word}")
            ans = st.text_input("Your answer:", key="vocab_answer_box")
            # Show "Check" only if no feedback is waiting
            if not st.session_state["show_next_button"]:
                if st.button("Check", key=f"check_{idx}_{selected}"):
                    fb, correct, close = ai_vocab_feedback(word, ans, corr)
                    st.session_state["vocab_feedback"] = fb
                    st.session_state["show_next_button"] = True
                    st.session_state["last_was_correct"] = correct
                    st.rerun()
        else:
            st.success("🎉 All words completed for this level!")

    # =============== MY VOCAB MODE ===============
    if tab_mode == "My Vocab":
        st.header("📝 My Personal Vocabulary List")
        st.write("Add words you want to remember, delete any, and download your full list as PDF.")
        # NOTE: You need to define these helper functions if you want DB integration!
        with st.form("add_my_vocab_form", clear_on_submit=True):
            new_word = st.text_input("German Word", key="my_vocab_word")
            new_translation = st.text_input("Translation (English or other)", key="my_vocab_translation")
            submitted = st.form_submit_button("Add to My Vocab")
            if submitted and new_word.strip() and new_translation.strip():
                add_my_vocab(student_code, selected, new_word.strip(), new_translation.strip())
                st.success(f"Added '{new_word.strip()}' → '{new_translation.strip()}' to your list.")
                st.rerun()
        rows = get_my_vocab(student_code, selected)
        if rows:
            for row in rows:
                col1, col2, col3 = st.columns([4,4,1])
                col1.markdown(f"**{row[1]}**")
                col2.markdown(f"{row[2]}")
                if col3.button("🗑️", key=f"del_{row[0]}"):
                    delete_my_vocab(row[0], student_code)
                    st.rerun()
            if st.button("📄 Download My Vocab as PDF"):
                pdf = FPDF()
                pdf.add_page()
                pdf.set_font("Arial", size=11)
                title = f"My Personal Vocab – {selected} ({student_name})"
                pdf.cell(0, 8, title, ln=1)
                pdf.ln(3)
                # Table headers
                pdf.set_font("Arial", "B", 10)
                pdf.cell(50, 8, "German", border=1)
                pdf.cell(60, 8, "Translation", border=1)
                pdf.cell(30, 8, "Date", border=1)
                pdf.ln()
                pdf.set_font("Arial", "", 10)
                for row in rows:
                    pdf.cell(50, 8, str(row[1]), border=1)
                    pdf.cell(60, 8, str(row[2]), border=1)
                    pdf.cell(30, 8, str(row[3]), border=1)
                    pdf.ln()
                pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
                st.download_button(
                    label="Download PDF",
                    data=pdf_bytes,
                    file_name=f"{student_code}_my_vocab_{selected}.pdf",
                    mime="application/pdf"
                )
        else:
            st.info("No personal vocab saved yet for this level.")



if tab == "Schreiben Trainer":
    st.header("✍️ Schreiben Trainer (Writing Practice)")

    # 1. Choose Level (remember previous)
    schreiben_levels = ["A1", "A2", "B1", "B2"]
    prev_level = st.session_state.get("schreiben_level", "A1")
    schreiben_level = st.selectbox(
        "Choose your writing level:",
        schreiben_levels,
        index=schreiben_levels.index(prev_level) if prev_level in schreiben_levels else 0,
        key="schreiben_level_selector"
    )
    st.session_state["schreiben_level"] = schreiben_level

    # 2. Daily limit tracking (by email & date)
    user_email = st.session_state.get("user_email", "demo@demo.com")
    user_name = st.session_state.get("user_name", "")
    today_str = str(date.today())
    limit_key = f"{user_email}_schreiben_{today_str}"
    if "schreiben_usage" not in st.session_state:
        st.session_state["schreiben_usage"] = {}
    st.session_state["schreiben_usage"].setdefault(limit_key, 0)
    daily_so_far = st.session_state["schreiben_usage"][limit_key]

    # 3. Show overall writing performance (DB-driven, mobile-first)
    attempted, passed, accuracy = get_writing_stats(user_email)
    st.markdown(f"""**📝 Your Overall Writing Performance**
- 📨 **Submitted:** {attempted}
- ✅ **Passed (≥17):** {passed}
- 📊 **Pass Rate:** {accuracy}%
- 📅 **Today:** {daily_so_far} / {SCHREIBEN_DAILY_LIMIT}
""")

    # 4. Level-Specific Stats (optional)
    stats = get_student_stats(user_email)
    lvl_stats = stats.get(schreiben_level, {}) if stats else {}
    if lvl_stats and lvl_stats.get("attempted"):
        correct = lvl_stats.get("correct", 0)
        attempted_lvl = lvl_stats.get("attempted", 0)
        st.info(f"Level `{schreiben_level}`: {correct} / {attempted_lvl} passed")
    else:
        st.info("_No previous writing activity for this level yet._")

    st.divider()

    # 5. Input Box (disabled if limit reached)
    user_letter = st.text_area(
        "Paste or type your German letter/essay here.",
        key="schreiben_input",
        disabled=(daily_so_far >= SCHREIBEN_DAILY_LIMIT),
        height=180,
        placeholder="Write your German letter here..."
    )

    # 6. AI prompt (always define before calling the API)
    ai_prompt = (
        f"You are Herr Felix, a supportive and innovative German letter writing trainer. "
        f"The student has submitted a {schreiben_level} German letter or essay. "
        "Write a brief comment in English about what the student did well and what they should improve while highlighting their points so they understand. "
        "Check if the letter matches their level. Talk as Herr Felix talking to a student and highlight the phrases with errors so they see it. "
        "Don't just say errors—show exactly where the mistakes are. "
        "1. Give a score out of 25 marks and always display the score clearly. "
        "2. If the score is 17 or more (17, 18, ..., 25), write: '**Passed: You may submit to your tutor!**'. "
        "3. If the score is 16 or less (16, 15, ..., 0), write: '**Keep improving before you submit.**'. "
        "4. Only write one of these two sentences, never both, and place it on a separate bolded line at the end of your feedback. "
        "5. Always explain why you gave the student that score based on grammar, spelling, vocabulary, coherence, and so on. "
        "6. Also check for AI usage or if the student wrote with their own effort. "
        "7. List and show the phrases to improve on with tips, suggestions, and what they should do. Let the student use your suggestions to correct the letter, but don't write the full corrected letter for them. "
        "Give scores by analyzing grammar, structure, vocabulary, etc. Explain to the student why you gave that score."
    )

    # 7. Submit & AI Feedback
    feedback = ""
    submit_disabled = daily_so_far >= SCHREIBEN_DAILY_LIMIT or not user_letter.strip()
    if submit_disabled and daily_so_far >= SCHREIBEN_DAILY_LIMIT:
        st.warning("You have reached today's writing practice limit. Please come back tomorrow.")

    if st.button("Get Feedback", type="primary", disabled=submit_disabled):
        with st.spinner("🧑‍🏫 Herr Felix is typing..."):
            try:
                completion = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": ai_prompt},
                        {"role": "user", "content": user_letter},
                    ],
                    temperature=0.6,
                )
                feedback = completion.choices[0].message.content
            except Exception as e:
                st.error("AI feedback failed. Please check your OpenAI setup.")
                feedback = None

        if feedback:
            import re
            # Robust regex for score detection
            score_match = re.search(
                r"score\s*(?:[:=]|is)?\s*(\d+)\s*/\s*25",
                feedback,
                re.IGNORECASE,
            )
            if not score_match:
                score_match = re.search(r"Score[:\s]+(\d+)\s*/\s*25", feedback, re.IGNORECASE)
            if score_match:
                score = int(score_match.group(1))
            else:
                st.warning("Could not detect a score in the AI feedback.")
                score = 0

            # === Update usage and save to DB ===
            st.session_state["schreiben_usage"][limit_key] += 1
            save_schreiben_submission(
                user_email, user_name, schreiben_level, user_letter, score, feedback
            )

            # --- Show Feedback ---
            st.markdown("---")
            st.markdown("#### 📝 Feedback from Herr Felix")
            st.markdown(feedback)

            # === Download as PDF ===
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            pdf.multi_cell(0, 10, f"Your Letter:\n\n{user_letter}\n\nFeedback from Herr Felix:\n\n{feedback}")
            pdf_output = f"Feedback_{user_email}_{schreiben_level}.pdf"
            pdf.output(pdf_output)
            with open(pdf_output, "rb") as f:
                pdf_bytes = f.read()
            st.download_button(
                "⬇️ Download Feedback as PDF",
                pdf_bytes,
                file_name=pdf_output,
                mime="application/pdf"
            )
            import os
            os.remove(pdf_output)

            # === WhatsApp Share ===
            wa_message = f"Hi, here is my German letter and AI feedback:\n\n{user_letter}\n\nFeedback:\n{feedback}"
            wa_url = (
                "https://api.whatsapp.com/send"
                "?phone=233205706589"
                f"&text={urllib.parse.quote(wa_message)}"
            )
            st.markdown(
                f"[📲 Send to Tutor on WhatsApp]({wa_url})",
                unsafe_allow_html=True
            )

# ================================
# EXAMS MODE & CUSTOM CHAT TAB
# ================================

import random
import urllib.parse

if tab == "Exams Mode & Custom Chat":
    # --- DAILY LIMIT CHECK ---
    user_email = st.session_state.get("user_email", "demo@demo.com")
    user_name = st.session_state.get("user_name", "Demo")
    FALOWEN_DAILY_LIMIT = 12  # set your preferred limit

    def get_falowen_usage(user_email):
        # For demo: just session state, production: pull from DB with today's date
        today = str(date.today())
        key = f"{user_email}_falowen_{today}"
        if "falowen_usage" not in st.session_state:
            st.session_state["falowen_usage"] = {}
        return st.session_state["falowen_usage"].get(key, 0)

    def inc_falowen_usage(user_email):
        today = str(date.today())
        key = f"{user_email}_falowen_{today}"
        if "falowen_usage" not in st.session_state:
            st.session_state["falowen_usage"] = {}
        st.session_state["falowen_usage"][key] = st.session_state["falowen_usage"].get(key, 0) + 1

    def has_falowen_quota(user_email):
        return get_falowen_usage(user_email) < FALOWEN_DAILY_LIMIT

    # ---- PDF Helper ----
    def falowen_download_pdf(messages, filename):
        from fpdf import FPDF
        import os
        def safe_latin1(text):
            return text.encode("latin1", "replace").decode("latin1")
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        chat_text = ""
        for m in messages:
            role = "Herr Felix" if m["role"] == "assistant" else "Student"
            safe_msg = safe_latin1(m["content"])
            chat_text += f"{role}: {safe_msg}\n\n"
        pdf.multi_cell(0, 10, chat_text)
        pdf_output = f"{filename}.pdf"
        pdf.output(pdf_output)
        with open(pdf_output, "rb") as f:
            pdf_bytes = f.read()
        os.remove(pdf_output)
        return pdf_bytes

    # ---- EXAM QUESTIONS DICTIONARIES (A1–C1, one per part) ----
    # These should be your real question banks!
    A1_TEIL2 = [("Geschäft", "schließen"), ("Uhr", "Uhrzeit"), ("Schule", "Lehrer")]
    A1_TEIL3 = ["Radio anmachen", "Fenster zumachen", "Licht anschalten"]
    # Expand A2, B1, B2, C1 as needed...
    A2_TEIL1 = ["Wohnort", "Freunde", "Familie"]
    A2_TEIL2 = ["Arbeit", "Reisen", "Gesundheit"]
    # etc...

    # ---- PROMPT BUILDERS ---- (shortened for brevity, use your long logic from above!)
    def build_exam_instruction(level, teil):
        if level == "A1" and "Teil 1" in teil:
            return "Introduce yourself: Name, Country, City, Languages, Job, Hobby."
        if level == "A1" and "Teil 2" in teil:
            return "You get a topic and a keyword. Ask a question using the keyword, then answer it yourself."
        if level == "A1" and "Teil 3" in teil:
            return "Write a polite request for the prompt."
        # ... repeat for other levels
        return "Start your exam!"

    def build_exam_system_prompt(level, teil):
        if level == "A1" and "Teil 1" in teil:
            return (
                "You are Herr Felix, an A1 examiner. Ask the student to introduce themselves with Name, Country, City, Languages, Job, Hobby. "
                "Check for errors and correct them in English. After, ask 3 easy questions about family."
            )
        # ... repeat for other parts and levels!
        return "You are Herr Felix, a German examiner."

    def build_custom_chat_prompt(level):
        return (
            "You are Herr Felix, a supportive German teacher. Guide the student through a conversation on their chosen topic. "
            "Ask interesting questions, give encouragement, and correct mistakes politely."
        )

    # ---- SESSION STATE DEFAULTS ----
    default_state = {
        "falowen_stage": 1,
        "falowen_mode": None,
        "falowen_level": None,
        "falowen_teil": None,
        "falowen_messages": [],
        "falowen_turn_count": 0,
        "custom_topic_intro_done": False,
        "falowen_exam_topic": None,
        "falowen_exam_keyword": None,
    }
    for key, val in default_state.items():
        if key not in st.session_state:
            st.session_state[key] = val

    # ---- STAGE 1: Mode Selection ----
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

    # ---- STAGE 2: Level Selection ----
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
            st.session_state["falowen_stage"] = 3 if st.session_state["falowen_mode"] == "Geführte Prüfungssimulation (Exam Mode)" else 4
            st.session_state["falowen_teil"] = None
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # ---- STAGE 3: Exam Part & Topic (Exam Mode Only) ----
    if st.session_state["falowen_stage"] == 3:
        level = st.session_state["falowen_level"]
        teil_options = {
            "A1": ["Teil 1 – Basic Introduction", "Teil 2 – Question and Answer", "Teil 3 – Making A Request"],
            "A2": ["Teil 1 – Fragen zu Schlüsselwörtern", "Teil 2 – Über das Thema sprechen", "Teil 3 – Gemeinsam planen"],
            "B1": ["Teil 1 – Gemeinsam planen (Dialogue)", "Teil 2 – Präsentation (Monologue)", "Teil 3 – Feedback & Fragen stellen"],
            "B2": ["Teil 1 – Diskussion", "Teil 2 – Präsentation", "Teil 3 – Argumentation"],
            "C1": ["Teil 1 – Vortrag", "Teil 2 – Diskussion", "Teil 3 – Bewertung"]
        }
        exam_topics = []
        if level == "A1":
            exam_topics = [f"{t[0]} – {t[1]}" for t in A1_TEIL2] + A1_TEIL3
        elif level == "A2":
            exam_topics = A2_TEIL1 + A2_TEIL2
        # ... add more as above

        st.subheader("Step 3: Choose Exam Part")
        teil = st.radio("Which exam part?", teil_options[level], key="falowen_teil_center")
        picked = st.selectbox("Choose a topic (optional):", ["(random)"] + exam_topics) if exam_topics else None
        st.session_state["falowen_exam_topic"] = None if (picked is None or picked == "(random)") else picked

        if st.button("⬅️ Back", key="falowen_back2"):
            st.session_state["falowen_stage"] = 2
            st.stop()

        if st.button("Start Practice", key="falowen_start_practice"):
            st.session_state["falowen_teil"] = teil
            st.session_state["falowen_stage"] = 4
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # ---- STAGE 4: MAIN CHAT ----
    if st.session_state["falowen_stage"] == 4:
        level = st.session_state["falowen_level"]
        teil = st.session_state.get("falowen_teil", "")
        mode = st.session_state["falowen_mode"]
        is_exam = mode == "Geführte Prüfungssimulation (Exam Mode)"

        # ---- Show daily usage ----
        used_today = get_falowen_usage(user_email)
        st.info(f"Today: {used_today} / {FALOWEN_DAILY_LIMIT} Falowen chat messages used.")
        if used_today >= FALOWEN_DAILY_LIMIT:
            st.warning("You have reached your daily practice limit for Falowen today. Please come back tomorrow.")
            st.stop()

        # ---- Session Controls ----
        def reset_chat():
            st.session_state.update({
                "falowen_stage": 1,
                "falowen_messages": [],
                "falowen_teil": None,
                "falowen_mode": None,
                "custom_topic_intro_done": False,
                "falowen_turn_count": 0,
                "falowen_exam_topic": None
            })
            st.rerun()

        def back_step():
            st.session_state.update({
                "falowen_stage": max(1, st.session_state["falowen_stage"] - 1),
                "falowen_messages": []
            })
            st.rerun()

        def change_level():
            st.session_state.update({
                "falowen_stage": 2,
                "falowen_messages": []
            })
            st.rerun()

        # ---- Render Chat History ----
        for msg in st.session_state["falowen_messages"]:
            if msg["role"] == "assistant":
                with st.chat_message("assistant", avatar="🧑‍🏫"):
                    st.markdown("<span style='color:#33691e;font-weight:bold'>🧑‍🏫 Herr Felix:</span>", unsafe_allow_html=True)
                    st.markdown(msg["content"])
            else:
                with st.chat_message("user"):
                    st.markdown(f"🗣️ {msg['content']}")

        # ---- PDF Download Button ----
        if st.session_state["falowen_messages"]:
            pdf_bytes = falowen_download_pdf(
                st.session_state["falowen_messages"],
                f"Falowen_Chat_{level}_{teil.replace(' ', '_') if teil else 'chat'}"
            )
            st.download_button(
                "⬇️ Download Chat as PDF",
                pdf_bytes,
                file_name=f"Falowen_Chat_{level}_{teil.replace(' ', '_') if teil else 'chat'}.pdf",
                mime="application/pdf"
            )

        # ---- Session Buttons ----
        col1, col2, col3 = st.columns(3)
        with col1:
            if st.button("Restart Chat"): reset_chat()
        with col2:
            if st.button("Back"): back_step()
        with col3:
            if st.button("Change Level"): change_level()

        # ---- Initial Instruction ----
        if not st.session_state["falowen_messages"]:
            instruction = build_exam_instruction(level, teil) if is_exam else (
                "Hallo! 👋 What would you like to talk about? Give me details of what you want so I can understand."
            )
            st.session_state["falowen_messages"].append({"role": "assistant", "content": instruction})

        # ---- Build System Prompt including topic/context ----
        if is_exam:
            base_prompt = build_exam_system_prompt(level, teil)
            topic = st.session_state.get("falowen_exam_topic")
            if topic:
                system_prompt = f"{base_prompt} Thema: {topic}."
            else:
                system_prompt = base_prompt
        else:
            system_prompt = build_custom_chat_prompt(level)

        # ---- Chat Input & Assistant Response ----
        user_input = st.chat_input("Type your answer or message here...", key="falowen_user_input")
        if user_input:
            st.session_state["falowen_messages"].append({"role": "user", "content": user_input})
            inc_falowen_usage(user_email)

            # render user message
            with st.chat_message("user"):
                st.markdown(f"🗣️ {user_input}")

            # AI response
            with st.chat_message("assistant", avatar="🧑‍🏫"):
                with st.spinner("🧑‍🏫 Herr Felix is typing..."):
                    messages = [{"role": "system", "content": system_prompt}] + st.session_state["falowen_messages"]
                    try:
                        resp = client.chat.completions.create(
                            model="gpt-4o", messages=messages, temperature=0.15, max_tokens=600
                        )
                        ai_reply = resp.choices[0].message.content.strip()
                    except Exception as e:
                        ai_reply = f"Sorry, an error occurred: {e}"
                st.markdown("<span style='color:#33691e;font-weight:bold'>🧑‍🏫 Herr Felix:</span>", unsafe_allow_html=True)
                st.markdown(ai_reply)

            # save assistant reply
            st.session_state["falowen_messages"].append({"role": "assistant", "content": ai_reply})
# ======================================
# GRAMMAR HELPER CHAT (Falowen Grammar A.I.)
# ======================================

if tab == "Grammar Helper":
    st.header("💡 Falowen Grammar Chat")

    user_email = st.session_state.get("user_email", "demo@demo.com")
    user_name = st.session_state.get("user_name", "Demo")
    grammar_level = st.selectbox("Select your level:", ["A1", "A2", "B1", "B2", "C1"], key="grammar_helper_level")

    # Session state for chat
    if "grammar_chat" not in st.session_state:
        st.session_state["grammar_chat"] = []

    # Welcome message only at start
    if not st.session_state["grammar_chat"]:
        welcome = (
            "👋 Hi! I’m Herr Felix, your Grammar Helper. "
            "Ask me anything about German grammar, words, or sentence structure.\n\n"
            "I'll explain at your level and give examples. Just type your question below!"
        )
        st.session_state["grammar_chat"].append({"role": "assistant", "content": welcome})

    # Show chat history
    for msg in st.session_state["grammar_chat"]:
        with st.chat_message("assistant" if msg["role"]=="assistant" else "user"):
            st.markdown(msg["content"])

    # PDF Download
    if st.session_state["grammar_chat"]:
        from fpdf import FPDF
        import os
        def grammar_pdf(messages):
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            for m in messages:
                who = "Herr Felix" if m["role"]=="assistant" else "Student"
                pdf.multi_cell(0, 8, f"{who}: {m['content']}\n")
            pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
            return pdf_bytes
        st.download_button(
            "⬇️ Download Chat as PDF",
            grammar_pdf(st.session_state["grammar_chat"]),
            file_name=f"Falowen_Grammar_{user_email}.pdf",
            mime="application/pdf"
        )

    # Chat Input
    grammar_input = st.chat_input("Ask your grammar question here...", key="grammar_chat_input")
    if grammar_input:
        st.session_state["grammar_chat"].append({"role": "user", "content": grammar_input})

        # Build AI prompt
        system_prompt = (
            f"You are Herr Felix, an expert German grammar teacher. "
            f"Welcome every student warmly, answer clearly, and give examples. "
            f"Always answer at {grammar_level} level, using simple language and step-by-step explanations. "
            "If the question is too advanced, politely suggest an easier explanation or encourage them to keep learning."
        )
        messages = [{"role": "system", "content": system_prompt}] + [
            {"role": m["role"], "content": m["content"]} for m in st.session_state["grammar_chat"]
        ]

        with st.chat_message("assistant"):
            with st.spinner("Herr Felix is thinking..."):
                try:
                    resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages,
                        temperature=0.3,
                        max_tokens=400
                    )
                    answer = resp.choices[0].message.content
                except Exception as e:
                    answer = f"Sorry, something went wrong: {e}"
            st.markdown(answer)
            st.session_state["grammar_chat"].append({"role": "assistant", "content": answer})

