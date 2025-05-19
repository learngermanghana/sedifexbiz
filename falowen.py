import streamlit as st
from openai import OpenAI
import random
import re

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

# --- Simple Email Login ---
if "user_email" not in st.session_state:
    st.title("🔐 Login with Email")
    email_input = st.text_input("Enter your email to continue:")
    if st.button("Login"):
        if re.match(r"[^@]+@[^@]+\.[^@]+", email_input):
            st.session_state["user_email"] = email_input
            st.success(f"Logged in as {email_input}")
            st.stop()
        else:
            st.error("Please enter a valid email address.")
    st.stop()

# --- Tutor definitions ---
tutors = {
    "German": "Herr Felix",
    "French": "Madame Dupont",
    "English": "Mr. Smith",
    "Spanish": "Señora García",
    "Italian": "Signor Rossi",
    "Portuguese": "Senhora Silva",
    "Chinese": "老师李",
    "Arabic": "الأستاذ أحمد"
}

# --- Role-play scenarios ---
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
language = st.selectbox("Select Language", list(tutors.keys()), index=2)
tutor = tutors[language]
level = st.selectbox("Select Level", ["A1","A2","B1","B2","C1"], index=0)

# --- Conversation mode: Free Talk, Predefined, Custom ---
options = ["Free Talk"] + list(roleplays.keys()) + ["Custom Topic"]
mode = st.selectbox("Conversation Mode", options)
if mode == "Free Talk":
    scenario_prompt = ""
elif mode == "Custom Topic":
    custom = st.text_input("Enter custom topic or mood:")
    if not custom.strip():
        st.warning("Enter a custom topic.")
        st.stop()
    scenario_prompt = custom.strip()
else:
    scenario_prompt = roleplays[mode][language]

# --- Header ---
hdr_text = (
    f"Practice {language} ({level}) " +
    ("free conversation" if mode == "Free Talk" else f"role-play: {scenario_prompt}")
)
st.markdown(f"<h1>{hdr_text}</h1>", unsafe_allow_html=True)

# --- Tips & challenges (omitted for brevity) ---
# ...

# --- Chat Interface ---
for msg in st.session_state["messages"]:
    avatar = "🧑‍🏫" if msg["role"] == 'assistant' else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])

prompt = f"💬 {scenario_prompt if scenario_prompt else 'Talk to Sir Felix'}"
user_input = st.chat_input(prompt)
if user_input:
    st.session_state["messages"].append({"role": "user", "content": user_input})
    st.chat_message("user").markdown(user_input)
    system_prompt = (
        f"You are {tutor}, a friendly {language} tutor for level {level}. " +
        ("Engage in free conversation." if mode == "Free Talk" else f"Role-play scenario: {scenario_prompt}.")
    )
    messages = [{"role": "system", "content": system_prompt}] + st.session_state["messages"]
    try:
        response = client.chat.completions.create(model="gpt-3.5-turbo", messages=messages)
        ai_reply = response.choices[0].message.content
    except Exception as e:
        ai_reply = "Sorry, there was a problem generating a response."
        st.error(str(e))
    st.session_state["messages"].append({"role": "assistant", "content": ai_reply})
    st.chat_message("assistant", avatar="🧑‍🏫").markdown(f"**{tutor}:** {ai_reply}")

    # Grammar check
    grammar_prompt = (
        f"You are {tutor}, a helpful {language} teacher for level {level}. "
        f"Check this sentence for errors and provide correction: {user_input}"
    )
    try:
        gram_resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": grammar_prompt}],
            max_tokens=120
        )
        st.info(gram_resp.choices[0].message.content)
    except:
        pass

# --- Share on WhatsApp ---
share_text = f"I just practiced {language} with {tutor}!"
st.markdown(
    f'<a href="https://wa.me/?text={share_text.replace(" ","%20")}" target="_blank">'
    'Share on WhatsApp 🚀</a>', unsafe_allow_html=True
)
