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

# --- Page config and branding removal ---
st.set_page_config(page_title="Falowen – Your AI Conversation Partner", layout="wide")
st.markdown(
    """
    <style>
      #MainMenu {visibility: hidden;}
      footer {visibility: hidden;}
      header {visibility: hidden;}
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
    st.title("🔐 Sign Up or Log In")
    mode = st.radio("", ["Sign Up", "Log In"])
    users = load_users()
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")
    if mode == "Sign Up":
        confirm = st.text_input("Confirm Password", type="password")
        if st.button("Create Account"):
            if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
                st.error("Enter a valid email address.")
            elif email in users:
                st.error("Email already registered. Please log in.")
            elif password != confirm:
                st.error("Passwords do not match.")
            else:
                users[email] = hashlib.sha256(password.encode()).hexdigest()
                save_users(users)
                st.success("Account created! You can now log in.")
    else:
        if st.button("Log In"):
            if email not in users:
                st.error("No account found. Please sign up.")
            elif users[email] != hashlib.sha256(password.encode()).hexdigest():
                st.error("Incorrect password.")
            else:
                st.session_state["user_email"] = email
                st.success(f"Logged in as {email}")
                st.stop()
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

# --- Initialize chat history ---
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# --- Controls ---
language = st.selectbox("Select Language", list(tutors.keys()))
tutor = tutors[language]
level = st.selectbox("Select Level", ["A1","A2","B1","B2","C1"])
mode = st.selectbox("Conversation Mode", ["Free Talk"] + list(roleplays.keys()))
scenario_prompt = "" if mode == "Free Talk" else roleplays[mode][language]

# --- Header ---
# App Name
st.markdown(
    "<h1 style='font-size:2.4em; margin-bottom:0.2em;'>🌟 Falowen – Your AI Conversation Partner</h1>",
    unsafe_allow_html=True
)
hdr = f"Practice {language} ({level}) " + ("free conversation" if not scenario_prompt else f"role-play: {scenario_prompt}")
st.markdown(f"<h1>{hdr}</h1>", unsafe_allow_html=True)

# --- Fun Tutor Fact ---
tutor_facts = [
    f"{tutor} speaks German, French, English, and more!",
    f"{tutor} believes that every mistake is a step to mastery.",
    f"{tutor}’s favorite word is 'possibility'.",
    f"{tutor} drinks a lot of virtual coffee to stay alert for your questions!",
    f"{tutor} once helped 100 students in a single day.",
    f"{tutor} loves puns and language jokes. Ask {tutor} one!"
]
st.info(f"🧑‍🏫 Did you know? {random.choice(tutor_facts)}")

# --- Chat Interface ---
for msg in st.session_state["messages"]:
    avatar = "🧑‍🏫" if msg["role"] == 'assistant' else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])

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
    try:
        res = client.chat.completions.create(model="gpt-3.5-turbo", messages=msgs)
        reply = res.choices[0].message.content
    except Exception:
        reply = "Sorry, there was a problem generating a response."
    st.session_state["messages"].append({"role":"assistant","content":reply})
    st.chat_message("assistant", avatar="🧑‍🏫").markdown(f"**{tutor}:** {reply}")
    # Grammar check
    grammar_system = (
        f"You are {tutor}, a helpful {language} teacher at level {level}. "
        f"Check the following user sentence for grammar, spelling, and phrasing errors. "
        f"Provide the corrected sentence and a brief explanation."
    )
    grammar_messages = [
        {"role": "system", "content": grammar_system},
        {"role": "user", "content": user_input}
    ]
    try:
        gram_resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=grammar_messages,
            max_tokens=150
        )
        correction = gram_resp.choices[0].message.content.strip()
        st.info(f"📝 **Correction by {tutor}:**\n{correction}")
    except Exception as e:
        st.warning("Grammar check failed. Please try again later.")

# --- Gamification ---
# Use safe lookup for today's count
today = pd.Timestamp(datetime.now().date())
mask = (usage_df["user_email"] == st.session_state["user_email"]) & (usage_df["date"] == today)
count_today = int(usage_df.loc[mask, "count"].iloc[0]) if mask.any() else 0
msg = ""
if count_today == 0:
    msg = "🎉 Welcome back! Start practicing."
elif count_today in [5, 10]:
    msg = f"🌟 {count_today} messages today! Great work."
if msg:
    st.success(msg)

# --- Share on WhatsApp ---
share = f"I just practiced {language} with {tutor}!"
st.markdown(f'<a href="https://wa.me/?text={share.replace(" ","%20")}" target="_blank">Share on WhatsApp 🚀</a>', unsafe_allow_html=True)
