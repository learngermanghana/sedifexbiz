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

# --- User and Usage Helpers ---
USER_DB = "users.json"
USAGE_FILE = "usage.csv"

def load_users():
    if os.path.exists(USER_DB):
        return json.load(open(USER_DB))
    return {}

def save_users(users):
    json.dump(users, open(USER_DB, "w"))

def load_usage():
    try:
        return pd.read_csv(USAGE_FILE, parse_dates=["date"])
    except FileNotFoundError:
        return pd.DataFrame(columns=["user_email","date","count"])

def save_usage(df):
    df.to_csv(USAGE_FILE, index=False)

# --- Authentication ---
if "user_email" not in st.session_state:
    st.sidebar.title("🔐 Sign Up / Log In")
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
                st.sidebar.error("Email already registered.")
            elif password != confirm:
                st.sidebar.error("Passwords do not match.")
            else:
                users[email] = hashlib.sha256(password.encode()).hexdigest()
                save_users(users)
                st.sidebar.success("Account created! Please log in.")
    else:
        if st.sidebar.button("Log In"):
            if email not in users:
                st.sidebar.error("No account found.")
            elif users[email] != hashlib.sha256(password.encode()).hexdigest():
                st.sidebar.error("Incorrect password.")
            else:
                st.session_state["user_email"] = email
                st.experimental_rerun()
    st.stop()

# --- Sidebar Profile & Settings ---
st.sidebar.markdown(f"**Logged in as:** {st.session_state['user_email']}")
if st.sidebar.button("🔓 Log out"):
    del st.session_state["user_email"]
    st.experimental_rerun()

# Load usage
usage_df = load_usage()

def increment_usage():
    today = pd.Timestamp(datetime.now().date())
    mask = (usage_df.user_email == st.session_state['user_email']) & (usage_df.date == today)
    if not mask.any():
        usage_df.loc[len(usage_df)] = [st.session_state['user_email'], today, 0]
    idx = usage_df.index[mask][0] if mask.any() else len(usage_df)-1
    usage_df.at[idx, 'count'] += 1
    save_usage(usage_df)

# Tutor definitions & scenarios
tutors = {"German":"Herr Felix","French":"Madame Dupont","English":"Sir Felix","Spanish":"Señora García","Italian":"Signor Rossi","Portuguese":"Senhora Silva","Chinese":"老师李","Arabic":"الأستاذ أحمد"}
roleplays = {key: {...} for key in ["Ordering at a Restaurant","Checking into a Hotel","Asking for Directions","Shopping for Clothes","Making a Doctor's Appointment","Booking Travel Tickets"]}

# Initialize chat
if 'messages' not in st.session_state:
    st.session_state['messages'] = []

# Sidebar controls
language = st.sidebar.selectbox("Language", list(tutors.keys()), index=2)
level = st.sidebar.selectbox("Level", ["A1","A2","B1","B2","C1"], index=0)
mode = st.sidebar.selectbox("Mode", ["Free Talk"] + list(roleplays.keys()))

# Tutor, scenario prompt
tutor = tutors[language]
scenario_prompt = '' if mode=='Free Talk' else roleplays[mode][language]

# Main headers
st.markdown("<h1 style='font-size:2.4em;'>🌟 Falowen – Your AI Conversation Partner</h1>", unsafe_allow_html=True)
st.markdown(f"<h2>Practice {language} ({level}) {'free conversation' if not scenario_prompt else 'role-play: '+scenario_prompt}</h2>", unsafe_allow_html=True)

# Fun fact carousel
if 'fact_idx' not in st.session_state: st.session_state['fact_idx']=0
facts = [f"{tutor} speaks multiple languages!", f"{tutor} loves teaching.", f"{tutor}'s favorite word is possibility!", f"{tutor} stays alert with virtual coffee."]
st.sidebar.markdown(facts[st.session_state['fact_idx']])
if st.sidebar.button('🔃 Next Fact'):
    st.session_state['fact_idx'] = (st.session_state['fact_idx']+1)%len(facts)

# Chat container
st.markdown("<div class='chat-container'>", unsafe_allow_html=True)
for msg in st.session_state['messages']:
    avatar = '🧑‍🏫' if msg['role']=='assistant' else None
    with st.chat_message(msg['role'], avatar=avatar): st.markdown(msg['content'])
st.markdown("</div>", unsafe_allow_html=True)

# Chat input & response
user_input = st.chat_input(f"💬 {scenario_prompt or 'Talk to your tutor'}")
if user_input:
    increment_usage()
    st.session_state['messages'].append({'role':'user','content':user_input})
    st.chat_message('user').markdown(user_input)
    sys = f"You are {tutor}, a friendly {language} tutor at level {level}. " + ("Engage freely." if not scenario_prompt else f"Role-play: {scenario_prompt}.")
    msgs = [{'role':'system','content':sys}] + st.session_state['messages']
    with st.spinner("Sir Felix is thinking…"):
        try: reply=client.chat.completions.create(model='gpt-3.5-turbo', messages=msgs).choices[0].message.content
        except: reply="Sorry, there was a problem."
    st.session_state['messages'].append({'role':'assistant','content':reply})
    st.chat_message('assistant', avatar='🧑‍🏫').markdown(f"**{tutor}:** {reply}")
    # Grammar check
    gm=[{'role':'system','content':f"You are {tutor}, a helpful {language} teacher at level {level}. Check and correct: "},{'role':'user','content':user_input}]
    try: gresp=client.chat.completions.create(model='gpt-3.5-turbo',messages=gm,max_tokens=150); st.info(gresp.choices[0].message.content)
    except: st.error("Grammar check failed.")

# Gamification
today=pd.Timestamp(datetime.now().date())
mask=(usage_df.user_email==st.session_state['user_email'])&(usage_df.date==today)
count=int(usage_df.loc[mask,'count'].iloc[0]) if mask.any() else 0
prog=min(count/10,1)
st.progress(prog)
st.caption(f"{count}/10 messages today")
if count in [5,10]: st.balloons()

# Share button
share=f"I just practiced {language} with {tutor}!"
st.markdown(f'<a href="https://wa.me/?text={share.replace(" ","%20")}" target="_blank"><button style="width:100%;padding:10px;border:none;border-radius:8px;background:#25D366;color:white;">Share on WhatsApp 🚀</button></a>', unsafe_allow_html=True)
