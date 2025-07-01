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

import requests
from streamlit_oauth import OAuth2Component

# Session state defaults
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

# --- Google OAuth Setup ---
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
    revoke_endpoint="https://oauth2.googleapis.com/revoke",
)

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

# --- Login/Register UI (with email, password, and Google) ---
if not st.session_state["logged_in"]:
    st.title("🔐 Welcome to Falowen!")
    menu = st.radio("Choose an option:", ["Login", "Register"])
    email = st.text_input("Email")
    password = st.text_input("Password", type="password")

    # --- Google Login Button ---
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
        # Create or update user in DB
        user_profile = create_or_fetch_user(email, name, google_id)
        st.session_state["user_email"] = email
        st.session_state["user_name"] = name
        st.session_state["user_row"] = user_profile
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
                st.session_state["logged_in"] = True
                st.success(f"Welcome, {st.session_state['user_name']}!")
                st.rerun()
            except Exception as e:
                st.error("Login failed. Try again or register first.")
    st.stop()
# -- End of login code --

# =====================
# LOGOUT BUTTON
# =====================
if st.session_state["logged_in"]:
    st.sidebar.markdown("---")
    if st.sidebar.button("🚪 Logout"):
        for k in [
            "logged_in", "user_row", "user_email", "user_name", "pro_user", "user_google_id"
        ]:
            if k in st.session_state:
                del st.session_state[k]
        st.success("Logged out!")
        st.experimental_rerun()



tab = st.radio(
    "Choose a section:",
    ["Dashboard", "Vocab Trainer", "Schreiben Trainer", "Exams", "Grammar Helper"],
    key="main_tab_select"
)

if st.session_state["logged_in"] and tab == "Dashboard":
    user_row = st.session_state.get("user_row", {})
    name = user_row.get("name", "User")
    email = user_row.get("email", "")
    user_code = user_row.get("user_code", "")
    join_date = user_row.get("joined", "—")
    level = "A1"  # Change or let user select

    # You must define VOCAB_LISTS at the top for vocab stats to show
    # Example: VOCAB_LISTS = {"A1": [("Haus", "house"), ...], ...}
    vocab_total, vocab_mastered, exams_practiced, writing_attempts = get_progress(user_code, level)

    st.markdown(f"""
        <div style='text-align:center;margin-bottom:2em'>
            <h2>👋 Welcome back, <span style="color:#06B6D4">{name}</span>!</h2>
            <p style="font-size:18px;">Ready to level up your German with Falowen?</p>
        </div>
    """, unsafe_allow_html=True)

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
