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
      footer    {visibility: hidden;}
      header    {visibility: hidden;}
    </style>
    """,
    unsafe_allow_html=True
)

# --- Logout Control ---
if st.sidebar.button("Logout"):
    st.session_state.pop("user_email", None)
    st.experimental_rerun()

# --- Email Login ---
if "user_email" not in st.session_state:
    st.title("🔐 Login with Email")
    email_input = st.text_input("Enter your email to continue:")
    if st.button("Login"):
        if re.match(r"[^@]+@[^@]+\.[^@]+", email_input):
            st.session_state["user_email"] = email_input
            st.success(f"Logged in as {email_input}")
        else:
            st.error("Please enter a valid email address.")
    st.stop()

# --- Tutor names per language ---
tutors = {
    "German":     "Herr Felix",
    "French":     "Madame Dupont",
    "English":    "Mr. Smith",
    "Spanish":    "Señora García",
    "Italian":    "Signor Rossi",
    "Portuguese": "Senhora Silva",
    "Chinese":    "老师李",
    "Arabic":     "الأستاذ أحمد"
}

# --- Expanded Role-play Scenarios per language ---
roleplays = {
    # ... existing scenarios dict ...
}

# --- Session State for Messages ---
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# --- Controls ---
language = st.selectbox(
    "Select Language",
    list(tutors.keys()),
    index=list(tutors.keys()).index("English")
)
level = st.selectbox(
    "Select Level",
    ["A1", "A2", "B1", "B2", "C1"],
    index=0
)
tutor = tutors[language]

# Scenario selector with custom option
def get_scenario_prompt():
    options = list(roleplays.keys()) + ["Custom Topic"]
    sel = st.selectbox("Choose Role-play Scenario or Custom Topic", options)
    if sel == "Custom Topic":
        custom = st.text_input("Enter your custom role-play topic or mood:")
        if not custom.strip():
            st.warning("Please enter a custom topic.")
            st.stop()
        return sel, custom.strip()
    else:
        return sel, roleplays[sel][language]

scenario, scenario_prompt = get_scenario_prompt()

# --- App Header ---
st.markdown(
    f"""
    <h1 style='font-size:2.4em; margin-bottom: 0.2em;'>🌟 Falowen – {scenario} with {tutor}</h1>
    <div style='font-size:1.1em; margin-bottom: 1em; color:#446;'>Practice {language} ({level}) role-play: <em>{scenario_prompt}</em></div>
    """,
    unsafe_allow_html=True
)

# --- Tips & Challenges (unchanged) ---
# ... existing tips, facts, challenges ...

# --- Settings: Grammar Toggle ---
with st.expander("⚙️ Settings", expanded=False):
    grammar_feedback = st.checkbox("Enable grammar feedback", value=True)

# --- Chat Input with Scenario Hint ---
user_input = st.chat_input(f"💬 {scenario_prompt}...")
if user_input:
    # Append and trim messages
    st.session_state["messages"].append({"role": "user", "content": user_input})
    if len(st.session_state["messages"]) > 50:
        st.session_state["messages"] = st.session_state["messages"][-50:]
    st.chat_message("user").markdown(user_input)

    # AI Response
    conversation = [
        {"role": "system", "content":
            f"You are {tutor}, a friendly {language} tutor at level {level}."
            f" Role-play scenario: {scenario_prompt}. Engage accordingly."
        }, *st.session_state["messages"]
    ]
    try:
        res = client.chat.completions.create(model="gpt-3.5-turbo", messages=conversation)
        ai_reply = res.choices[0].message.content
    except Exception as e:
        ai_reply = "Sorry, problem generating response."
        st.error(str(e))

    st.session_state["messages"].append({"role": "assistant", "content": ai_reply})
    with st.chat_message("assistant", avatar="🧑‍🏫"):
        st.markdown(f"**{tutor}:** {ai_reply}")

    # Optional Grammar Check
    if grammar_feedback:
        grammar_prompt = (f"You are {tutor}, a helpful {language} teacher at level {level}."
                          f" Check this sentence for errors, give a correction and brief explanation:\n\n{user_input}")
        try:
            gram = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "system", "content": grammar_prompt}],
                max_tokens=120
            )
            st.info(f"📝 **Correction by {tutor}:**\n{gram.choices[0].message.content.strip()}")
        except:
            st.warning("Grammar check failed.")

# --- Share on WhatsApp & Copy Link ---
share_text = f"I practiced '{scenario}' in {language} ({level}) with {tutor}!"
share_url = f'https://wa.me/?text={share_text.replace(' ', '%20')}'
st.markdown(
    f'<a href="{share_url}" target="_blank">'
    '<button style="background:#25D366;color:white;padding:7px 14px;'
    'border:none;border-radius:6px;margin-top:10px;font-size:1em;">Share on WhatsApp 🚀</button></a>'
    '<button onClick="navigator.clipboard.writeText(\"{share_text}\")" '
    'style="margin-left:10px;padding:7px 14px;border-radius:6px;">Copy Share Text</button>',
    unsafe_allow_html=True
)
