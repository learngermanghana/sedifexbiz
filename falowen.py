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
      /* Hide Streamlit watermark and hosting badge */
      a[href^="https://streamlit.io"] {display: none !important;}
      [class*="viewerBadge"] {visibility: hidden !important;}
      /* Scrollable chat container */
      .chat-container {height: 60vh; overflow-y: auto;}
    </style>
    """,
    unsafe_allow_html=True
)


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
