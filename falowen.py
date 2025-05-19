import streamlit as st
from openai import OpenAI
import random
import re
import json
import os
import hashlib

# --- Secure API key ---
api_key = st.secrets.get("general", {}).get("OPENAI_API_KEY")
if not api_key:
    st.error("❌ API key not found. Add it to .streamlit/secrets.toml under [general]")
    st.stop()
client = OpenAI(api_key=api_key)

# --- Page setup ---
st.set_page_config(
    page_title="Falowen – Your AI Conversation Partner",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# --- Hide Streamlit branding ---
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
def save_users(users):
    with open(USER_DB, "w") as f:
        json.dump(users, f)

# --- Simple Email + Password Auth ---
if "user_email" not in st.session_state:
    st.title("🔐 Sign Up / Log In")
    auth_mode = st.radio("", ["Sign Up", "Log In"])
    users = load_users()
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")

    if auth_mode == "Sign Up":
        confirm = st.text_input("Confirm Password", type="password")
        if st.button("Sign Up"):
            if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
                st.error("Enter a valid email address.")
            elif email in users:
                st.error("Email already registered. Please log in.")
            elif password != confirm:
                st.error("Passwords do not match.")
            else:
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                users[email] = pw_hash
                save_users(users)
                st.success("Registration successful! You can now log in.")
    else:
        if st.button("Log In"):
            if email not in users:
                st.error("No account found. Please sign up.")
            elif hashlib.sha256(password.encode()).hexdigest() != users.get(email, ""):
                st.error("Incorrect password.")
            else:
                st.session_state["user_email"] = email
                st.success(f"Logged in as {email}")
                st.stop()
    st.stop()

# --- Tutor definitions ---
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

# --- Predefined Role-play Scenarios ---
roleplays = {
    "Ordering at a Restaurant": {...},
    "Checking into a Hotel": {...},
    "Asking for Directions": {...},
    "Shopping for Clothes": {...},
    "Making a Doctor's Appointment": {...},
    "Booking Travel Tickets": {...}
}

# --- Initialize messages ---
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# --- Controls ---
language = st.selectbox("Select Language", list(tutors.keys()), index=list(tutors.keys()).index("English"))
tutor = tutors[language]
level = st.selectbox("Select Level", ["A1","A2","B1","B2","C1"], index=0)

# --- Conversation Mode: Free Talk or Scenario ---
options = ["Free Talk"] + list(roleplays.keys())
mode = st.selectbox("Conversation Mode", options)
scenario_prompt = "" if mode == "Free Talk" else roleplays[mode][language]

# --- App Header ---
hdr = f"Practice {language} ({level}) " + ("free conversation" if mode == "Free Talk" else f"role-play: {scenario_prompt}")
st.markdown(f"<h1>{hdr}</h1>", unsafe_allow_html=True)

# --- Chat Interface ---
for msg in st.session_state["messages"]:
    avatar = "🧑‍🏫" if msg["role"] == 'assistant' else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])

prompt = f"💬 {scenario_prompt if scenario_prompt else 'Talk to your tutor'}"
user_input = st.chat_input(prompt)
if user_input:
    st.session_state["messages"].append({"role": "user", "content": user_input})
    st.chat_message("user").markdown(user_input)
    sys_prompt = (
        f"You are {tutor}, a friendly {language} tutor at level {level}. " +
        ("Engage in free conversation." if mode == "Free Talk" else f"Role-play scenario: {scenario_prompt}.")
    )
    msgs = [{"role": "system", "content": sys_prompt}] + st.session_state["messages"]
    try:
        response = client.chat.completions.create(model="gpt-3.5-turbo", messages=msgs)
        ai = response.choices[0].message.content
    except Exception as e:
        ai = "Sorry, there was a problem generating a response."
        st.error(str(e))
    st.session_state["messages"].append({"role": "assistant", "content": ai})
    st.chat_message("assistant", avatar="🧑‍🏫").markdown(f"**{tutor}:** {ai}")

    # Grammar check
gram = (
    f"You are {tutor}, a helpful {language} teacher at level {level}. Check and correct: {user_input}"
)
try:
    gresp = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "system", "content": gram}],
        max_tokens=120
    )
    st.info(gresp.choices[0].message.content)
except:
    pass

# --- Share on WhatsApp ---
share = f"I just practiced {language} with {tutor}!"
st.markdown(f'<a href="https://wa.me/?text={share.replace(" ","%20")}" target="_blank">Share on WhatsApp 🚀</a>', unsafe_allow_html=True)
