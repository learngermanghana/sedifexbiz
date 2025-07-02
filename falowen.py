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
        pay_url = "https://paystack.shop/pay/pgsf1kucjw"  # Replace with your Paystack page
        st.markdown(f"[**Pay with Paystack**]({pay_url})", unsafe_allow_html=True)
        st.stop()

query_params = st.query_params if hasattr(st, "query_params") else st.experimental_get_query_params()
if query_params.get("paid") == ["true"] and st.session_state.get("logged_in"):
    user_code = st.session_state["user_row"]["user_code"]
    db.collection("users").document(user_code).update({"pro_user": True})
    st.session_state["pro_user"] = True
    st.success("🎉 Payment successful! Pro features unlocked.")

def save_login_cookies():
    cookie_manager.set("logged_in", True)
    cookie_manager.set("user_email", st.session_state["user_email"])
    cookie_manager.set("user_name", st.session_state["user_name"])
    cookie_manager.set("pro_user", st.session_state["pro_user"])
    cookie_manager.save()

# Restore session from cookies on page load
cookie_manager.ready()
if not st.session_state.get("logged_in", False):
    if cookie_manager.get("logged_in"):
        st.session_state["logged_in"] = True
        st.session_state["user_email"] = cookie_manager.get("user_email", "")
        st.session_state["user_name"] = cookie_manager.get("user_name", "")
        st.session_state["pro_user"] = cookie_manager.get("pro_user", False)
        # Optionally restore user_row from DB
        if st.session_state["user_email"]:
            user_profile = create_or_fetch_user(
                st.session_state["user_email"],
                st.session_state["user_name"]
            )
            st.session_state["user_row"] = user_profile

# === LOGIN UI ===
if not st.session_state.get("logged_in", False):
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
        save_login_cookies()  # <----- ADDED
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
                save_login_cookies()  # <----- ADDED
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
                save_login_cookies()  # <----- ADDED
                st.success(f"Welcome, {st.session_state['user_name']}!")
                st.rerun()
            except Exception as e:
                st.error("Login failed. Try again or register first.")
    st.stop()

# === LOGOUT ===
if st.session_state.get("logged_in", False):
    st.sidebar.markdown("---")
    if st.sidebar.button("🚪 Logout"):
        for k in [
            "logged_in", "user_row", "user_email", "user_name", "pro_user", "user_google_id"
        ]:
            if k in st.session_state:
                del st.session_state[k]
        # Clear cookies!
        for c in ["logged_in", "user_email", "user_name", "pro_user"]:
            cookie_manager.delete(c)
        cookie_manager.save()
        st.success("Logged out!")
        st.rerun()


# =============================
# VOCAB_LISTS (expand as needed)
# =============================
# --- Vocab lists for all levels ---

a1_vocab = [
    ("Südseite", "south side"), ("3. Stock", "third floor"), ("Geschenk", "present/gift"),
    ("Buslinie", "bus line"), ("Ruhetag", "rest day (closed)"), ("Heizung", "heating"),
    ("Hälfte", "half"), ("die Wohnung", "apartment"), ("das Zimmer", "room"), ("die Miete", "rent"),
    ("der Balkon", "balcony"), ("der Garten", "garden"), ("das Schlafzimmer", "bedroom"),
    ("das Wohnzimmer", "living room"), ("das Badezimmer", "bathroom"), ("die Garage", "garage"),
    ("der Tisch", "table"), ("der Stuhl", "chair"), ("der Schrank", "cupboard"), ("die Tür", "door"),
    ("das Fenster", "window"), ("der Boden", "floor"), ("die Wand", "wall"), ("die Lampe", "lamp"),
    ("der Fernseher", "television"), ("das Bett", "bed"), ("die Küche", "kitchen"), ("die Toilette", "toilet"),
    ("die Dusche", "shower"), ("das Waschbecken", "sink"), ("der Ofen", "oven"),
    ("der Kühlschrank", "refrigerator"), ("die Mikrowelle", "microwave"), ("die Waschmaschine", "washing machine"),
    ("die Spülmaschine", "dishwasher"), ("das Haus", "house"), ("die Stadt", "city"), ("das Land", "country"),
    ("die Straße", "street"), ("der Weg", "way"), ("der Park", "park"), ("die Ecke", "corner"),
    ("die Bank", "bank"), ("der Supermarkt", "supermarket"), ("die Apotheke", "pharmacy"),
    ("die Schule", "school"), ("die Universität", "university"), ("das Geschäft", "store"),
    ("der Markt", "market"), ("der Flughafen", "airport"), ("der Bahnhof", "train station"),
    ("die Haltestelle", "bus stop"), ("die Fahrt", "ride"), ("das Ticket", "ticket"), ("der Zug", "train"),
    ("der Bus", "bus"), ("das Taxi", "taxi"), ("das Auto", "car"), ("die Ampel", "traffic light"),
    ("die Kreuzung", "intersection"), ("der Parkplatz", "parking lot"), ("der Fahrplan", "schedule"),
    ("zumachen", "to close"), ("aufmachen", "to open"), ("ausmachen", "to turn off"),
    ("übernachten", "to stay overnight"), ("anfangen", "to begin"), ("vereinbaren", "to arrange"),
    ("einsteigen", "to get in / board"), ("umsteigen", "to change (trains)"), ("aussteigen", "to get out / exit"),
    ("anschalten", "to switch on"), ("ausschalten", "to switch off"), ("Anreisen", "to arrive"), ("Ankommen", "to arrive"),
    ("Abreisen", "to depart"), ("Absagen", "to cancel"), ("Zusagen", "to agree"), ("günstig", "cheap"),
    ("billig", "inexpensive")
]

a2_vocab = [
    ("die Verantwortung", "responsibility"), ("die Besprechung", "meeting"), ("die Überstunden", "overtime"),
    ("laufen", "to run"), ("das Fitnessstudio", "gym"), ("die Entspannung", "relaxation"),
    ("der Müll", "waste, garbage"), ("trennen", "to separate"), ("der Umweltschutz", "environmental protection"),
    ("der Abfall", "waste, rubbish"), ("der Restmüll", "residual waste"), ("die Anweisung", "instruction"),
    ("die Gemeinschaft", "community"), ("der Anzug", "suit"), ("die Beförderung", "promotion"),
    ("die Abteilung", "department"), ("drinnen", "indoors"), ("die Vorsorgeuntersuchung", "preventive examination"),
    ("die Mahlzeit", "meal"), ("behandeln", "to treat"), ("Hausmittel", "home remedies"),
    ("Salbe", "ointment"), ("Tropfen", "drops"), ("nachhaltig", "sustainable"),
    ("berühmt / bekannt", "famous / well-known"), ("einleben", "to settle in"), ("sich stören", "to be bothered"),
    ("liefern", "to deliver"), ("zum Mitnehmen", "to take away"), ("erreichbar", "reachable"),
    ("bedecken", "to cover"), ("schwanger", "pregnant"), ("die Impfung", "vaccination"),
    ("am Fluss", "by the river"), ("das Guthaben", "balance / credit"), ("kostenlos", "free of charge"),
    ("kündigen", "to cancel / to terminate"), ("der Anbieter", "provider"), ("die Bescheinigung", "certificate / confirmation"),
    ("retten", "rescue"), ("die Falle", "trap"), ("die Feuerwehr", "fire department"),
    ("der Schreck", "shock, fright"), ("schwach", "weak"), ("verletzt", "injured"),
    ("der Wildpark", "wildlife park"), ("die Akrobatik", "acrobatics"), ("bauen", "to build"),
    ("extra", "especially"), ("der Feriengruß", "holiday greeting"), ("die Pyramide", "pyramid"),
    ("regnen", "to rain"), ("schicken", "to send"), ("das Souvenir", "souvenir"),
    ("wahrscheinlich", "probably"), ("das Chaos", "chaos"), ("deutlich", "clearly"),
    ("der Ohrring", "earring"), ("verlieren", "to lose"), ("der Ärger", "trouble"),
    ("besorgt", "worried"), ("deprimiert", "depressed"), ("der Streit", "argument"),
    ("sich streiten", "to argue"), ("dagegen sein", "to be against"), ("egal", "doesn't matter"),
    ("egoistisch", "selfish"), ("kennenlernen", "to get to know"), ("nicht leiden können", "to dislike"),
    ("der Mädchentag", "girls' day"), ("der Ratschlag", "advice"), ("tun", "to do"),
    ("zufällig", "by chance"), ("ansprechen", "to approach"), ("plötzlich", "suddenly"),
    ("untrennbar", "inseparable"), ("sich verabreden", "to make an appointment"),
    ("versprechen", "to promise"), ("weglaufen", "to run away"), ("ab (+ Dativ)", "from, starting from"),
    ("das Aquarium", "aquarium"), ("der Flohmarkt", "flea market"), ("der Jungentag", "boys' day"),
    ("kaputt", "broken"), ("kostenlos", "free"), ("präsentieren", "to present"),
    ("das Quiz", "quiz"), ("schwitzen", "to sweat"), ("das Straßenfest", "street festival"),
    ("täglich", "daily"), ("vorschlagen", "to suggest"), ("wenn", "if, when"),
    ("die Bühne", "stage"), ("dringend", "urgently"), ("die Reaktion", "reaction"),
    ("unterwegs", "on the way"), ("vorbei", "over, past"), ("die Bauchschmerzen", "stomach ache"),
    ("der Busfahrer", "bus driver"), ("die Busfahrerin", "female bus driver"),
    ("der Fahrplan", "schedule"), ("der Platten", "flat tire"), ("die Straßenbahn", "tram"),
    ("streiken", "to strike"), ("der Unfall", "accident"), ("die Ausrede", "excuse"),
    ("baden", "to bathe"), ("die Grillwurst", "grilled sausage"), ("klingeln", "to ring"),
    ("die Mitternacht", "midnight"), ("der Nachbarhund", "neighbor's dog"),
    ("verbieten", "to forbid"), ("wach", "awake"), ("der Wecker", "alarm clock"),
    ("die Wirklichkeit", "reality"), ("zuletzt", "lastly, finally"), ("das Bandmitglied", "band member"),
    ("loslassen", "to let go"), ("der Strumpf", "stocking"), ("anprobieren", "to try on"),
    ("aufdecken", "to uncover / flip over"), ("behalten", "to keep"), ("der Wettbewerb", "competition"),
    ("schmutzig", "dirty"), ("die Absperrung", "barricade"), ("böse", "angry, evil"),
    ("trocken", "dry"), ("aufbleiben", "to stay up"), ("hässlich", "ugly"),
    ("ausweisen", "to identify"), ("erfahren", "to learn, find out"), ("entdecken", "to discover"),
    ("verbessern", "to improve"), ("aufstellen", "to set up"), ("die Notaufnahme", "emergency department"),
    ("das Arzneimittel", "medication"), ("die Diagnose", "diagnosis"), ("die Therapie", "therapy"),
    ("die Rehabilitation", "rehabilitation"), ("der Chirurg", "surgeon"), ("die Anästhesie", "anesthesia"),
    ("die Infektion", "infection"), ("die Entzündung", "inflammation"), ("die Unterkunft", "accommodation"),
    ("die Sehenswürdigkeit", "tourist attraction"), ("die Ermäßigung", "discount"), ("die Verspätung", "delay"),
    ("die Quittung", "receipt"), ("die Veranstaltung", "event"), ("die Bewerbung", "application")
]

# --- Short starter lists for B1/B2/C1 (add more later as you wish) ---
b1_vocab = [
    "Fortschritt", "Eindruck", "Unterschied", "Vorschlag", "Erfahrung", "Ansicht", "Abschluss", "Entscheidung"
]

b2_vocab = [
    "Umwelt", "Entwicklung", "Auswirkung", "Verhalten", "Verhältnis", "Struktur", "Einfluss", "Kritik"
]

c1_vocab = [
    "Ausdruck", "Beziehung", "Erkenntnis", "Verfügbarkeit", "Bereich", "Perspektive", "Relevanz", "Effizienz"
]

# --- Vocab list dictionary for your app ---
VOCAB_LISTS = {
    "A1": a1_vocab,
    "A2": a2_vocab,
    "B1": b1_vocab,
    "B2": b2_vocab,
    "C1": c1_vocab
}

# Exam topic lists
# --- A1 Exam Topic Lists (Teil 1, 2, 3) ---

A1_TEIL1 = [
    "Name", "Alter", "Wohnort", "Land", "Sprache", "Familie", "Beruf", "Hobby"
]

A1_TEIL2 = [
    ("Geschäft", "schließen"),
    ("Uhr", "Uhrzeit"),
    ("Arbeit", "Kollege"),
    ("Hausaufgabe", "machen"),
    ("Küche", "kochen"),
    ("Freizeit", "lesen"),
    ("Telefon", "anrufen"),
    ("Reise", "Hotel"),
    ("Auto", "fahren"),
    ("Einkaufen", "Obst"),
    ("Schule", "Lehrer"),
    ("Geburtstag", "Geschenk"),
    ("Essen", "Frühstück"),
    ("Arzt", "Termin"),
    ("Zug", "Abfahrt"),
    ("Wetter", "Regen"),
    ("Buch", "lesen"),
    ("Computer", "E-Mail"),
    ("Kind", "spielen"),
    ("Wochenende", "Plan"),
    ("Bank", "Geld"),
    ("Sport", "laufen"),
    ("Abend", "Fernsehen"),
    ("Freunde", "Besuch"),
    ("Bahn", "Fahrkarte"),
    ("Straße", "Stau"),
    ("Essen gehen", "Restaurant"),
    ("Hund", "Futter"),
    ("Familie", "Kinder"),
    ("Post", "Brief"),
    ("Nachbarn", "laut"),
    ("Kleid", "kaufen"),
    ("Büro", "Chef"),
    ("Urlaub", "Strand"),
    ("Kino", "Film"),
    ("Internet", "Seite"),
    ("Bus", "Abfahrt"),
    ("Arztpraxis", "Wartezeit"),
    ("Kuchen", "backen"),
    ("Park", "spazieren"),
    ("Bäckerei", "Brötchen"),
    ("Geldautomat", "Karte"),
    ("Buchladen", "Roman"),
    ("Fernseher", "Programm"),
    ("Tasche", "vergessen"),
    ("Stadtplan", "finden"),
    ("Ticket", "bezahlen"),
    ("Zahnarzt", "Schmerzen"),
    ("Museum", "Öffnungszeiten"),
    ("Handy", "Akku leer"),
]

A1_TEIL3 = [
    "Radio anmachen",
    "Fenster zumachen",
    "Licht anschalten",
    "Tür aufmachen",
    "Tisch sauber machen",
    "Hausaufgaben schicken",
    "Buch bringen",
    "Handy ausmachen",
    "Stuhl nehmen",
    "Wasser holen",
    "Fenster öffnen",
    "Musik leiser machen",
    "Tafel sauber wischen",
    "Kaffee kochen",
    "Deutsch üben",
    "Auto waschen",
    "Kind abholen",
    "Tisch decken",
    "Termin machen",
    "Nachricht schreiben",
]

A2_TEIL1 = [
    "Wohnort", "Tagesablauf", "Freizeit", "Sprachen", "Essen & Trinken", "Haustiere",
    "Lieblingsmonat", "Jahreszeit", "Sport", "Kleidung (Sommer)", "Familie", "Beruf",
    "Hobbys", "Feiertage", "Reisen", "Lieblingsessen", "Schule", "Wetter", "Auto oder Fahrrad", "Perfekter Tag"
]
A2_TEIL2 = [
    "Was machen Sie mit Ihrem Geld?",
    "Was machen Sie am Wochenende?",
    "Wie verbringen Sie Ihren Urlaub?",
    "Wie oft gehen Sie einkaufen und was kaufen Sie?",
    "Was für Musik hören Sie gern?",
    "Wie feiern Sie Ihren Geburtstag?",
    "Welche Verkehrsmittel nutzen Sie?",
    "Wie bleiben Sie gesund?",
    "Was machen Sie gern mit Ihrer Familie?",
    "Wie sieht Ihr Traumhaus aus?",
    "Welche Filme oder Serien mögen Sie?",
    "Wie oft gehen Sie ins Restaurant?",
    "Was ist Ihr Lieblingsfeiertag?",
    "Was machen Sie morgens als Erstes?",
    "Wie lange schlafen Sie normalerweise?",
    "Welche Hobbys hatten Sie als Kind?",
    "Machen Sie lieber Urlaub am Meer oder in den Bergen?",
    "Wie sieht Ihr Lieblingszimmer aus?",
    "Was ist Ihr Lieblingsgeschäft?",
    "Wie sieht ein perfekter Tag für Sie aus?"
]
A2_TEIL3 = [
    "Zusammen ins Kino gehen", "Ein Café besuchen", "Gemeinsam einkaufen gehen",
    "Ein Picknick im Park organisieren", "Eine Fahrradtour planen",
    "Zusammen in die Stadt gehen", "Einen Ausflug ins Schwimmbad machen",
    "Eine Party organisieren", "Zusammen Abendessen gehen",
    "Gemeinsam einen Freund/eine Freundin besuchen", "Zusammen ins Museum gehen",
    "Einen Spaziergang im Park machen", "Ein Konzert besuchen",
    "Zusammen eine Ausstellung besuchen", "Einen Wochenendausflug planen",
    "Ein Theaterstück ansehen", "Ein neues Restaurant ausprobieren",
    "Einen Kochabend organisieren", "Einen Sportevent besuchen", "Eine Wanderung machen"
]

B1_TEIL1 = [
    "Mithilfe beim Sommerfest", "Eine Reise nach Köln planen",
    "Überraschungsparty organisieren", "Kulturelles Ereignis (Konzert, Ausstellung) planen",
    "Museumsbesuch organisieren"
]
B1_TEIL2 = [
    "Ausbildung", "Auslandsaufenthalt", "Behinderten-Sport", "Berufstätige Eltern",
    "Berufswahl", "Bio-Essen", "Chatten", "Computer für jeden Kursraum", "Das Internet",
    "Einkaufen in Einkaufszentren", "Einkaufen im Internet", "Extremsport", "Facebook",
    "Fertigessen", "Freiwillige Arbeit", "Freundschaft", "Gebrauchte Kleidung",
    "Getrennter Unterricht für Jungen und Mädchen", "Haushalt", "Haustiere", "Heiraten",
    "Hotel Mama", "Ich bin reich genug", "Informationen im Internet", "Kinder und Fernsehen",
    "Kinder und Handys", "Kinos sterben", "Kreditkarten", "Leben auf dem Land oder in der Stadt",
    "Makeup für Kinder", "Marken-Kleidung", "Mode", "Musikinstrument lernen",
    "Musik im Zeitalter des Internets", "Rauchen", "Reisen", "Schokolade macht glücklich",
    "Sport treiben", "Sprachenlernen", "Sprachenlernen mit dem Internet",
    "Stadtzentrum ohne Autos", "Studenten und Arbeit in den Ferien", "Studium", "Tattoos",
    "Teilzeitarbeit", "Unsere Idole", "Umweltschutz", "Vegetarische Ernährung", "Zeitungslesen"
]
B1_TEIL3 = [
    "Fragen stellen zu einer Präsentation", "Positives Feedback geben",
    "Etwas überraschend finden oder planen", "Weitere Details erfragen"
]
b2_teil1_topics = [
    "Sollten Smartphones in der Schule erlaubt sein?",
    "Wie wichtig ist Umweltschutz in unserem Alltag?",
    "Wie beeinflusst Social Media unser Leben?",
    "Welche Rolle spielt Sport für die Gesundheit?",
]

b2_teil2_presentations = [
    "Die Bedeutung von Ehrenamt",
    "Vorteile und Nachteile von Homeoffice",
    "Auswirkungen der Digitalisierung auf die Arbeitswelt",
    "Mein schönstes Reiseerlebnis",
]

b2_teil3_arguments = [
    "Sollte man in der Stadt oder auf dem Land leben?",
    "Sind E-Autos die Zukunft?",
    "Brauchen wir mehr Urlaubstage?",
    "Muss Schule mehr praktische Fächer anbieten?",
]

c1_teil1_lectures = [
    "Die Zukunft der künstlichen Intelligenz",
    "Internationale Migration: Herausforderungen und Chancen",
    "Wandel der Arbeitswelt im 21. Jahrhundert",
    "Digitalisierung und Datenschutz",
]

c1_teil2_discussions = [
    "Sollten Universitäten Studiengebühren verlangen?",
    "Welchen Einfluss haben soziale Medien auf die Demokratie?",
    "Ist lebenslanges Lernen notwendig?",
    "Die Bedeutung von Nachhaltigkeit in der Wirtschaft",
]

c1_teil3_evaluations = [
    "Die wichtigsten Kompetenzen für die Zukunft",
    "Vor- und Nachteile globaler Zusammenarbeit",
    "Welchen Einfluss hat Technik auf unser Leben?",
    "Wie verändert sich die Familie?",
]


# ======================
# SHOW APP CONTENT HERE!
# ======================
if st.session_state.get("logged_in", False):
    tab = st.radio(
        "Choose a section:",
        [
            "Dashboard",
            "Vocab Trainer",
            "Ideas Generator",
            "Schreiben Trainer",
            "Oral Exam Trainer",  # <--- updated title here
            "Grammar Helper"
        ],
        key="main_tab_select"
    )

if tab == "Dashboard":
    user_row = st.session_state.get("user_row", {})
    name = user_row.get("name", "User")
    join_date = user_row.get("joined", "—")
    pro_user = st.session_state.get("pro_user", False)

    st.header(f"👋 Welcome, {name}!")
    st.markdown("---")
    
    # -- Main summary cards/columns --
    col1, col2, col3 = st.columns([2, 1, 1])
    
    with col1:
        st.subheader("🚀 Quick Start")
        st.write(
            "Welcome to your Goethe Exam Preparation Hub! "
            "Use the tabs above to practice Vocabulary, Speaking, Writing, or get ideas for your exam topics."
        )
        st.markdown("#### 📊 Progress Overview")
        st.metric("📅 Member Since", join_date[:10] if join_date else "-")
        # Future: add progress stats
        # st.metric("📝 Words Mastered", "5/50")
        # st.metric("🗣️ Mock Exams", "2")

    with col2:
        st.subheader("💡 Tip of the Day")
        st.info("Try the **Ideas Generator** to get instant inspiration and sample answers for your next Goethe exam topic!")

    with col3:
        st.subheader("🏆 Go Pro!")
        if not pro_user:
            st.markdown(
                "<span style='color:green'>Unlock unlimited practice, instant AI feedback, and full exam simulators with <b>Pro</b>!</span>",
                unsafe_allow_html=True,
            )
            st.button("Upgrade Now", on_click=lambda: st.switch_page("YOUR_PAYSTACK_LINK_HERE"))  # Replace with your link
        else:
            st.success("You have Pro access! Enjoy all features.")

    st.markdown("---")
    st.subheader("✨ Learning Modes")

    st.markdown(
        """
        <div style='display: flex; gap: 16px; flex-wrap: wrap;'>
            <div style='background: #f5f6fa; border-radius: 10px; padding: 18px; min-width: 220px; flex: 1; margin-bottom:10px;'>
                <b>💬 Ideas Generator</b><br>
                <span style='color: #333;'>Get ideas and sample answers for Sprechen & Schreiben (A1–C1).</span>
            </div>
            <div style='background: #e6f7ff; border-radius: 10px; padding: 18px; min-width: 220px; flex: 1; margin-bottom:10px;'>
                <b>📚 Vocab Trainer</b><br>
                <span style='color: #333;'>Memorize and practice all key Goethe exam vocabulary.</span>
            </div>
            <div style='background: #fffbe7; border-radius: 10px; padding: 18px; min-width: 220px; flex: 1; margin-bottom:10px;'>
                <b>✍️ Schreiben Trainer</b><br>
                <span style='color: #333;'>Get instant AI feedback for your writing tasks.</span>
            </div>
            <div style='background: #f9eef6; border-radius: 10px; padding: 18px; min-width: 220px; flex: 1; margin-bottom:10px;'>
                <b>🗣️ Oral Exam Trainer</b><br>
                <span style='color: #333;'>Practice your speaking with mock exam scenarios (A1–C1).</span>
            </div>
            <div style='background: #f3f3fa; border-radius: 10px; padding: 18px; min-width: 220px; flex: 1; margin-bottom:10px;'>
                <b>🧑‍🏫 Grammar Helper</b><br>
                <span style='color: #333;'>Ask any grammar question and get clear explanations.</span>
            </div>
        </div>
        """, unsafe_allow_html=True
    )


if tab == "Vocab Trainer":
    st.header("📝 Vocab Trainer")
    user_row = st.session_state.get("user_row", {})
    user_code = user_row.get("user_code", "")
    user_name = user_row.get("name", "User")

    # --- Level Selector ---
    levels = list(VOCAB_LISTS.keys())
    level = st.selectbox("Choose Level:", levels, key="vocab_level")

    # --- Practice Progress ---
    practiced = set()
    docs = db.collection("vocab_progress") \
        .where("user_code", "==", user_code) \
        .where("level", "==", level) \
        .where("is_correct", "==", True).stream()
    for doc in docs:
        practiced.add(doc.to_dict().get("word"))

    total = len(VOCAB_LISTS[level])
    done = len(practiced)

    st.markdown(f"#### Progress: {done} / {total} words mastered")
    st.progress(done / total if total else 0.01)

    # --- Vocab Practice Logic ---
    choices = [v for v in VOCAB_LISTS[level] if v[0] not in practiced]
    if not choices:
        st.success("🎉 You finished all words for this level!")
        if st.button("Reset Progress"):
            # Delete progress for this user/level
            docs = db.collection("vocab_progress") \
                .where("user_code", "==", user_code) \
                .where("level", "==", level).stream()
            for doc in docs:
                db.collection("vocab_progress").document(doc.id).delete()
            st.rerun()
        st.stop()

    word, correct = random.choice(choices)
    st.subheader(f"**Translate this word:**  `{word}`")
    user_input = st.text_input("Your Answer", key=f"vocab_input_{word}")

    # --- Check Answer Button ---
    if st.button("Check Answer"):
        if user_input.strip().lower() == correct.lower():
            st.success("✅ Correct!")
            is_correct = True
        else:
            st.error(f"❌ Not correct. The answer is: **{correct}**")
            is_correct = False

        # Save attempt
        doc_id = f"{user_code}_{level}_{word}_{int(datetime.utcnow().timestamp())}"
        db.collection("vocab_progress").document(doc_id).set({
            "user_code": user_code,
            "user_name": user_name,
            "level": level,
            "word": word,
            "answer": user_input,
            "is_correct": bool(is_correct),
            "date": datetime.utcnow().strftime("%Y-%m-%d")
        })
        st.rerun()

    # --- Optional: Download All Words as PDF ---
    with st.expander("📄 Download full vocab list (all words)"):
        from fpdf import FPDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=11)
        pdf.cell(0, 10, f"Vocab List – {level} ({user_name})", ln=1)
        pdf.ln(4)
        pdf.set_font("Arial", "B", 10)
        pdf.cell(60, 8, "German", border=1)
        pdf.cell(60, 8, "Translation", border=1)
        pdf.ln()
        pdf.set_font("Arial", "", 10)
        for w, t in VOCAB_LISTS[level]:
            pdf.cell(60, 8, w, border=1)
            pdf.cell(60, 8, t, border=1)
            pdf.ln()
        pdf_bytes = pdf.output(dest="S").encode("latin1", "replace")
        st.download_button(
            label="Download as PDF",
            data=pdf_bytes,
            file_name=f"{user_code}_vocab_list_{level}.pdf",
            mime="application/pdf"
        )


