import streamlit as st
from openai import OpenAI
import random
import re
import json
import os
import hashlib
import pandas as pd
from datetime import datetime, timedelta
import uuid

# --- Secure API key ---
api_key = st.secrets.get("general", {}).get("OPENAI_API_KEY")
if not api_key:
    st.error("❌ API key not found. Add it to .streamlit/secrets.toml under [general]")
    st.stop()
client = OpenAI(api_key=api_key)

# --- Page config and theming ---
st.set_page_config(
    page_title="Falowen – Your AI Conversation Partner",
    layout="wide",
    initial_sidebar_state="expanded"
)
st.markdown(
    """
    <style>
      /* Hide default Streamlit branding */
      #MainMenu {visibility: hidden;}
      footer {visibility: hidden;}
      header {visibility: hidden;}
      /* Scrollable chat container */
      .chat-container {height: 60vh; overflow-y: auto;}
    </style>
    """,
    unsafe_allow_html=True
)

# --- User Database Helpers ---
USER_DB = "users.json"
def load_users():
    if os.path.exists(USER_DB):
        with open(USER_DB, "r") as f:
            return json.load(f)
    return {}

def save_users(u):
    with open(USER_DB, "w") as f:
        json.dump(u, f)

# --- Usage Tracking Helpers ---
USAGE_FILE = "usage.csv"
def load_usage():
    try:
        df = pd.read_csv(USAGE_FILE, parse_dates=["date"])
    except FileNotFoundError:
        df = pd.DataFrame(columns=["user_email","date","count"])
    return df
def save_usage(df):
    df.to_csv(USAGE_FILE, index=False)

# --- Authentication: Sign Up / Log In ---
if "user_email" not in st.session_state:
    st.sidebar.title("🔐 Sign Up or Log In")
    mode = st.sidebar.radio("", ["Sign Up", "Log In"])
    users = load_users()
    email = st.sidebar.text_input("Email")
    password = st.sidebar.text_input("Password", type="password")
    if mode == "Sign Up":
        confirm = st.sidebar.text_input("Confirm Password", type="password")
        if st.sidebar.button("Create Account"):
            if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
                st.sidebar.error("Enter a valid email address.")
            elif email in users:
                st.sidebar.error("Email already registered. Please log in.")
            elif password != confirm:
                st.sidebar.error("Passwords do not match.")
            else:
                users[email] = hashlib.sha256(password.encode()).hexdigest()
                save_users(users)
                st.sidebar.success("Account created! You can now log in.")
    else:
        if st.sidebar.button("Log In"):
            if email not in users:
                st.sidebar.error("No account found. Please sign up.")
            elif users[email] != hashlib.sha256(password.encode()).hexdigest():
                st.sidebar.error("Incorrect password.")
            else:
                st.session_state["user_email"] = email
                st.sidebar.success(f"Logged in as {email}")
                st.stop()
    st.stop()

# --- Sidebar: User Profile & Logout ---
st.sidebar.markdown(f"**Logged in as:** {st.session_state['user_email']}")
if st.sidebar.button("🔓 Log out"):
    del st.session_state["user_email"]
    st.stop()

# --- Load usage after login ---
usage_df = load_usage()

def increment_usage():
    today = pd.Timestamp(datetime.now().date())
    mask = (usage_df["user_email"] == st.session_state["user_email"]) & (usage_df["date"] == today)
    if not mask.any():
        usage_df.loc[len(usage_df)] = [st.session_state["user_email"], today, 0]
    idx = usage_df.index[mask][0] if mask.any() else len(usage_df) - 1
    usage_df.at[idx, "count"] += 1
    save_usage(usage_df)

# --- Tutor definitions and scenarios ---
tutors = {
    "German": "Herr Felix",
    "French": "Madame Dupont",
    "English": "Sir Felix",
    "Spanish": "Señora García",
    "Italian": "Signor Rossi",
    "Portuguese": "Senhora Silva",
    "Chinese": "老师李",
    "Arabic": "الأستاذ أحمد"
}
roleplays = {
    "Ordering at a Restaurant": {...},
    "Checking into a Hotel": {...},
    "Asking for Directions": {...},
    "Shopping for Clothes": {...},
    "Making a Doctor's Appointment": {...},
    "Booking Travel Tickets": {...}
}

# --- Initialize chat history & fact index ---
if "messages" not in st.session_state:
    st.session_state["messages"] = []
if "fact_idx" not in st.session_state:
    st.session_state["fact_idx"] = 0

# --- Sidebar Settings ---
st.sidebar.header("Settings")
language = st.sidebar.selectbox("Language", list(tutors.keys()), index=list(tutors.keys()).index("English"))
level = st.sidebar.selectbox("Level", ["A1","A2","B1","B2","C1"])
mode = st.sidebar.selectbox("Mode", ["Free Talk"] + list(roleplays.keys()))

# --- UI: Fact Carousel ---
tutor = tutors[language]
facts = [
    f"{tutor} speaks several languages!",
    f"{tutor} thinks every mistake is progress.",
    f"{tutor}’s favorite word is 'possibility'.",
    f"{tutor} energizes on virtual coffee!",
    f"{tutor} helped 100 students in one day.",
    f"{tutor} loves language jokes. Ask away!"
]
if st.sidebar.button("🔃 Next Fact"):
    st.session_state["fact_idx"] = (st.session_state["fact_idx"] + 1) % len(facts)
st.sidebar.info(facts[st.session_state["fact_idx"]])

tutor = tutors[language]
scenario_prompt = "" if mode == "Free Talk" else roleplays[mode][language]

# --- Main Header ---
st.markdown("<h1 style='font-size:2.4em;'>🌟 Falowen – Your AI Conversation Partner</h1>", unsafe_allow_html=True)
st.markdown(f"<h2>Practice {language} ({level}) {'free conversation' if not scenario_prompt else 'role-play: '+scenario_prompt}</h2>", unsafe_allow_html=True)

# --- Chat Container ---
st.markdown("<div class='chat-container'>", unsafe_allow_html=True)
for msg in st.session_state["messages"]:
    avatar = "🧑‍🏫" if msg["role"] == 'assistant' else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])
st.markdown("</div>", unsafe_allow_html=True)

# --- Chat Input & Spinner ---
user_input = st.chat_input(f"💬 {scenario_prompt or 'Talk to your tutor'}")
if user_input:
    increment_usage()
    st.session_state["messages"].append({"role":"user","content":user_input})
    st.chat_message("user").markdown(user_input)
    sys_prompt = (
        f"You are {tutor}, a friendly {language} tutor at level {level}. " +
        ("Engage in free conversation." if not scenario_prompt else f"Role-play scenario: {scenario_prompt}.")
    )
    msgs = [{"role":"system","content":sys_prompt}] + st.session_state["messages"]
    with st.spinner("Sir Felix is thinking…"):
        try:
            res = client.chat.completions.create(model="gpt-3.5-turbo", messages=msgs)
            reply = res.choices[0].message.content
        except Exception:
            reply = "Sorry, there was a problem generating a response."
    st.session_state["messages"].append({"role":"assistant","content":reply})
    st.chat_message("assistant", avatar="🧑‍🏫").markdown(f"**{tutor}:** {reply}")
    # Grammar check
    grammar_messages = [
        {"role": "system", "content":
            f"You are {tutor}, a helpful {language} teacher at level {level}."
            " Check and correct the following sentence, provide fix and brief explanation."},
        {"role": "user", "content": user_input}
    ]
    try:
        g = client.chat.completions.create(model="gpt-3.5-turbo", messages=grammar_messages, max_tokens=150)
        st.info(g.choices[0].message.content)
    except:
        st.error("Grammar check failed.")

# --- Gamification with Progress Bar & Confetti ---
count_today = int(usage_df[(usage_df["user_email"]==st.session_state["user_email"])&(usage_df["date"]==pd.Timestamp(datetime.now().date()))]["count"].iloc[0]) if ((usage_df["user_email"]==st.session_state["user_email"])&(usage_df["date"]==pd.Timestamp(datetime.now().date()))).any() else 0
progress = min(count_today/10,1.0)
bar = st.progress(progress)
st.caption(f"{count_today}/10 messages today")
if count_today in [5,10]:
    st.balloons()

# --- Share on WhatsApp (full width) ---
share = f"I just practiced {language} with {tutor}!"
st.markdown(f'<a href="https://wa.me/?text={share.replace(" ","%20")}" target="_blank"><button style="width:100%;padding:10px;border:none;border-radius:8px;background:#25D366;color:white;font-size:16px;">Share on WhatsApp 🚀</button></a>', unsafe_allow_html=True)
