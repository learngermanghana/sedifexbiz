import os
import json
from datetime import datetime
import random
import pandas as pd
import streamlit as st
import requests
import urllib.parse

from openai import OpenAI
from fpdf import FPDF
from st_cookies_manager import EncryptedCookieManager

import firebase_admin
from firebase_admin import credentials, firestore
import pyrebase
from streamlit_oauth import OAuth2Component

# === FIREBASE & OPENAI SETUP ===
FIREBASE_CONFIG = json.loads(os.getenv("FIREBASE_CONFIG"))
firebase = pyrebase.initialize_app(FIREBASE_CONFIG)
auth = firebase.auth()
if not firebase_admin._apps:
    firebase_credentials = json.loads(os.getenv("FIREBASE_SERVICE_ACCOUNT"))
    cred = credentials.Certificate(firebase_credentials)
    firebase_admin.initialize_app(cred)
db = firestore.client()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or st.secrets.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    st.error("Missing OpenAI API key.")
    st.stop()
os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
client = OpenAI()

COOKIE_SECRET = os.getenv("COOKIE_SECRET") or st.secrets.get("COOKIE_SECRET")
if not COOKIE_SECRET:
    st.error("COOKIE_SECRET environment variable not set!")
    st.stop()
cookie_manager = EncryptedCookieManager(prefix="falowen_", password=COOKIE_SECRET)
cookie_manager.ready()

# === SESSION DEFAULTS ===
for k, v in {
    "logged_in": False, "user_row": None, "user_email": "",
    "user_name": "", "pro_user": False, "user_google_id": "",
}.items():
    if k not in st.session_state:
        st.session_state[k] = v

# === GOOGLE OAUTH ===
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
if "localhost" in st.get_option("server.address") or st.get_option("server.address") is None:
    REDIRECT_URI = "http://localhost:8501"
else:
    REDIRECT_URI = "https://falowen.onrender.com"
google_auth = OAuth2Component(
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    authorize_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint="https://oauth2.googleapis.com/token",
)

def create_or_fetch_user(email, name, google_id=None):
    users_ref = db.collection("users")
    query = users_ref.where("email", "==", email).stream()
    docs = list(query)
    if docs:
        doc = docs[0]
        user_data = doc.to_dict()
        if "pro_user" not in user_data:
            users_ref.document(doc.id).update({"pro_user": False})
            user_data["pro_user"] = False
        if user_data.get("name") != name:
            users_ref.document(doc.id).update({"name": name})
            user_data["name"] = name
        if google_id and user_data.get("google_id") != google_id:
            users_ref.document(doc.id).update({"google_id": google_id})
            user_data["google_id"] = google_id
        return user_data
    user_code = email.split("@")[0]
    user_doc = {
        "email": email,
        "name": name,
        "user_code": user_code,
        "joined": datetime.utcnow().isoformat(),
        "pro_user": False,
    }
    if google_id:
        user_doc["google_id"] = google_id
    users_ref.document(user_code).set(user_doc)
    return user_doc

def paywall():
    if not st.session_state.get("pro_user"):
        st.markdown("## 🔒 Pro Features Locked")
        st.info("Upgrade to unlock all premium features!")
        pay_url = "https://paystack.com/pay/YOUR_CUSTOM_LINK"  # Replace with your Paystack page
        st.markdown(f"[**Pay with Paystack**]({pay_url})", unsafe_allow_html=True)
        st.stop()

query_params = st.query_params if hasattr(st, "query_params") else st.experimental_get_query_params()
if query_params.get("paid") == ["true"] and st.session_state.get("logged_in"):
    user_code = st.session_state["user_row"]["user_code"]
    db.collection("users").document(user_code).update({"pro_user": True})
    st.session_state["pro_user"] = True
    st.success("🎉 Payment successful! Pro features unlocked.")

# === LOGIN UI ===
if not st.session_state["logged_in"]:
    st.title("🔐 Welcome to Falowen!")
    menu = st.radio("Choose an option:", ["Login", "Register"])
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")
    st.markdown("---")
    st.info("Or sign in with Google:")
    result = google_auth.authorize_button(
        name="Continue with Google",
        redirect_uri=REDIRECT_URI,
        scope="openid email profile",
        key="google"
    )
    if result and "token" in result:
        token = result["token"]
        headers = {"Authorization": f"Bearer {token['access_token']}"}
        resp = requests.get("https://www.googleapis.com/oauth2/v2/userinfo", headers=headers)
        user_info = resp.json()
        email = user_info.get("email")
        name = user_info.get("name") or email.split("@")[0]
        google_id = user_info.get("id")
        user_profile = create_or_fetch_user(email, name, google_id)
        st.session_state["user_email"] = email
        st.session_state["user_name"] = name
        st.session_state["user_row"] = user_profile
        st.session_state["pro_user"] = user_profile.get("pro_user", False)
        st.session_state["logged_in"] = True
        st.success(f"Google login successful! Welcome, {name}")
        st.rerun()
    st.markdown("---")
    if menu == "Register":
        name = st.text_input("Your Name")
        if st.button("Register"):
            try:
                user = auth.create_user_with_email_and_password(email, password)
                user_profile = create_or_fetch_user(email, name)
                st.session_state["user_email"] = email
                st.session_state["user_name"] = name
                st.session_state["user_row"] = user_profile
                st.session_state["pro_user"] = user_profile.get("pro_user", False)
                st.session_state["logged_in"] = True
                st.success("Registration successful!")
                st.rerun()
            except Exception as e:
                st.error(f"Registration failed: {e}")
    else:
        if st.button("Login"):
            try:
                user = auth.sign_in_with_email_and_password(email, password)
                user_profile = create_or_fetch_user(email, user.get("displayName") or email.split("@")[0])
                st.session_state["user_email"] = email
                st.session_state["user_name"] = user_profile["name"]
                st.session_state["user_row"] = user_profile
                st.session_state["pro_user"] = user_profile.get("pro_user", False)
                st.session_state["logged_in"] = True
                st.success(f"Welcome, {st.session_state['user_name']}!")
                st.rerun()
            except Exception as e:
                st.error("Login failed. Try again or register first.")
    st.stop()

# === LOGOUT ===
if st.session_state["logged_in"]:
    st.sidebar.markdown("---")
    if st.sidebar.button("🚪 Logout"):
        for k in [
            "logged_in", "user_row", "user_email", "user_name", "pro_user", "user_google_id"
        ]:
            if k in st.session_state:
                del st.session_state[k]
        st.success("Logged out!")
        st.rerun()

if st.session_state.get("user_email") == "YOUR_EMAIL@domain.com":
    st.session_state["pro_user"] = True
    db.collection("users").document(st.session_state["user_row"]["user_code"]).update({"pro_user": True})


# =============================
# VOCAB_LISTS (expand as needed)
# =============================
VOCAB_LISTS = {
    "A1": [
        ("Haus", "house"),
        ("Buch", "book"),
        ("Auto", "car"),
        ("Tisch", "table"),
        ("Hund", "dog"),
    ],
    "A2": [
        ("Flughafen", "airport"),
        ("Geschenk", "gift"),
        ("Gemüse", "vegetables"),
    ],
}

# ======================
# SHOW APP CONTENT HERE!
# ======================
if st.session_state.get("logged_in", False):
    tab = st.radio(
        "Choose a section:",
        [
            "Dashboard",
            "Vocab Trainer",
            "My Vocab",
            "Schreiben Trainer",
            "Exams",
            "Custom Chat",
            "Grammar Helper"
        ],
        key="main_tab_select"
    )

    # -------------- DASHBOARD --------------
    if tab == "Dashboard":
        paywall()
        st.header("📊 Dashboard")
        user_row = st.session_state.get("user_row", {})
        name = user_row.get("name", "User")
        join_date = user_row.get("joined", "—")
        st.metric("📅 Member Since", join_date[:10] if join_date else "-")
        st.success("Dashboard ready! Copy your real Dashboard logic here.")


    # ---------- VOCAB TRAINER ----------
    elif tab == "Vocab Trainer":
        paywall()
        st.header("📝 Vocab Trainer")
        user_row = st.session_state.get("user_row", {})
        user_code = user_row.get("user_code", "")
        user_name = user_row.get("name", "User")
        level = "A1"  # Always A1 for now

        VOCAB_LISTS = {
            "A1": [
                ("Haus", "house"),
                ("Buch", "book"),
                ("Auto", "car"),
                ("Tisch", "table"),
                ("Hund", "dog"),
            ],
            "A2": [
                ("Flughafen", "airport"),
                ("Geschenk", "gift"),
                ("Gemüse", "vegetables"),
            ],
        }

        def save_vocab_submission(user_code, user_name, level, word, answer, is_correct):
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

        practiced = set()
        docs = db.collection("vocab_progress") \
            .where("user_code", "==", user_code) \
            .where("level", "==", level) \
            .where("is_correct", "==", True).stream()
        for doc in docs:
            practiced.add(doc.to_dict().get("word"))

        choices = [v for v in VOCAB_LISTS[level] if v[0] not in practiced]

        if not choices:
            st.success("🎉 You finished all words for this level!")
            if st.button("Reset Progress"):
                docs = db.collection("vocab_progress") \
                    .where("user_code", "==", user_code) \
                    .where("level", "==", level).stream()
                for doc in docs:
                    db.collection("vocab_progress").document(doc.id).delete()
                st.rerun()
            st.stop()

        word, correct = random.choice(choices)
        st.markdown(f"**Translate:** `{word}`")
        user_input = st.text_input("Your Answer", key=f"vocab_input_{word}")

        if st.button("Check Answer"):
            if user_input.strip().lower() == correct.lower():
                st.success("✅ Correct!")
                is_correct = True
            else:
                st.error(f"❌ Not correct. The answer is: **{correct}**")
                is_correct = False
            save_vocab_submission(user_code, user_name, level, word, user_input, is_correct)
            st.rerun()

        total = len(VOCAB_LISTS[level])
        done = len(practiced)
        st.progress(done / total, text=f"{done}/{total} mastered")

    # ---------- MY VOCAB ----------
    elif tab == "My Vocab":
        paywall()
        st.header("📓 My Vocab")
        user_row = st.session_state.get("user_row", {})
        user_code = user_row.get("user_code", "")
        user_name = user_row.get("name", "User")
        level = "A1"

        def add_my_vocab(user_code, level, word, translation):
            doc_id = f"{user_code}_{level}_{word}_{int(datetime.utcnow().timestamp())}"
            db.collection("my_vocab").document(doc_id).set({
                "user_code": user_code,
                "level": level,
                "word": word,
                "translation": translation,
                "date": datetime.utcnow().strftime("%Y-%m-%d")
            })

        def get_my_vocab(user_code, level):
            docs = db.collection("my_vocab") \
                .where("user_code", "==", user_code) \
                .where("level", "==", level).stream()
            rows = []
            for doc in docs:
                d = doc.to_dict()
                rows.append([doc.id, d.get("word", ""), d.get("translation", ""), d.get("date", "")])
            rows.sort(key=lambda x: x[3], reverse=True)
            return rows

        def delete_my_vocab(doc_id, user_code):
            db.collection("my_vocab").document(doc_id).delete()

        with st.form("add_my_vocab_form", clear_on_submit=True):
            new_word = st.text_input("German Word", key="my_vocab_word")
            new_translation = st.text_input("Translation (English or other)", key="my_vocab_translation")
            submitted = st.form_submit_button("Add to My Vocab")
            if submitted and new_word.strip() and new_translation.strip():
                add_my_vocab(user_code, level, new_word.strip(), new_translation.strip())
                st.success(f"Added '{new_word.strip()}' → '{new_translation.strip()}' to your list.")
                st.rerun()

        rows = get_my_vocab(user_code, level)
        if rows:
            for row in rows:
                col1, col2, col3 = st.columns([4, 4, 1])
                col1.markdown(f"**{row[1]}**")
                col2.markdown(f"{row[2]}")
                if col3.button("🗑️", key=f"del_{row[0]}"):
                    delete_my_vocab(row[0], user_code)
                    st.rerun()
            if st.button("📄 Download My Vocab as PDF"):
                pdf = FPDF()
                pdf.add_page()
                pdf.set_font("Arial", size=11)
                title = f"My Personal Vocab – {level} ({user_name})"
                pdf.cell(0, 8, title, ln=1)
                pdf.ln(3)
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
                    file_name=f"{user_code}_my_vocab_{level}.pdf",
                    mime="application/pdf"
                )
        else:
            st.info("No personal vocab saved yet for this level.")

    # ---------- SCHREIBEN TRAINER ----------
    elif tab == "Schreiben Trainer":
        paywall()
        st.header("✍️ Schreiben Trainer")
        user_row = st.session_state.get("user_row", {})
        user_code = user_row.get("user_code", "")
        user_name = user_row.get("name", "User")
        user_email = user_row.get("email", "")

        schreiben_levels = ["A1", "A2", "B1", "B2", "C1"]
        schreiben_level = st.selectbox("Choose your writing level:", schreiben_levels, key="schreiben_level")
        today_str = str(datetime.today().date())
        user_letter = st.text_area("Paste or type your German letter/essay here.", height=180, key="schreiben_text")

        ai_prompt = (
            f"You are Herr Felix, a supportive and innovative German letter writing trainer. "
            f"The student has submitted a {schreiben_level} German letter or essay. "
            "Write a brief comment in English about what the student did well and what they should improve while highlighting their points so they understand. "
            "Check if the letter matches their level. Talk as Herr Felix talking to a student and highlight the phrases with errors so they see it. "
            "Don't just say errors—show exactly where the mistakes are. "
            "1. Give a score out of 25 marks and always display the score clearly. "
            "2. If the score is 17 or more, write: '**Passed: You may submit to your tutor!**'. "
            "3. If the score is 16 or less, write: '**Keep improving before you submit.**'. "
            "4. Only write one of these two sentences, never both, and place it on a separate bolded line at the end of your feedback. "
            "5. Always explain why you gave the student that score based on grammar, spelling, vocabulary, coherence, etc. "
            "6. Also check for AI usage or if the student wrote with their own effort. "
            "7. List and show the phrases to improve on with tips, suggestions, and what they should do. Let the student use your suggestions to correct the letter, but don't write the full corrected letter for them. "
            "Give scores by analyzing grammar, structure, vocabulary, etc. Explain to the student why you gave that score."
        )

        if st.button("Get Feedback", type="primary", disabled=not user_letter.strip()):
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
                score_match = re.search(r"score\s*(?:[:=]|is)?\s*(\d+)\s*/\s*25", feedback, re.IGNORECASE)
                if not score_match:
                    score_match = re.search(r"Score[:\s]+(\d+)\s*/\s*25", feedback, re.IGNORECASE)
                score = int(score_match.group(1)) if score_match else 0

                db.collection("writing_submissions").add({
                    "user_code": user_code,
                    "user_name": user_name,
                    "user_email": user_email,
                    "level": schreiben_level,
                    "letter": user_letter,
                    "feedback": feedback,
                    "score": score,
                    "date": today_str,
                    "timestamp": datetime.utcnow().isoformat(),
                })

                st.markdown("---")
                st.markdown("#### 📝 Feedback from Herr Felix")
                st.markdown(feedback)

                pdf = FPDF()
                pdf.add_page()
                pdf.set_font("Arial", size=12)
                pdf.multi_cell(0, 10, f"Your Letter:\n\n{user_letter}\n\nFeedback from Herr Felix:\n\n{feedback}")
                pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
                st.download_button(
                    "⬇️ Download Feedback as PDF",
                    pdf_bytes,
                    file_name=f"Schreiben_Feedback_{user_name}_{schreiben_level}.pdf",
                    mime="application/pdf"
                )

    # ---------- EXAMS ----------
    elif tab == "Exams":
        paywall()
        st.header("🎤 Exams")
        user_row = st.session_state.get("user_row", {})
        user_code = user_row.get("user_code", "")
        user_name = user_row.get("name", "User")

        exam_levels = ["A1", "A2", "B1"]
        exam_level = st.selectbox("Choose exam level:", exam_levels, key="exam_level")
        exam_parts = {
            "A1": ["Teil 1 – Introduction", "Teil 2 – Question & Answer", "Teil 3 – Request"],
            "A2": ["Teil 1 – General Questions", "Teil 2 – Opinion/Argument", "Teil 3 – Planning"],
            "B1": ["Teil 1 – Dialogue", "Teil 2 – Monologue", "Teil 3 – Feedback/Q&A"]
        }
        exam_part = st.selectbox("Choose exam part:", exam_parts[exam_level], key="exam_part")

        if exam_level == "A1" and exam_part.startswith("Teil 1"):
            st.info("Introduce yourself: Name, Age, Country, City, Languages, Job, Hobby.")
            system_prompt = (
                "You are Herr Felix, an A1 German examiner. The student will introduce themselves. "
                "Give 3 follow-up questions, and after each student response, correct any mistakes (in English) and encourage them."
            )
        elif exam_level == "A1" and exam_part.startswith("Teil 2"):
            st.info("Ask a question using a provided topic and keyword, then answer it yourself.")
            system_prompt = (
                "You are Herr Felix, an A1 German examiner. Give the student a topic and keyword (e.g., 'Geschäft – schließen'). "
                "The student must write a question using the keyword and answer it themselves. Give short, motivating feedback after."
            )
        elif exam_level == "A1" and exam_part.startswith("Teil 3"):
            st.info("Write a polite request (e.g., 'Radio anmachen', 'Fenster zumachen').")
            system_prompt = (
                "You are Herr Felix, an A1 German examiner. The student will write a short, polite request using the given prompt. Correct errors and encourage them."
            )
        else:
            st.info("Practice exam questions at your level. The AI will simulate an examiner and give you feedback.")
            system_prompt = (
                "You are Herr Felix, a German exam trainer for oral exams. Respond as an examiner, "
                "giving questions and instant feedback to the student. Be supportive and correct mistakes in English."
            )

        if "exam_chat" not in st.session_state:
            st.session_state["exam_chat"] = []

        if st.button("Restart Exam Chat"):
            st.session_state["exam_chat"] = []

        for msg in st.session_state["exam_chat"]:
            who = "🧑‍🏫 Herr Felix" if msg["role"] == "assistant" else "🧑 Student"
            st.markdown(f"**{who}:** {msg['content']}")

        user_msg = st.text_input("Your answer / introduction...", key="exam_input")
        if st.button("Send", disabled=not user_msg.strip()):
            st.session_state["exam_chat"].append({"role": "user", "content": user_msg.strip()})
            with st.spinner("Herr Felix is thinking..."):
                try:
                    messages = [{"role": "system", "content": system_prompt}] + st.session_state["exam_chat"]
                    resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages,
                        temperature=0.4,
                        max_tokens=300
                    )
                    ai_reply = resp.choices[0].message.content.strip()
                except Exception as e:
                    ai_reply = f"AI error: {e}"
            st.session_state["exam_chat"].append({"role": "assistant", "content": ai_reply})
            st.rerun()

        if st.session_state["exam_chat"]:
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            for m in st.session_state["exam_chat"]:
                who = "Herr Felix" if m["role"] == "assistant" else "Student"
                pdf.multi_cell(0, 8, f"{who}: {m['content']}\n")
            pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
            st.download_button(
                "⬇️ Download Exam Practice as PDF",
                pdf_bytes,
                file_name=f"Exam_Practice_{user_name}_{exam_level}.pdf",
                mime="application/pdf"
            )

    # ---------- CUSTOM CHAT ----------
    elif tab == "Custom Chat":
        paywall()
        st.header("💬 Freestyle Conversation with Herr Felix (AI)")
        st.info("Practice any German conversation. Herr Felix will reply, correct, and help you improve. Use this tab to prepare for anything!")

        user_row = st.session_state.get("user_row", {})
        user_name = user_row.get("name", "User")

        if "custom_chat" not in st.session_state:
            st.session_state["custom_chat"] = []

        if st.button("Reset Custom Chat"):
            st.session_state["custom_chat"] = []

        for msg in st.session_state["custom_chat"]:
            who = "🧑‍🏫 Herr Felix" if msg["role"] == "assistant" else "🧑 Student"
            st.markdown(f"**{who}:** {msg['content']}")

        custom_input = st.text_input("Type your message or start a conversation...", key="custom_input")
        if st.button("Send", key="custom_send", disabled=not custom_input.strip()):
            st.session_state["custom_chat"].append({"role": "user", "content": custom_input.strip()})

            system_prompt = (
                "You are Herr Felix, an expert German teacher and conversation partner. "
                "Reply to the student's German message. If there are mistakes, correct them and give a clear explanation in English. "
                "Encourage the student, suggest better phrases, and keep the conversation interactive. "
                "Never just translate—always keep the conversation in German with English feedback if needed."
            )
            messages = [{"role": "system", "content": system_prompt}] + st.session_state["custom_chat"]

            with st.spinner("Herr Felix is thinking..."):
                try:
                    resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages,
                        temperature=0.5,
                        max_tokens=400
                    )
                    reply = resp.choices[0].message.content
                except Exception as e:
                    reply = f"AI error: {e}"

            st.session_state["custom_chat"].append({"role": "assistant", "content": reply})
            st.rerun()

        if st.session_state["custom_chat"]:
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            for m in st.session_state["custom_chat"]:
                who = "Herr Felix" if m["role"] == "assistant" else "Student"
                pdf.multi_cell(0, 8, f"{who}: {m['content']}\n")
            pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
            st.download_button(
                "⬇️ Download Chat as PDF",
                pdf_bytes,
                file_name=f"Custom_Chat_{user_name}.pdf",
                mime="application/pdf"
            )


    # Grammar Helper
    elif tab == "Grammar Helper":
        paywall()
        st.header("📚 Grammar Helper")
        st.info("Ask any German grammar question below. Herr Felix will answer clearly in English with examples.")

        user_row = st.session_state.get("user_row", {})
        user_name = user_row.get("name", "User")

        # Chat history in session state
        if "grammar_chat" not in st.session_state:
            st.session_state["grammar_chat"] = []

        if st.button("Reset Grammar Chat"):
            st.session_state["grammar_chat"] = []

        # Show conversation history
        for msg in st.session_state["grammar_chat"]:
            who = "🧑‍🏫 Herr Felix" if msg["role"] == "assistant" else "🧑 Student"
            st.markdown(f"**{who}:** {msg['content']}")

        grammar_input = st.text_input("Ask any grammar question...", key="grammar_input")
        if st.button("Send", key="grammar_send", disabled=not grammar_input.strip()):
            st.session_state["grammar_chat"].append({"role": "user", "content": grammar_input.strip()})

            system_prompt = (
                "You are Herr Felix, a friendly and expert German grammar teacher. "
                "Answer every question in clear, simple English. "
                "Always give a practical example, and explain step-by-step for beginners. "
                "Never switch to German in your explanations."
            )
            messages = [{"role": "system", "content": system_prompt}] + st.session_state["grammar_chat"]

            with st.spinner("Herr Felix is thinking..."):
                try:
                    resp = client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages,
                        temperature=0.25,
                        max_tokens=400
                    )
                    answer = resp.choices[0].message.content
                except Exception as e:
                    answer = f"Sorry, something went wrong: {e}"

            st.session_state["grammar_chat"].append({"role": "assistant", "content": answer})
            st.rerun()

        # Download chat as PDF
        if st.session_state["grammar_chat"]:
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            for m in st.session_state["grammar_chat"]:
                who = "Herr Felix" if m["role"] == "assistant" else "Student"
                pdf.multi_cell(0, 8, f"{who}: {m['content']}\n")
            pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
            st.download_button(
                "⬇️ Download Chat as PDF",
                pdf_bytes,
                file_name=f"Grammar_Chat_{user_name}.pdf",
                mime="application/pdf"
            )


