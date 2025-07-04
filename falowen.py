import os
import json
import random
from datetime import date, datetime

import pandas as pd
import requests
import io
import streamlit as st
from openai import OpenAI
from fpdf import FPDF

# Firebase Admin imports
import firebase_admin
from firebase_admin import credentials, firestore

# --- FIREBASE INIT (RENDER) ---
sa_json = os.environ["FIREBASE_SERVICE_ACCOUNT"]
sa_info = json.loads(sa_json)
cred    = credentials.Certificate(sa_info)
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

# ========== CONSTANTS ==========
FALOWEN_DAILY_LIMIT   = 20
VOCAB_DAILY_LIMIT     = 20
SCHREIBEN_DAILY_LIMIT = 5
max_turns             = 25

# ========== OPENAI SETUP ==========
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or st.secrets.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    st.error("Missing OpenAI API key. Please set OPENAI_API_KEY in env or secrets.")
    st.stop()
os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
ai = OpenAI()

# ========== FIREBASE INIT ==========
# Expect the service‐account JSON in FIREBASE_SERVICE_ACCOUNT env var (or secrets)
sa_json = os.getenv("FIREBASE_SERVICE_ACCOUNT") or st.secrets.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_json:
    st.error("Missing FIREBASE_SERVICE_ACCOUNT. Please set in env or secrets.")
    st.stop()

sa_info = json.loads(sa_json)
cred    = credentials.Certificate(sa_info)
firebase_admin.initialize_app(cred)
db = firestore.client()


# ========== PROGRESS SAVERS ==========

def save_vocab_submission(student_code, name, level, word, student_answer, is_correct):
    """Records a vocab check in Firestore."""
    db.collection("vocab_progress").add({
        "student_code":   student_code,
        "name":           name,
        "level":          level,
        "word":           word,
        "student_answer": student_answer,
        "is_correct":     bool(is_correct),
        "date":           firestore.SERVER_TIMESTAMP
    })

def save_schreiben_submission(student_code, name, level, essay, score, feedback):
    """Records one writing submission."""
    db.collection("schreiben_progress").add({
        "student_code": student_code,
        "name":         name,
        "level":        level,
        "essay":        essay,
        "score":        score,
        "feedback":     feedback,
        "date":         firestore.SERVER_TIMESTAMP
    })

def save_sprechen_submission(student_code, name, level, teil, message, score, feedback):
    """Records one speaking submission."""
    db.collection("sprechen_progress").add({
        "student_code": student_code,
        "name":         name,
        "level":        level,
        "teil":         teil,
        "message":      message,
        "score":        score,
        "feedback":     feedback,
        "date":         firestore.SERVER_TIMESTAMP
    })

# ========== STATS & QUOTAS via Firestore ==========

def get_vocab_streak(student_code):
    docs = db.collection("vocab_progress")\
             .where("student_code","==",student_code)\
             .order_by("date", direction=firestore.Query.DESCENDING)\
             .stream()
    dates = [d.to_dict()["date"].date() for d in docs if "date" in d.to_dict()]
    # compute streak just like before...
    if not dates or (date.today()-dates[0]).days>1:
        return 0
    streak, prev = 1, dates[0]
    for d in dates[1:]:
        if (prev-d).days==1:
            streak+=1; prev=d
        else:
            break
    return streak

def get_writing_stats(student_code, passing_score=17):
    docs = db.collection("schreiben_progress")\
             .where("student_code","==",student_code)\
             .stream()
    total = passed = 0
    for d in docs:
        total += 1
        if d.to_dict().get("score",0) >= passing_score:
            passed += 1
    acc = round(100 * passed / total) if total else 0
    return total, passed, acc

def get_falowen_usage(student_code):
    today = str(date.today())
    key = f"{student_code}_falowen_{today}"
    usage = st.session_state.setdefault("falowen_usage", {})
    return usage.setdefault(key, 0)

def inc_falowen_usage(student_code):
    today = str(date.today())
    key = f"{student_code}_falowen_{today}"
    usage = st.session_state.setdefault("falowen_usage", {})
    usage[key] = usage.get(key, 0) + 1

def has_falowen_quota(student_code):
    return get_falowen_usage(student_code) < FALOWEN_DAILY_LIMIT

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


# ==========================
# MAIN UI
# ==========================
st.set_page_config(page_title="Falowen App", layout="centered")

# -- LOGIN / LOGOUT --
if "logged_in" not in st.session_state:
    st.session_state["logged_in"] = False

if not st.session_state["logged_in"]:
    st.title("🔑 Student Login")
    inp = st.text_input("Student Code or Email:").strip().lower()
    if st.button("Login"):
        df = load_student_data()
        found = df[(df.StudentCode == inp) | (df.Email == inp)]
        if not found.empty:
            row = found.iloc[0].to_dict()
            if contract_active(row):
                st.session_state.update(logged_in=True, student_row=row)
                st.experimental_rerun()
            else:
                st.error("⛔️ Contract expired.")
        else:
            st.error("Invalid code/email.")
    st.stop()

row = st.session_state["student_row"]
student_code = row["StudentCode"]

if st.button("🚪 Log Out"):
    st.session_state.update(logged_in=False, student_row=None)
    st.experimental_rerun()

if not has_falowen_quota(student_code):
    st.error("Daily quota reached.")
    st.stop()

# -- TAB SELECTION --
tab = st.radio(
    "How do you want to practice?",
    [
        "Dashboard",
        "Exams Mode & Custom Chat",
        "Vocab Trainer",
        "Schreiben Trainer",
        "Course Book",
        "My Results and Resources",
        "Admin"
    ],
    key="main_tab"
)

# --- DASHBOARD ---
if tab == "Dashboard":
    st.header("📊 Student Dashboard")

    df = load_student_data()
    f  = df[df.StudentCode.str.lower() == student_code]
    stud = f.iloc[0].to_dict() if not f.empty else {}

    streak = get_vocab_streak(student_code)
    tot, passed, acc = get_writing_stats(student_code)
    used = get_falowen_usage(student_code)

    st.markdown(f"**Name:** {stud.get('Name','')}")
    st.markdown(f"**Level:** {stud.get('Level','')}")
    st.markdown(f"**Code:** `{stud.get('StudentCode','')}`")
    st.markdown(f"**Email:** {stud.get('Email','')}")
    st.markdown(f"**Contract End:** {stud.get('ContractEnd','')}")
    st.markdown("---")

    balance = float(stud.get("Balance", 0) or 0)
    if balance > 0:
        st.warning(f"💸 Balance to pay: **₵{balance:.2f}**")

    ce = stud.get("ContractEnd")
    if ce:
        try:
            ce_date = datetime.strptime(str(ce), "%Y-%m-%d")
            days_left = (ce_date - datetime.now()).days
            if 0 < days_left <= 30:
                st.info(f"⚠️ Contract ends in {days_left} days. Please renew soon.")
            elif days_left < 0:
                st.error("⏰ Contract expired. Contact office to renew.")
        except:
            pass

    st.markdown(f"🔥 **Vocab Streak:** {streak} days")
    st.markdown(f"📄 **Letters submitted:** {tot}")
    st.markdown(f"✅ **Passed (≥17):** {passed}")
    st.markdown(f"🏅 **Pass rate:** {acc}%")
    st.markdown(f"📅 **Today:** {used} / {SCHREIBEN_DAILY_LIMIT}" )

    if tot < 2:
        st.success(f"🎯 Your next goal: Write {2 - tot} more letter(s) this week!")
    else:
        st.success("🎉 Weekly goal reached! Keep practicing!")

    with st.expander("📅 Upcoming Goethe Exams & Registration (Tap for details)", expanded=True):
        st.markdown(
            """
**Registration for Aug./Sept. 2025 Exams:**

| Level | Date       | Fee (GHS) | Per Module (GHS) |
|-------|------------|-----------|------------------|
| A1    | 21.07.2025 | 2,850     | —                |
| A2    | 22.07.2025 | 2,400     | —                |
| B1    | 23.07.2025 | 2,750     | 880              |
| B2    | 24.07.2025 | 2,500     | 840              |
| C1    | 25.07.2025 | 2,450     | 700              |

---

### 📝 Registration Steps

1. [**Register Here (9–10 am, keep checking!)**](https://www.goethe.de/ins/gh/en/spr/prf/anm.html)  
2. Fill the form and choose **extern**  
3. Submit and get payment confirmation  
4. Pay by Mobile Money or Ecobank (**use full name as reference**)  
   - Email proof to: registrations-accra@goethe.de  
5. Wait for response; send polite reminders if needed.

**Payment Details:**  
**Ecobank Ghana**  
Account Name: **GOETHE-INSTITUT GHANA**  
Account No: **1441 001 701 903**  
Branch: **Ring Road Central**  
SWIFT: **ECOCGHAC**
            """,
            unsafe_allow_html=True,
        )

# ================================
# 5a. EXAMS MODE & CUSTOM CHAT TAB (block start, pdf helper, prompt builders)
# ================================

if tab == "Exams Mode & Custom Chat":
    # --- Daily Limit Check ---
    # You can use a helper like: has_falowen_quota(student_code) or get_falowen_remaining(student_code)
    if not has_falowen_quota(student_code):
        st.header("🗣️ Falowen – Speaking & Exam Trainer")
        st.warning("You have reached your daily practice limit for this section. Please come back tomorrow.")
        st.stop()


    # ---- PDF Helper ----
    def falowen_download_pdf(messages, filename):
        from fpdf import FPDF
        import os
        def safe_latin1(text):
            return text.encode("latin1", "replace").decode("latin1")
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        chat_text = ""
        for m in messages:
            role = "Herr Felix" if m["role"] == "assistant" else "Student"
            safe_msg = safe_latin1(m["content"])
            chat_text += f"{role}: {safe_msg}\n\n"
        pdf.multi_cell(0, 10, chat_text)
        pdf_output = f"{filename}.pdf"
        pdf.output(pdf_output)
        with open(pdf_output, "rb") as f:
            pdf_bytes = f.read()
        os.remove(pdf_output)
        return pdf_bytes

    # ---- PROMPT BUILDERS (ALL LOGIC) ----
    def build_a1_exam_intro():
        return (
            "**A1 – Teil 1: Basic Introduction**\n\n"
            "In the A1 exam's first part, you will be asked to introduce yourself. "
            "Typical information includes: your **Name, Land, Wohnort, Sprachen, Beruf, Hobby**.\n\n"
            "After your introduction, you will be asked 3 basic questions such as:\n"
            "- Haben Sie Geschwister?\n"
            "- Wie alt ist deine Mutter?\n"
            "- Bist du verheiratet?\n\n"
            "You might also be asked to spell your name (**Buchstabieren**). "
            "Please introduce yourself now using all the keywords above."
        )

    def build_exam_instruction(level, teil):
        if level == "A1":
            if "Teil 1" in teil:
                return build_a1_exam_intro()
            elif "Teil 2" in teil:
                return (
                    "**A1 – Teil 2: Question and Answer**\n\n"
                    "You will get a topic and a keyword. Your job: ask a question using the keyword, "
                    "then answer it yourself. Example: Thema: Geschäft – Keyword: schließen → "
                    "Wann schließt das Geschäft?\nLet's try one. Ready?"
                )
            elif "Teil 3" in teil:
                return (
                    "**A1 – Teil 3: Making a Request**\n\n"
                    "You'll receive a prompt (e.g. 'Radio anmachen'). Write a polite request or imperative. "
                    "Example: Können Sie bitte das Radio anmachen?\nReady?"
                )
        if level == "A2":
            if "Teil 1" in teil:
                return (
                    "**A2 – Teil 1: Fragen zu Schlüsselwörtern**\n\n"
                    "You'll get a topic (e.g. 'Wohnort'). Ask a question, then answer it yourself. "
                    "When you're ready, type 'Begin'."
                )
            elif "Teil 2" in teil:
                return (
                    "**A2 – Teil 2: Über das Thema sprechen**\n\n"
                    "Talk about the topic in 3–4 sentences. I'll correct and give tips. Start when ready."
                )
            elif "Teil 3" in teil:
                return (
                    "**A2 – Teil 3: Gemeinsam planen**\n\n"
                    "Let's plan something together. Respond and make suggestions. Start when ready."
                )
        if level == "B1":
            if "Teil 1" in teil:
                return (
                    "**B1 – Teil 1: Gemeinsam planen**\n\n"
                    "We'll plan an activity together (e.g., a trip or party). Give your ideas and answer questions."
                )
            elif "Teil 2" in teil:
                return (
                    "**B1 – Teil 2: Präsentation**\n\n"
                    "Give a short presentation on the topic (about 2 minutes). I'll ask follow-up questions."
                )
            elif "Teil 3" in teil:
                return (
                    "**B1 – Teil 3: Feedback & Fragen stellen**\n\n"
                    "Answer questions about your presentation. I'll give you feedback on your language and structure."
                )
        if level == "B2":
            if "Teil 1" in teil:
                return (
                    "**B2 – Teil 1: Diskussion**\n\n"
                    "We'll discuss a topic. Express your opinion and justify it."
                )
            elif "Teil 2" in teil:
                return (
                    "**B2 – Teil 2: Präsentation**\n\n"
                    "Present a topic in detail. I'll challenge your points and help you improve."
                )
            elif "Teil 3" in teil:
                return (
                    "**B2 – Teil 3: Argumentation**\n\n"
                    "Argue your perspective. I'll give feedback and counterpoints."
                )
        if level == "C1":
            if "Teil 1" in teil:
                return (
                    "**C1 – Teil 1: Vortrag**\n\n"
                    "Bitte halte einen kurzen Vortrag zum Thema. Ich werde anschließend Fragen stellen und deine Sprache bewerten."
                )
            elif "Teil 2" in teil:
                return (
                    "**C1 – Teil 2: Diskussion**\n\n"
                    "Diskutiere mit mir über das gewählte Thema. Ich werde kritische Nachfragen stellen."
                )
            elif "Teil 3" in teil:
                return (
                    "**C1 – Teil 3: Bewertung**\n\n"
                    "Bewerte deine eigene Präsentation. Was würdest du beim nächsten Mal besser machen?"
                )
        return ""

    def build_exam_system_prompt(level, teil):
        if level == "A1":
            if "Teil 1" in teil:
                return (
                    "You are Herr Felix, a supportive A1 German examiner. "
                    "Ask the student to introduce themselves using the keywords (Name, Land, Wohnort, Sprachen, Beruf, Hobby). "
                    "Check if all info is given, correct any errors (explain in English), and give the right way to say things in German. "
                    "1. Always explain errors and suggestion in english. Only next question should be German. They are just A1 student "
                    "After their intro, ask these three questions one by one: "
                    "'Haben Sie Geschwister?', 'Wie alt ist deine Mutter?', 'Bist du verheiratet?'. "
                    "Correct their answers (explain in English). At the end, mention they may be asked to spell their name ('Buchstabieren') and wish them luck."
                )
            elif "Teil 2" in teil:
                return (
                    "You are Herr Felix, an A1 examiner. Randomly give the student a Thema and Keyword from the official list. "
                    "Tell them to ask a question with the keyword and answer it themselves, then correct their German (explain errors in English, show the correct version), and move to the next topic."
                )
            elif "Teil 3" in teil:
                return (
                    "You are Herr Felix, an A1 examiner. Give the student a prompt (e.g. 'Radio anmachen'). "
                    "Ask them to write a polite request or imperative and answer themseves like their partners will do. Check if it's correct and polite, explain errors in English, and provide the right German version. Then give the next prompt."
                    " They respond using Ja gerne or In ordnung. They can also answer using Ja, Ich kann and the question of the verb at the end (e.g 'Ich kann das Radio anmachen'). "
                )
        if level == "A2":
            if "Teil 1" in teil:
                return (
                    "You are Herr Felix, a Goethe A2 examiner. Give a topic from the A2 list. "
                    "Ask the student to ask and answer a question on it. Always correct their German (explain errors in English), show the correct version, and encourage."
                )
            elif "Teil 2" in teil:
                return (
                    "You are Herr Felix, an A2 examiner. Give a topic. Student gives a short monologue. Correct errors (in English), give suggestions, and follow up with one question."
                )
            elif "Teil 3" in teil:
                return (
                    "You are Herr Felix, an A2 examiner. Plan something together (e.g., going to the cinema). Check student's suggestions, correct errors, and keep the conversation going."
                )
        if level == "B1":
            if "Teil 1" in teil:
                return (
                    "You are Herr Felix, a Goethe B1 examiner. You and the student plan an activity together. "
                    "Always give feedback in both German and English, correct mistakes, suggest improvements, and keep it realistic."
                )
            elif "Teil 2" in teil:
                return (
                    "You are Herr Felix, a Goethe B1 examiner. Student gives a presentation. Give constructive feedback in German and English, ask for more details, and highlight strengths and weaknesses."
                )
            elif "Teil 3" in teil:
                return (
                    "You are Herr Felix, a Goethe B1 examiner. Student answers questions about their presentation. "
                    "Give exam-style feedback (in German and English), correct language, and motivate."
                )
        if level == "B2":
            if "Teil 1" in teil:
                return (
                    "You are Herr Felix, a B2 examiner. Discuss a topic with the student. Challenge their points. Correct errors (mostly in German, but use English if it's a big mistake), and always provide the correct form."
                )
            elif "Teil 2" in teil:
                return (
                    "You are Herr Felix, a B2 examiner. Listen to the student's presentation. Give high-level feedback (mostly in German), ask probing questions, and always highlight advanced vocabulary and connectors."
                )
            elif "Teil 3" in teil:
                return (
                    "You are Herr Felix, a B2 examiner. Argue your perspective. Give detailed, advanced corrections (mostly German, use English if truly needed). Encourage native-like answers."
                )
        if level == "C1":
            if "Teil 1" in teil or "Teil 2" in teil or "Teil 3" in teil:
                return (
                    "Du bist Herr Felix, ein C1-Prüfer. Sprich nur Deutsch. "
                    "Stelle herausfordernde Fragen, gib ausschließlich auf Deutsch Feedback, und fordere den Studenten zu komplexen Strukturen auf."
                )
        return ""

    def build_custom_chat_prompt(level):
        if level == "C1":
            return (
                "Du bist Herr Felix, ein C1-Prüfer. Sprich nur Deutsch. "
                "Gib konstruktives Feedback, stelle schwierige Fragen, und hilf dem Studenten, auf C1-Niveau zu sprechen."
            )
        if level in ["A1", "A2", "B1", "B2"]:
            correction_lang = "in English" if level in ["A1", "A2"] else "half in English and half in German"
            return (
                f"You are Herr Felix, a supportive and innovative German teacher. "
                f"The student's first input is their chosen topic. Only give suggestions, phrases, tips and ideas at first in English, no corrections. "
                f"Pick 4 useful keywords related to the student's topic and use them as the focus for conversation. Give students ideas and how to build their points for the conversation in English. "
                f"For each keyword, ask the student up to 3 creative, diverse and interesting questions in German only based on student language level, one at a time, not all at once. Just ask the question and don't let student know this is the keyword you are using. "
                f"After each student answer, give feedback and a suggestion to extend their answer if it's too short. Feedback in English and suggestion in German. "
                f"1. Explain difficult words when level is A1,A2,B1,B2. "
                f"After keyword questions, continue with other random follow-up questions that reflect student selected level about the topic in German (until you reach 20 questions in total). "
                f"Never ask more than 3 questions about the same keyword. "
                f"After the student answers 18 questions, write a summary of their performance: what they did well, mistakes, and what to improve in English. "
                f"All feedback and corrections should be {correction_lang}. "
                f"Encourage the student and keep the chat motivating. "
            )
        return ""

    # ---- USAGE LIMIT CHECK ----
    if not has_falowen_quota(student_code):
        st.warning("You have reached your daily practice limit for this section. Please come back tomorrow.")
        st.stop()

    # ---- SESSION STATE DEFAULTS ----
    default_state = {
        "falowen_stage": 1,
        "falowen_mode": None,
        "falowen_level": None,
        "falowen_teil": None,
        "falowen_messages": [],
        "falowen_turn_count": 0,
        "custom_topic_intro_done": False,
        "custom_chat_level": None,
        "falowen_exam_topic": None,
        "falowen_exam_keyword": None,
    }
    for key, val in default_state.items():
        if key not in st.session_state:
            st.session_state[key] = val

    # ---- STAGE 1: Mode Selection ----
    if st.session_state["falowen_stage"] == 1:
        st.subheader("Step 1: Choose Practice Mode")
        mode = st.radio(
            "How would you like to practice?",
            ["Geführte Prüfungssimulation (Exam Mode)", "Eigenes Thema/Frage (Custom Chat)"],
            key="falowen_mode_center"
        )
        if st.button("Next ➡️", key="falowen_next_mode"):
            st.session_state["falowen_mode"] = mode
            st.session_state["falowen_stage"] = 2
            st.session_state["falowen_level"] = None
            st.session_state["falowen_teil"] = None
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # ---- STAGE 2: Level Selection ----
    if st.session_state["falowen_stage"] == 2:
        st.subheader("Step 2: Choose Your Level")
        level = st.radio(
            "Select your level:",
            ["A1", "A2", "B1", "B2", "C1"],
            key="falowen_level_center"
        )
        if st.button("⬅️ Back", key="falowen_back1"):
            st.session_state["falowen_stage"] = 1
            st.stop()
        if st.button("Next ➡️", key="falowen_next_level"):
            st.session_state["falowen_level"] = level
            if st.session_state["falowen_mode"] == "Geführte Prüfungssimulation (Exam Mode)":
                st.session_state["falowen_stage"] = 3
            else:
                st.session_state["falowen_stage"] = 4
            st.session_state["falowen_teil"] = None
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False
        st.stop()

    # ---- STAGE 3: Exam Part & Topic (Exam Mode Only) ----
    if st.session_state["falowen_stage"] == 3:
        level = st.session_state["falowen_level"]
        teil_options = {
            "A1": ["Teil 1 – Basic Introduction", "Teil 2 – Question and Answer", "Teil 3 – Making A Request"],
            "A2": ["Teil 1 – Fragen zu Schlüsselwörtern", "Teil 2 – Über das Thema sprechen", "Teil 3 – Gemeinsam planen"],
            "B1": ["Teil 1 – Gemeinsam planen (Dialogue)", "Teil 2 – Präsentation (Monologue)", "Teil 3 – Feedback & Fragen stellen"],
            "B2": ["Teil 1 – Diskussion", "Teil 2 – Präsentation", "Teil 3 – Argumentation"],
            "C1": ["Teil 1 – Vortrag", "Teil 2 – Diskussion", "Teil 3 – Bewertung"]
        }

        # build exam_topics list
        exam_topics = []
        if level == "A2":
            exam_topics = A2_TEIL1 + A2_TEIL2 + A2_TEIL3
        elif level == "B1":
            exam_topics = B1_TEIL1 + B1_TEIL2 + B1_TEIL3
        elif level == "B2":
            exam_topics = b2_teil1_topics + b2_teil2_presentations + b2_teil3_arguments
        elif level == "C1":
            exam_topics = c1_teil1_lectures + c1_teil2_discussions + c1_teil3_evaluations

        st.subheader("Step 3: Choose Exam Part")
        teil = st.radio("Which exam part?", teil_options[level], key="falowen_teil_center")

        # optional topic picker
        if level != "A1" and exam_topics:
            picked = st.selectbox("Choose a topic (optional):", ["(random)"] + exam_topics)
            st.session_state["falowen_exam_topic"] = None if picked == "(random)" else picked
        else:
            st.session_state["falowen_exam_topic"] = None

        if st.button("⬅️ Back", key="falowen_back2"):
            st.session_state["falowen_stage"] = 2
            st.stop()

        if st.button("Start Practice", key="falowen_start_practice"):
            # initialize exam part
            st.session_state["falowen_teil"] = teil
            st.session_state["falowen_stage"] = 4
            st.session_state["falowen_messages"] = []
            st.session_state["custom_topic_intro_done"] = False

            # initialize or load shuffled deck
            rem, used = load_progress(student_code, level, teil)
            if rem is None:
                deck = exam_topics.copy()
                random.shuffle(deck)
                st.session_state["remaining_topics"] = deck
                st.session_state["used_topics"] = []
            else:
                st.session_state["remaining_topics"] = rem
                st.session_state["used_topics"] = used

            # persist initial state
            save_progress(
                student_code, level, teil,
                st.session_state["remaining_topics"],
                st.session_state["used_topics"]
            )
        st.stop()

    # ---- STAGE 4: MAIN CHAT ----
    if st.session_state["falowen_stage"] == 4:
        level = st.session_state["falowen_level"]
        teil = st.session_state["falowen_teil"]
        mode = st.session_state["falowen_mode"]
        is_exam = mode == "Geführte Prüfungssimulation (Exam Mode)"
        is_custom_chat = mode == "Eigenes Thema/Frage (Custom Chat)"

        # ---- Show daily usage ----
        used_today = get_falowen_usage(student_code)
        st.info(f"Today: {used_today} / {FALOWEN_DAILY_LIMIT} Falowen chat messages used.")
        if used_today >= FALOWEN_DAILY_LIMIT:
            st.warning("You have reached your daily practice limit for Falowen today. Please come back tomorrow.")
            st.stop()

        # ---- Session Controls ----
        def reset_chat():
            st.session_state.update({
                "falowen_stage": 1,
                "falowen_messages": [],
                "falowen_teil": None,
                "falowen_mode": None,
                "custom_topic_intro_done": False,
                "falowen_turn_count": 0,
                "falowen_exam_topic": None
            })
            st.rerun()

        def back_step():
            st.session_state.update({
                "falowen_stage": max(1, st.session_state["falowen_stage"] - 1),
                "falowen_messages": []
            })
            st.rerun()

        def change_level():
            st.session_state.update({
                "falowen_stage": 2,
                "falowen_messages": []
            })
            st.rerun()

        # ---- Render Chat History ----
        for msg in st.session_state["falowen_messages"]:
            if msg["role"] == "assistant":
                with st.chat_message("assistant", avatar="🧑‍🏫"):
                    st.markdown(
                        "<span style='color:#33691e;font-weight:bold'>🧑‍🏫 Herr Felix:</span>",
                        unsafe_allow_html=True
                    )
                    st.markdown(msg["content"])
            else:
                with st.chat_message("user"):
                    st.markdown(f"🗣️ {msg['content']}")

        # ---- Auto-scroll to bottom ----
        st.markdown("<script>window.scrollTo(0, document.body.scrollHeight);</script>", unsafe_allow_html=True)

        # ---- PDF Download Button ----
        if st.session_state["falowen_messages"]:
            pdf_bytes = falowen_download_pdf(
                st.session_state["falowen_messages"],
                f"Falowen_Chat_{level}_{teil.replace(' ', '_') if teil else 'chat'}"
            )
            st.download_button(
                "⬇️ Download Chat as PDF",
                pdf_bytes,
                file_name=f"Falowen_Chat_{level}_{teil.replace(' ', '_') if teil else 'chat'}.pdf",
                mime="application/pdf"
            )

        # ---- Session Buttons ----
        col1, col2, col3 = st.columns(3)
        with col1:
            if st.button("Restart Chat"): reset_chat()
        with col2:
            if st.button("Back"): back_step()
        with col3:
            if st.button("Change Level"): change_level()

        # ---- Initial Instruction ----
        if not st.session_state["falowen_messages"]:
            instruction = build_exam_instruction(level, teil) if is_exam else (
                "Hallo! 👋 What would you like to talk about? Give me details of what you want so I can understand."
            )
            st.session_state["falowen_messages"].append({"role": "assistant", "content": instruction})

        # ---- Build System Prompt including topic/context ----
        if is_exam:
            base_prompt = build_exam_system_prompt(level, teil)
            topic = st.session_state.get("falowen_exam_topic")
            if topic:
                system_prompt = f"{base_prompt} Thema: {topic}."
            else:
                system_prompt = base_prompt
        else:
            system_prompt = build_custom_chat_prompt(level)

        # ---- Chat Input & Assistant Response ----
        user_input = st.chat_input("Type your answer or message here...", key="falowen_user_input")
        if user_input:
            st.session_state["falowen_messages"].append({"role": "user", "content": user_input})
            inc_falowen_usage(student_code)

            # render user message
            with st.chat_message("user"):
                st.markdown(f"🗣️ {user_input}")

            # AI response
            with st.chat_message("assistant", avatar="🧑‍🏫"):
                with st.spinner("🧑‍🏫 Herr Felix is typing..."):
                    messages = [{"role": "system", "content": system_prompt}] + st.session_state["falowen_messages"]
                    try:
                        resp = client.chat.completions.create(
                            model="gpt-4o", messages=messages, temperature=0.15, max_tokens=600
                        )
                        ai_reply = resp.choices[0].message.content.strip()
                    except Exception as e:
                        ai_reply = f"Sorry, an error occurred: {e}"
                st.markdown(
                    "<span style='color:#33691e;font-weight:bold'>🧑‍🏫 Herr Felix:</span>",
                    unsafe_allow_html=True
                )
                st.markdown(ai_reply)

            # save assistant reply
            st.session_state["falowen_messages"].append({"role": "assistant", "content": ai_reply})

# =========================================
#End
# =========================================


# =========================================
# VOCAB TRAINER TAB (A1–C1) + MY VOCAB
# =========================================




# ===================
# END OF VOCAB TRAINER TAB
# ===================



# ====================================
# SCHREIBEN TRAINER TAB (with Daily Limit and Mobile UI)
# ====================================
import urllib.parse

if tab == "Schreiben Trainer":
    st.header("✍️ Schreiben Trainer (Writing Practice)")

    # 1. Choose Level (remember previous)
    schreiben_levels = ["A1", "A2", "B1", "B2"]
    prev_level = st.session_state.get("schreiben_level", "A1")
    schreiben_level = st.selectbox(
        "Choose your writing level:",
        schreiben_levels,
        index=schreiben_levels.index(prev_level) if prev_level in schreiben_levels else 0,
        key="schreiben_level_selector"
    )
    st.session_state["schreiben_level"] = schreiben_level

    # 2. Daily limit tracking (by student & date)
    student_code = st.session_state.get("student_code", "demo")
    student_name = st.session_state.get("student_name", "")
    today_str = str(date.today())
    limit_key = f"{student_code}_schreiben_{today_str}"
    if "schreiben_usage" not in st.session_state:
        st.session_state["schreiben_usage"] = {}
    st.session_state["schreiben_usage"].setdefault(limit_key, 0)
    daily_so_far = st.session_state["schreiben_usage"][limit_key]


    # 4. Level-Specific Stats (optional)
    stats = get_student_stats(student_code)
    lvl_stats = stats.get(schreiben_level, {}) if stats else {}
    if lvl_stats and lvl_stats["attempted"]:
        correct = lvl_stats.get("correct", 0)
        attempted_lvl = lvl_stats.get("attempted", 0)
        st.info(f"Level `{schreiben_level}`: {correct} / {attempted_lvl} passed")
    else:
        st.info("_No previous writing activity for this level yet._")

    st.divider()

    # 5. Input Box (disabled if limit reached)
    user_letter = st.text_area(
        "Paste or type your German letter/essay here.",
        key="schreiben_input",
        disabled=(daily_so_far >= SCHREIBEN_DAILY_LIMIT),
        height=180,
        placeholder="Write your German letter here..."
    )

    # 6. AI prompt (always define before calling the API)
    ai_prompt = (
        f"You are Herr Felix, a supportive and innovative German letter writing trainer. "
        f"The student has submitted a {schreiben_level} German letter or essay. "
        "Write a brief comment in English about what the student did well and what they should improve while highlighting their points so they understand. "
        "Check if the letter matches their level. Talk as Herr Felix talking to a student and highlight the phrases with errors so they see it. "
        "Don't just say errors—show exactly where the mistakes are. "
        "1. Give a score out of 25 marks and always display the score clearly. "
        "2. If the score is 17 or more (17, 18, ..., 25), write: '**Passed: You may submit to your tutor!**'. "
        "3. If the score is 16 or less (16, 15, ..., 0), write: '**Keep improving before you submit.**'. "
        "4. Only write one of these two sentences, never both, and place it on a separate bolded line at the end of your feedback. "
        "5. Always explain why you gave the student that score based on grammar, spelling, vocabulary, coherence, and so on. "
        "6. Also check for AI usage or if the student wrote with their own effort. "
        "7. List and show the phrases to improve on with tips, suggestions, and what they should do. Let the student use your suggestions to correct the letter, but don't write the full corrected letter for them. "
        "Give scores by analyzing grammar, structure, vocabulary, etc. Explain to the student why you gave that score."
    )

    # 7. Submit & AI Feedback
    feedback = ""
    submit_disabled = daily_so_far >= SCHREIBEN_DAILY_LIMIT or not user_letter.strip()
    if submit_disabled and daily_so_far >= SCHREIBEN_DAILY_LIMIT:
        st.warning("You have reached today's writing practice limit. Please come back tomorrow.")

    if st.button("Get Feedback", type="primary", disabled=submit_disabled):
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
            # === Extract score and check if passed ===
            import re
            # Robust regex for score detection
            score_match = re.search(
                r"score\s*(?:[:=]|is)?\s*(\d+)\s*/\s*25",
                feedback,
                re.IGNORECASE,
            )
            if not score_match:
                score_match = re.search(r"Score[:\s]+(\d+)\s*/\s*25", feedback, re.IGNORECASE)
            if score_match:
                score = int(score_match.group(1))
            else:
                st.warning("Could not detect a score in the AI feedback.")
                score = 0

            # === Update usage and save to DB ===
            st.session_state["schreiben_usage"][limit_key] += 1
            save_schreiben_submission(
                student_code, student_name, schreiben_level, user_letter, score, feedback
            )

            # --- Show Feedback ---
            st.markdown("---")
            st.markdown("#### 📝 Feedback from Herr Felix")
            st.markdown(feedback)

            # === Download as PDF ===
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", size=12)
            pdf.multi_cell(0, 10, f"Your Letter:\n\n{user_letter}\n\nFeedback from Herr Felix:\n\n{feedback}")
            pdf_output = f"Feedback_{student_code}_{schreiben_level}.pdf"
            pdf.output(pdf_output)
            with open(pdf_output, "rb") as f:
                pdf_bytes = f.read()
            st.download_button(
                "⬇️ Download Feedback as PDF",
                pdf_bytes,
                file_name=pdf_output,
                mime="application/pdf"
            )
            import os
            os.remove(pdf_output)

            # === WhatsApp Share ===
            wa_message = f"Hi, here is my German letter and AI feedback:\n\n{user_letter}\n\nFeedback:\n{feedback}"
            wa_url = (
                "https://api.whatsapp.com/send"
                "?phone=233205706589"
                f"&text={urllib.parse.quote(wa_message)}"
            )
            st.markdown(
                f"[📲 Send to Tutor on WhatsApp]({wa_url})",
                unsafe_allow_html=True
            )
            

def get_a1_schedule():
    return [
        # DAY 1
        {
            "day": 1,
            "topic": "Lesen & Hören",
            "chapter": "0.1",
            "goal": "You will learn to introduce yourself and greet others in German.",
            "instruction": "Watch the video, review grammar, do the workbook, submit assignment.",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "https://drive.google.com/file/d/1D9Pwg29qZ89xh6caAPBcLJ1K671VUc0_/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1wjtEyPphP0N7jLbF3AWb5wN_FuJZ5jUQ/view?usp=sharing"
            }
        },
        # DAY 2 – Multi chapter
        {
            "day": 2,
            "topic": "Lesen & Hören",
            "chapter": "0.2_1.1",
            "goal": "Understand the German alphabets and know the special characters called Umlaut.",
            "instruction": "You are doing Lesen and Hören chapter 0.2 and 1.1. Make sure to follow up attentively.",
            "lesen_hören": [
                {
                    "chapter": "0.2",
                    "video": "",
                    "grammarbook_link": "https://drive.google.com/file/d/1KtJCF15Ng4cLU88wdUCX5iumOLY7ZA0a/view?usp=sharing",
                    "workbook_link": "https://drive.google.com/file/d/1R6PqzgsPm9f5iVn7JZXSNVa_NttoPU9Q/view?usp=sharing",
                    "extra_resources": "https://youtu.be/wpBPaDI5IgI"
                },
                {
                    "chapter": "1.1",
                    "video": "",
                    "grammarbook_link": "https://drive.google.com/file/d/1DKhyi-43HX1TNs8fxA9bgRvhylubilBf/view?usp=sharing",
                    "workbook_link": "https://drive.google.com/file/d/1A1D1pAssnoncF1JY0v54XT2npPb6mQZv/view?usp=sharing",
                    "extra_resources": "https://youtu.be/_Hy9_tDhgtc?si=xbfW31T4aUHeJNa_"
                }
            ]
        },
        # DAY 3
        {
            "day": 3,
            "topic": "Schreiben & Sprechen and Lesen & Hören",
            "chapter": "1.1_1.2",
            "goal": "Introduce others and talk about your family.",
            "instruction": (
                "Begin with the practicals at **Schreiben & Sprechen** (writing & speaking). "
                "Then, move to **Lesen & Hören** (reading & listening). "
                "**Do assignments only at Lesen & Hören.**\n\n"
                "Schreiben & Sprechen activities are for self-practice and have answers provided for self-check. "
                "Main assignment to be marked is under Lesen & Hören below."
            ),
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": "https://drive.google.com/file/d/1GXWzy3cvbl_goP4-ymFuYDtX4X23D70j/view?usp=sharing"
            },
            "lesen_hören": [
                {
                    "chapter": "1.2",
                    "video": "",
                    "grammarbook_link": "https://drive.google.com/file/d/1OUJT9aSU1XABi3cdZlstUvfBIndyEOwb/view?usp=sharing",
                    "workbook_link": "https://drive.google.com/file/d/1Lubevhd7zMlbvPcvHHC1D0GzW7xqa4Mp/view?usp=sharing",
                    "extra_resources": "https://www.youtube.com/watch?v=qdTEFPqjfkY&authuser=0"
                }
            ]
        },
        # DAY 4
        {
            "day": 4,
            "topic": "Lesen & Hören",
            "chapter": "2",
            "goal": "Learn numbers from one to 10 thousand. Also know the difference between city and street",
            "instruction": "Watch the video, study the grammar, complete the workbook, and send your answers.",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "https://drive.google.com/file/d/1f2CJ492liO8ccudCadxHIISwGJkHP6st/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1C4VZDUj7VT27Qrn9vS5MNc3QfRqpmDGE/view?usp=sharing"
            }
        },
        # DAY 5
        {
            "day": 5,
            "topic": "Schreiben & Sprechen (Recap)",
            "chapter": "1.2",
            "goal": "Consolidate your understanding of introductions.",
            "instruction": "Use self-practice workbook and review answers for self-check.",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": "https://drive.google.com/file/d/1ojXvizvJz_qGes7I39pjdhnmlul7xhxB/view?usp=sharing"
            }
        },
        # DAY 6
        {
            "day": 6,
            "topic": "Schreiben & Sprechen",
            "chapter": "2.3",
            "goal": "Learn about family and expressing your hobby",
            "instruction": "Use self-practice workbook and review answers for self-check.",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": "https://drive.google.com/file/d/1x_u_tyICY-8xFuxsuOW2tqTzs7g8TquM/view?usp=sharing"
            }
        },
        # DAY 7
        {
            "day": 7,
            "topic": "Lesen & Hören",
            "chapter": "3",
            "goal": "Know how to ask for a price and also the use of mogen and gern to express your hobby",
            "instruction": "Do schreiben and sprechen 2.3 before this chapter for better understanding",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "https://drive.google.com/file/d/1sCE5y8FVctySejSVNm9lrTG3slIucxqY/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1lL4yrZLMtKLnNuVTC2Sg_ayfkUZfIuak/view?usp=sharing"
            }
        },
        # DAY 8
        {
            "day": 8,
            "topic": "Lesen & Hören",
            "chapter": "4",
            "goal": "Learn about schon mal and noch nie, irregular verbs and all the personal pronouns",
            "instruction": "Watch the video, study the grammar, complete the workbook, and send your answers.",
            "lesen_hören": {
                "video": "https://youtu.be/JfTc1G9mubs",
                "grammarbook_link": "https://drive.google.com/file/d/1obsYT3dP3qT-i06SjXmqRzCT2pNoJJZp/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1woXksV9sTZ_8huXa8yf6QUQ8aUXPxVug/view?usp=sharing"
            }
        },
        # DAY 9
        {
            "day": 9,
            "topic": "Lesen & Hören",
            "chapter": "5",
            "goal": "Learn about the German articles and cases",
            "instruction": "Watch the video, study the grammar, complete the workbook, and send your answers.",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "https://drive.google.com/file/d/17y5fGW8nAbfeVgolV7tEW4BLiLXZDoO6/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1zjAqvQqNb7iKknuhJ79bUclimEaTg-mt/view?usp=sharing"
            }
        },
        # DAY 10
        {
            "day": 10,
            "topic": "Lesen & Hören and Schreiben & Sprechen",
            "chapter": "6_2.4",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "https://drive.google.com/file/d/1_qwG-6dSckoNt7G69_gGfwBH4o9HhETJ/view?usp=sharing",
                "workbook_link": "https://drive.google.com/file/d/1Da1iw54oAqoaY-UIw6oyIn8tsDmIi1YR/view?usp=sharing"
            },
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 11
        {
            "day": 11,
            "topic": "Lesen & Hören",
            "chapter": "7",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            }
        },
        # DAY 12
        {
            "day": 12,
            "topic": "Lesen & Hören",
            "chapter": "8",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            }
        },
        # DAY 13
        {
            "day": 13,
            "topic": "Schreiben & Sprechen",
            "chapter": "3.5",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 14
        {
            "day": 14,
            "topic": "Schreiben & Sprechen",
            "chapter": "3.6",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 15
        {
            "day": 15,
            "topic": "Schreiben & Sprechen",
            "chapter": "4.7",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 16
        {
            "day": 16,
            "topic": "Lesen & Hören",
            "chapter": "9_10",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            }
        },
        # DAY 17
        {
            "day": 17,
            "topic": "Lesen & Hören",
            "chapter": "11",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            }
        },
        # DAY 18
        {
            "day": 18,
            "topic": "Lesen & Hören and Schreiben & Sprechen (including 5.8)",
            "chapter": "12.1",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            },
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 19
        {
            "day": 19,
            "topic": "Schreiben & Sprechen",
            "chapter": "5.9",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 20
        {
            "day": 20,
            "topic": "Schreiben & Sprechen (Intro to letter writing)",
            "chapter": "6.10",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 21
        {
            "day": 21,
            "topic": "Lesen & Hören and Schreiben & Sprechen",
            "chapter": "13_6.11",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            },
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 22
        {
            "day": 22,
            "topic": "Lesen & Hören and Schreiben & Sprechen",
            "chapter": "14.1_7.12",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            },
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 23
        {
            "day": 23,
            "topic": "Lesen & Hören and Schreiben & Sprechen",
            "chapter": "14.2_7.12",
            "goal": "",
            "instruction": "",
            "lesen_hören": {
                "video": "",
                "grammarbook_link": "",
                "workbook_link": ""
            },
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 24
        {
            "day": 24,
            "topic": "Schreiben & Sprechen",
            "chapter": "8.13",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        },
        # DAY 25
        {
            "day": 25,
            "topic": "Exam tips - Schreiben & Sprechen recap",
            "chapter": "final",
            "goal": "",
            "instruction": "",
            "schreiben_sprechen": {
                "video": "",
                "workbook_link": ""
            }
        }
    ]


def get_a2_schedule():
    return [
        # DAY 1
        {
            "day": 1,
            "topic": "Small Talk (Exercise)",
            "chapter": "1.1",
            "goal": "Practice basic greetings and small talk.",
            "instruction": (
                "Today's lesson has 4 parts:\n\n"
                "**1. Sprechen (Group Practice):** Practice the daily question using the brain map provided. Use the chat feature in the Falowen app to speak for at least 1 minute.\n\n"
                "**2. Schreiben:** Reframe your group practice as a short letter (assignment).\n\n"
                "**3. Lesen:** Complete the reading exercise (7 questions).\n\n"
                "**4. Hören:** Do the listening exercise (5 questions).\n\n"
                "**Assignments to be submitted:** Schreiben, Lesen, and Hören.\n\n"
                "Finish all sections before submitting your answers."
            ),
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1NsCKO4K7MWI-queLWCeBuclmaqPN04YQ/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1LXDI1yyJ4aT4LhX5eGDbKnkCkJZ2EE2T/view?usp=sharing"
        },
        # DAY 2
        {
            "day": 2,
            "topic": "Personen Beschreiben (Exercise)",
            "chapter": "1.2",
            "goal": "Describe people and their appearance.",
            "instruction": (
                "Today's lesson has 4 parts:\n\n"
                "**1. Sprechen (Group Practice):** Practice describing people using the brain map and discuss in the Falowen chat for at least 1 minute.\n\n"
                "**2. Schreiben:** Write a short letter about a person.\n\n"
                "**3. Lesen:** Do the reading exercise (7 questions).\n\n"
                "**4. Hören:** Complete the listening exercise (5 questions).\n\n"
                "**Assignments to be submitted:** Schreiben, Lesen, and Hören.\n\n"
                "Finish all sections before submitting your answers."
            ),
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1VB_nXEfdeTgkzCYjh0tvE75zFJleMlyU/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/128lWaKgCZ2V-3tActM-dwNy6igLLlzH3/view?usp=sharing"
        },
        # DAY 3
        {
            "day": 3,
            "topic": "Dinge und Personen vergleichen",
            "chapter": "1.3",
            "goal": "Learn to compare things and people.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1Z3sSDCxPQz27TDSpN9r8lQUpHhBVfhYZ/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/18YXe9mxyyKTars1gL5cgFsXrbM25kiN8/view?usp=sharing"
        },
        # DAY 4
        {
            "day": 4,
            "topic": "Wo möchten wir uns treffen?",
            "chapter": "2.4",
            "goal": "Arrange and discuss meeting places.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/14qE_XJr3mTNr6PF5aa0aCqauh9ngYTJ8/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1RaXTZQ9jHaJYwKrP728zevDSQHFKeR0E/view?usp=sharing"
        },
        # DAY 5
        {
            "day": 5,
            "topic": "Was machst du in deiner Freizeit?",
            "chapter": "2.5",
            "goal": "Talk about free time activities.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/11yEcMioSB9x1ZD-x5_67ApFzP53iau-N/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1dIsFg7wNaqyyOHm95h7xv4Ssll5Fm0V1/view?usp=sharing"
        },
        # DAY 6
        {
            "day": 6,
            "topic": "Möbel und Räume kennenlernen",
            "chapter": "3.6",
            "goal": "Identify furniture and rooms.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1clWbDAvLlXpgWx7pKc71Oq3H2p0_GZnV/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1EF87TdHa6Y-qgLFUx8S6GAom9g5EBQNP/view?usp=sharing"
        },
        # DAY 7
        {
            "day": 7,
            "topic": "Eine Wohnung suchen (Übung)",
            "chapter": "3.7",
            "goal": "Practice searching for an apartment.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1MSahBEyElIiLnitWoJb5xkvRlB21yo0y/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/16UfBIrL0jxCqWtqqZaLhKWflosNQkwF4/view?usp=sharing"
        },
        # DAY 8
        {
            "day": 8,
            "topic": "Rezepte und Essen (Exercise)",
            "chapter": "3.8",
            "goal": "Learn about recipes and food.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1Ax6owMx-5MPvCk_m-QRhARY8nuDQjDsK/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1c8JJyVlKYI2mz6xLZZ6RkRHLnH3Dtv0c/view?usp=sharing"
        },
        # DAY 9
        {
            "day": 9,
            "topic": "Urlaub",
            "chapter": "4.9",
            "goal": "Discuss vacation plans.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1kOb7c08Pkxf21OQE_xIGEaif7Xq7k-ty/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1NzRxbGUe306Vq0mq9kKsc3y3HYqkMhuA/view?usp=sharing"
        },
        # DAY 10
        {
            "day": 10,
            "topic": "Tourismus und Traditionelle Feste",
            "chapter": "4.10",
            "goal": "Learn about tourism and festivals.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1snFsDYBK8RrPRq2n3PtWvcIctSph-zvN/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1vijZn-ryhT46cTzGmetuF0c4zys0yGlB/view?usp=sharing"
        },
        # DAY 11
        {
            "day": 11,
            "topic": "Unterwegs: Verkehrsmittel vergleichen",
            "chapter": "4.11",
            "goal": "Compare means of transportation.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1Vl9UPeM2RaATafT8t539aOPrxnSkfr9A/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1snFsDYBK8RrPRq2n3PtWvcIctSph-zvN/view?usp=sharing"
        },
        # DAY 12
        {
            "day": 12,
            "topic": "Ein Tag im Leben (Übung)",
            "chapter": "5.12",
            "goal": "Describe a typical day.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1ayExWDJ8rTEL8hsuMgbil5_ddDPO8z29/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/18u6FnHpd2nAh1Ev_2mVk5aV3GdVC6Add/view?usp=sharing"
        },
        # DAY 13
        {
            "day": 13,
            "topic": "Ein Vorstellungsgespräch (Exercise)",
            "chapter": "5.13",
            "goal": "Prepare for a job interview.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 14
        {
            "day": 14,
            "topic": "Beruf und Karriere (Exercise)",
            "chapter": "5.14",
            "goal": "Discuss jobs and careers.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 15
        {
            "day": 15,
            "topic": "Mein Lieblingssport",
            "chapter": "6.15",
            "goal": "Talk about your favorite sport.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 16
        {
            "day": 16,
            "topic": "Wohlbefinden und Entspannung",
            "chapter": "6.16",
            "goal": "Express well-being and relaxation.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 17
        {
            "day": 17,
            "topic": "In die Apotheke gehen",
            "chapter": "6.17",
            "goal": "Learn phrases for the pharmacy.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 18
        {
            "day": 18,
            "topic": "Die Bank anrufen",
            "chapter": "7.18",
            "goal": "Practice calling the bank.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 19
        {
            "day": 19,
            "topic": "Einkaufen? Wo und wie? (Exercise)",
            "chapter": "7.19",
            "goal": "Shop and ask about locations.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 20
        {
            "day": 20,
            "topic": "Typische Reklamationssituationen üben",
            "chapter": "7.20",
            "goal": "Handle typical complaints.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1-72wZuNJE4Y92Luy0h5ygWooDnBd9PQW/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1_GTumT1II0E1PRoh6hMDwWsTPEInGeed/view?usp=sharing"
        },
        # DAY 21
        {
            "day": 21,
            "topic": "Ein Wochenende planen",
            "chapter": "8.21",
            "goal": "Plan a weekend.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1FcCg7orEizna4rAkX3_FCyd3lh_Bb3IT/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1mMtZza34QoJO_lfUiEX3kwTa-vsTN_RK/view?usp=sharing"
        },
        # DAY 22
        {
            "day": 22,
            "topic": "Die Woche Planung",
            "chapter": "8.22",
            "goal": "Make a weekly plan.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1dWr4QHw8zT1RPbuIEr_X13cPLYpH-mms/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1mg_2ytNAYF00_j-TFQelajAxgQpmgrhW/view?usp=sharing"
        },
        # DAY 23
        {
            "day": 23,
            "topic": "Wie kommst du zur Schule / zur Arbeit?",
            "chapter": "9.23",
            "goal": "Talk about your route to school or work.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1XbWKmc5P7ZAR-OqFce744xqCe7PQguXo/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1Ialg19GIE_KKHiLBDMm1aHbrzfNdb7L_/view?usp=sharing"
        },
        # DAY 24
        {
            "day": 24,
            "topic": "Einen Urlaub planen",
            "chapter": "9.24",
            "goal": "Plan a vacation.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "https://drive.google.com/file/d/1tFXs-DNKvt97Q4dsyXsYvKVQvT5Qqt0y/view?usp=sharing",
            "workbook_link": "https://drive.google.com/file/d/1t3xqddDJp3-1XeJ6SesnsYsTO5xSm9vG/view?usp=sharing"
        },
        # DAY 25
        {
            "day": 25,
            "topic": "Tagesablauf (Exercise)",
            "chapter": "9.25",
            "goal": "Describe a daily routine.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "workbook_link": "https://drive.google.com/file/d/1jfWDzGfXrzhfGZ1bQe1u5MXVQkR5Et43/view?usp=sharing"
        },
        # DAY 26
        {
            "day": 26,
            "topic": "Gefühle in verschiedenen Situationen beschreiben",
            "chapter": "10.26",
            "goal": "Express feelings in various situations.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "workbook_link": "https://drive.google.com/file/d/126MQiti-lpcovP1TdyUKQAK6KjqBaoTx/view?usp=sharing"
        },
        # DAY 27
        {
            "day": 27,
            "topic": "Digitale Kommunikation",
            "chapter": "10.27",
            "goal": "Talk about digital communication.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "workbook_link": "https://drive.google.com/file/d/1UdBu6O2AMQ2g6Ot_abTsFwLvT87LHHwY/view?usp=sharing"
        },
        # DAY 28
        {
            "day": 28,
            "topic": "Über die Zukunft sprechen",
            "chapter": "10.28",
            "goal": "Discuss the future.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "workbook_link": "https://drive.google.com/file/d/1164aJFtkZM1AMb87s1-K59wuobD7q34U/view?usp=sharing"
        },
    ]

def get_b1_schedule():
    return [
        # DAY 1
        {
            "day": 1,
            "topic": "Traumwelten (Übung)",
            "chapter": "1.1",
            "goal": "Talk about dream worlds and imagination.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 2
        {
            "day": 2,
            "topic": "Freunde fürs Leben (Übung)",
            "chapter": "1.2",
            "goal": "Discuss friendships and important qualities.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 3
        {
            "day": 3,
            "topic": "Vergangenheit erzählen",
            "chapter": "1.3",
            "goal": "Tell stories about the past.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 4
        {
            "day": 4,
            "topic": "Wohnen und Zusammenleben",
            "chapter": "2.1",
            "goal": "Discuss housing and living together.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 5
        {
            "day": 5,
            "topic": "Feste feiern",
            "chapter": "2.2",
            "goal": "Talk about festivals and celebrations.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 6
        {
            "day": 6,
            "topic": "Mein Traumjob",
            "chapter": "2.3",
            "goal": "Describe your dream job.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 7
        {
            "day": 7,
            "topic": "Gesund bleiben",
            "chapter": "3.1",
            "goal": "Learn how to talk about health and fitness.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 8
        {
            "day": 8,
            "topic": "Arztbesuch und Gesundheitstipps",
            "chapter": "3.2",
            "goal": "Communicate with a doctor and give health tips.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 9
        {
            "day": 9,
            "topic": "Erinnerungen und Kindheit",
            "chapter": "3.3",
            "goal": "Talk about childhood memories.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 10
        {
            "day": 10,
            "topic": "Typisch deutsch? Kultur und Alltag",
            "chapter": "4.1",
            "goal": "Discuss cultural habits and everyday life.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 11
        {
            "day": 11,
            "topic": "Wünsche und Träume",
            "chapter": "4.2",
            "goal": "Express wishes and dreams.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 12
        {
            "day": 12,
            "topic": "Medien und Kommunikation",
            "chapter": "4.3",
            "goal": "Talk about media and communication.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 13
        {
            "day": 13,
            "topic": "Reisen und Verkehr",
            "chapter": "5.1",
            "goal": "Discuss travel and transportation.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 14
        {
            "day": 14,
            "topic": "Stadt oder Land",
            "chapter": "5.2",
            "goal": "Compare life in the city and the countryside.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 15
        {
            "day": 15,
            "topic": "Wohnungssuche und Umzug",
            "chapter": "5.3",
            "goal": "Talk about searching for an apartment and moving.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 16
        {
            "day": 16,
            "topic": "Natur und Umwelt",
            "chapter": "6.1",
            "goal": "Learn to discuss nature and the environment.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 17
        {
            "day": 17,
            "topic": "Probleme und Lösungen",
            "chapter": "6.2",
            "goal": "Describe problems and find solutions.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 18
        {
            "day": 18,
            "topic": "Arbeit und Finanzen",
            "chapter": "6.3",
            "goal": "Talk about work and finances.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 19
        {
            "day": 19,
            "topic": "Berufliche Zukunft",
            "chapter": "7.1",
            "goal": "Discuss future career plans.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 20
        {
            "day": 20,
            "topic": "Bildung und Weiterbildung",
            "chapter": "7.2",
            "goal": "Talk about education and further studies.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 21
        {
            "day": 21,
            "topic": "Familie und Gesellschaft",
            "chapter": "7.3",
            "goal": "Discuss family and society.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 22
        {
            "day": 22,
            "topic": "Konsum und Werbung",
            "chapter": "8.1",
            "goal": "Talk about consumption and advertising.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 23
        {
            "day": 23,
            "topic": "Globalisierung",
            "chapter": "8.2",
            "goal": "Discuss globalization and its effects.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 24
        {
            "day": 24,
            "topic": "Kulturelle Unterschiede",
            "chapter": "8.3",
            "goal": "Talk about cultural differences.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 25
        {
            "day": 25,
            "topic": "Lebenslauf schreiben",
            "chapter": "9.1",
            "goal": "Write a CV and cover letter.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 26
        {
            "day": 26,
            "topic": "Präsentationen halten",
            "chapter": "9.2",
            "goal": "Learn to give presentations.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 27
        {
            "day": 27,
            "topic": "Zusammenfassen und Berichten",
            "chapter": "9.3",
            "goal": "Practice summarizing and reporting.",
            "instruction": "Watch the video, review grammar, and complete your workbook.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
        # DAY 28
        {
            "day": 28,
            "topic": "Abschlussprüfungsvorbereitung",
            "chapter": "10.1",
            "goal": "Prepare for the final exam.",
            "instruction": "Review all topics, watch the revision video, and complete your mock exam.",
            "video": "",
            "grammarbook_link": "",
            "workbook_link": ""
        },
    ]



# --------------------------------------

# --- FORCE A MOCK LOGIN FOR TESTING ---
if "student_row" not in st.session_state:
    st.session_state["student_row"] = {
        "Name": "Test Student",
        "Level": "A1",
        "StudentCode": "demo001"
    }
# --------------------------------------

if tab == "Course Book":

    import streamlit as st
    import datetime, urllib.parse

    # 1. Pick schedule based on student
    student_row = st.session_state.get('student_row', {})
    student_level = student_row.get('Level', 'A1').upper()
    level_map = {
        "A1": get_a1_schedule(),
        "A2": get_a2_schedule(),
        "B1": get_b1_schedule(),
    }
    schedule = level_map.get(student_level, get_a1_schedule())

    if not schedule:
        st.warning("No schedule found for your level. Please contact the admin.")
        st.stop()


    selected_day_idx = st.selectbox(
        "📅 Choose your lesson/day:",
        range(len(schedule)),
        format_func=lambda i: f"Day {schedule[i]['day']} – {schedule[i]['topic']}"
    )
    day_info = schedule[selected_day_idx]

    st.markdown(f"### Day {day_info['day']}: {day_info['topic']} (Chapter {day_info['chapter']})")

    if day_info.get("goal"):
        st.markdown(f"**🎯 Goal:**<br>{day_info['goal']}", unsafe_allow_html=True)
    if day_info.get("instruction"):
        st.markdown(f"**📝 Instruction:**<br>{day_info['instruction']}", unsafe_allow_html=True)

    # --------- Show Lesen & Hören ----------
    def render_lh_section(lh, idx=None, total=None):
        if idx is not None and total is not None:
            st.markdown(
                f"#### 📚 Assignment {idx+1} of {total}: Lesen & Hören – Chapter {lh.get('chapter','')}")
        if lh.get("video"):
            st.video(lh["video"])
        if lh.get("grammarbook_link"):
            st.markdown(
                f"<a href='{lh['grammarbook_link']}' target='_blank' style='font-size:1.1em; color:#357ae8; font-weight:bold;'>📘 Open Grammar Book</a>",
                unsafe_allow_html=True)
        if lh.get("workbook_link"):
            st.markdown(
                f"<a href='{lh['workbook_link']}' target='_blank' style='font-size:1.1em; color:#34a853; font-weight:bold;'>📒 Open Workbook</a>",
                unsafe_allow_html=True)
        extras = lh.get('extra_resources')
        if extras:
            if isinstance(extras, list):
                for link in extras:
                    st.markdown(f"- [🔗 Extra Resource]({link})")
            else:
                st.markdown(f"- [🔗 Extra Resource]({extras})")

    # Multi assignment note (clean, mobile-friendly)
    if "lesen_hören" in day_info:
        lh_section = day_info["lesen_hören"]
        if isinstance(lh_section, list):
            st.markdown(
                """
                <div style='padding:8px 12px; background:#eaf4ff; border-radius:7px; 
                border-left:5px solid #357ae8; margin-bottom:12px; font-size:1.03em; line-height:1.3;'>
                    <span style="font-weight:600; color:#357ae8;">ℹ️ This lesson has more than one Lesen & Hören assignment.<br>
                    Do <u>all parts below</u> before you submit.</span>
                </div>
                """, unsafe_allow_html=True
            )
            for idx, chapter_lh in enumerate(lh_section):
                render_lh_section(chapter_lh, idx, len(lh_section))
        elif isinstance(lh_section, dict):
            render_lh_section(lh_section)

    # --- Show Schreiben & Sprechen (if present) ---
    if "schreiben_sprechen" in day_info:
        ss = day_info["schreiben_sprechen"]
        st.markdown("#### 📝 Schreiben & Sprechen")
        if ss.get("video"):
            st.video(ss["video"])
        if ss.get("grammarbook_link"):
            st.markdown(
                f"<a href='{ss['grammarbook_link']}' target='_blank' style='font-size:1.1em; color:#357ae8; font-weight:bold;'>📘 Open Grammar Book</a>",
                unsafe_allow_html=True)
        if ss.get("workbook_link"):
            st.markdown(
                f"<a href='{ss['workbook_link']}' target='_blank' style='font-size:1.1em; color:#34a853; font-weight:bold;'>📒 Open Workbook</a>",
                unsafe_allow_html=True)
        extras = ss.get('extra_resources')
        if extras:
            if isinstance(extras, list):
                for link in extras:
                    st.markdown(f"- [🔗 Extra Resource]({link})")
            else:
                st.markdown(f"- [🔗 Extra Resource]({extras})")

    # ---------- For A2/B1/B2: Show all at top level ----------
    if student_level in ["A2", "B1", "B2"]:
        if day_info.get("video"):
            st.video(day_info["video"])
        if day_info.get("grammarbook_link"):
            st.markdown(
                f"<a href='{day_info['grammarbook_link']}' target='_blank' "
                "style='font-size:1.1em; color:#357ae8; font-weight:bold;'>📘 Open Grammar Book</a>",
                unsafe_allow_html=True)
        if day_info.get("workbook_link"):
            st.markdown(
                f"<a href='{day_info['workbook_link']}' target='_blank' "
                "style='font-size:1.1em; color:#34a853; font-weight:bold;'>📒 Open Workbook</a>",
                unsafe_allow_html=True)
        extras = day_info.get('extra_resources')
        if extras:
            if isinstance(extras, list):
                for link in extras:
                    st.markdown(f"- [🔗 Extra Resource]({link})")
            else:
                st.markdown(f"- [🔗 Extra Resource]({extras})")


    # --- Assignment Submission Section (WhatsApp) ---
    st.divider()
    st.subheader("📲 Submit Assignment (WhatsApp)")
    student_name = st.text_input("Your Name", value=student_row.get('Name', ''))
    student_code = st.text_input("Student Code", value=student_row.get('StudentCode', ''))
    answer = st.text_area("Your Answer (leave blank if sending file/photo on WhatsApp)", height=90)

    wa_message = f"""Learn Language Education Academy – Assignment Submission
Name: {student_name}
Code: {student_code}
Level: {student_level}
Day: {day_info['day']}
Chapter: {day_info['chapter']}
Date: {datetime.datetime.now():%Y-%m-%d %H:%M}
Answer: {answer if answer.strip() else '[See attached file/photo]'}
"""
    wa_url = "https://api.whatsapp.com/send?phone=233205706589&text=" + urllib.parse.quote(wa_message)

    if st.button("📤 Submit via WhatsApp"):
        st.success("Click the link below to open WhatsApp and send your assignment!")
        st.markdown(
            f"""<a href="{wa_url}" target="_blank" style="font-size:1.15em;font-weight:600;display:inline-block;background:#25D366;color:white;padding:12px 24px;border-radius:8px;margin:10px 0;">Open WhatsApp</a>""",
            unsafe_allow_html=True
        )
        st.text_area("Message to Copy (if needed):", wa_message, height=70)

    st.info("""
- Tap the links above to open books on your phone. No PDF preview, all links open in a new tab.
- Submit only your main assignment below (if more than one, mention which).
- Always use your real name and code for tracking!
""")


#Myresults

if tab == "My Results and Resources":
    # Always define these at the top
    student_code = st.session_state.get("student_code", "")
    student_name = st.session_state.get("student_name", "")
    st.header("📈 My Results and Resources Hub")
    st.markdown("View and download your assignment history. All results are private and only visible to you.")

    # === LIVE GOOGLE SHEETS CSV LINK ===
    GOOGLE_SHEET_CSV = "https://docs.google.com/spreadsheets/d/1BRb8p3Rq0VpFCLSwL4eS9tSgXBo9hSWzfW_J_7W36NQ/gviz/tq?tqx=out:csv"

    import requests
    import io
    import pandas as pd
    from fpdf import FPDF

    @st.cache_data
    def fetch_scores():
        response = requests.get(GOOGLE_SHEET_CSV, timeout=7)
        response.raise_for_status()
        df = pd.read_csv(io.StringIO(response.text), engine='python')

        # Clean and validate columns
        df.columns = [col.strip().lower().replace('studentcode', 'student_code') for col in df.columns]

        # Drop rows with missing *required* fields
        required_cols = ["student_code", "name", "assignment", "score", "date", "level"]
        df = df.dropna(subset=required_cols)

        return df

    df_scores = fetch_scores()
    required_cols = {"student_code", "name", "assignment", "score", "date", "level"}
    if not required_cols.issubset(df_scores.columns):
        st.error("Data format error. Please contact support.")
        st.write("Columns found:", df_scores.columns.tolist())  # <-- for debugging
        st.stop()

    # Filter for current student
    code = st.session_state.get("student_code", "").lower().strip()
    df_user = df_scores[df_scores.student_code.str.lower().str.strip() == code]
    if df_user.empty:
        st.info("No results yet. Complete an assignment to see your scores!")
        st.stop()

    # Choose level
    df_user['level'] = df_user.level.str.upper().str.strip()
    levels = sorted(df_user['level'].unique())
    level = st.selectbox("Select level:", levels)
    df_lvl = df_user[df_user.level == level]

    # Summary metrics
    totals = {"A1": 18, "A2": 28, "B1": 26, "B2": 24}
    total = totals.get(level, 0)
    completed = df_lvl.assignment.nunique()
    avg_score = df_lvl.score.mean() or 0
    best_score = df_lvl.score.max() or 0

    # Display metrics in columns
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Assignments", total)
    col2.metric("Completed", completed)
    col3.metric("Average Score", f"{avg_score:.1f}")
    col4.metric("Best Score", best_score)

    # Detailed results
    with st.expander("See detailed results", expanded=False):
        df_display = (
            df_lvl.sort_values(['assignment', 'score'], ascending=[True, False])
                 [['assignment', 'score', 'date']]
                 .reset_index(drop=True)
        )
        st.table(df_display)

    # Download PDF summary
    if st.button("⬇️ Download PDF Summary"):
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", 'B', 14)
        pdf.cell(0, 10, "Learn Language Education Academy", ln=1, align='C')
        pdf.ln(5)
        pdf.set_font("Arial", '', 12)
        pdf.multi_cell(
            0, 8,
            f"Name: {df_user.name.iloc[0]}\n"
            f"Code: {code}\n"
            f"Level: {level}\n"
            f"Date: {pd.Timestamp.now():%Y-%m-%d %H:%M}"
        )
        pdf.ln(4)
        pdf.set_font("Arial", 'B', 12)
        pdf.cell(0, 8, "Summary Metrics", ln=1)
        pdf.set_font("Arial", '', 11)
        pdf.cell(0, 8, f"Total: {total}, Completed: {completed}, Avg: {avg_score:.1f}, Best: {best_score}", ln=1)
        pdf.ln(4)
        pdf.set_font("Arial", 'B', 12)
        pdf.cell(0, 8, "Detailed Results", ln=1)
        pdf.set_font("Arial", '', 10)
        for _, row in df_display.iterrows():
            pdf.cell(0, 7, f"{row['assignment']}: {row['score']} ({row['date']})", ln=1)
        pdf_bytes = pdf.output(dest='S').encode('latin1', 'replace')
        st.download_button(
            label="Download PDF",
            data=pdf_bytes,
            file_name=f"{code}_results_{level}.pdf",
            mime="application/pdf"
        )

if tab == "Admin":
    # --- Admin Auth ---
    if not st.session_state.get("is_admin", False):
        admin_pw = st.text_input("Enter admin password:", type="password", key="admin_pw")
        if st.button("Login as Admin"):
            ADMIN_PASSWORD = "Felix029"
            if admin_pw == ADMIN_PASSWORD:
                st.session_state["is_admin"] = True
                st.success("Welcome, Admin!")
                st.rerun()
            else:
                st.error("Incorrect password.")
        st.stop()
    else:
        st.info("You are logged in as admin.")

        # --- Force Refresh Button ---
        if st.button("🔄 Force Refresh All Data"):
            st.cache_data.clear()
            st.success("Cache cleared! Reloading…")
            st.rerun()

        st.subheader("Student Data Backup & Restore")

        # ===== Download/Backup Section =====
        import pandas as pd

        # --- Student Scores Backup ---
        st.markdown("### 📥 Download Backups")

        # Scores (assignment marking) backup
        try:
            conn_scores = sqlite3.connect('scores.db')
            df_scores = pd.read_sql_query("SELECT * FROM scores", conn_scores)
            csv_scores = df_scores.to_csv(index=False).encode('utf-8')
            st.download_button("⬇️ Download Scores Backup", csv_scores, file_name="scores_backup.csv", mime="text/csv")
        except Exception as e:
            st.warning(f"Could not load scores: {e}")

        # Vocab Progress backup
        try:
            conn_vocab = sqlite3.connect('vocab_progress.db')
            df_vocab = pd.read_sql_query("SELECT * FROM vocab_progress", conn_vocab)
            csv_vocab = df_vocab.to_csv(index=False).encode('utf-8')
            st.download_button("⬇️ Download Vocab Progress", csv_vocab, file_name="vocab_progress_backup.csv", mime="text/csv")
        except Exception as e:
            st.warning(f"Could not load vocab progress: {e}")

        # Schreiben Progress backup
        try:
            conn_schreiben = sqlite3.connect('vocab_progress.db')
            df_schreiben = pd.read_sql_query("SELECT * FROM schreiben_progress", conn_schreiben)
            csv_schreiben = df_schreiben.to_csv(index=False).encode('utf-8')
            st.download_button("⬇️ Download Schreiben Progress", csv_schreiben, file_name="schreiben_progress_backup.csv", mime="text/csv")
        except Exception as e:
            st.warning(f"Could not load schreiben progress: {e}")

        # Sprechen Progress backup (if table exists)
        try:
            conn_sprechen = sqlite3.connect('vocab_progress.db')
            df_sprechen = pd.read_sql_query("SELECT * FROM sprechen_progress", conn_sprechen)
            csv_sprechen = df_sprechen.to_csv(index=False).encode('utf-8')
            st.download_button("⬇️ Download Sprechen Progress", csv_sprechen, file_name="sprechen_progress_backup.csv", mime="text/csv")
        except Exception as e:
            st.info("No Sprechen Progress table found. (If not used, ignore this warning.)")

        # ===== Upload/Restore Section =====
        st.markdown("### 📤 Restore from Backup (Upload, overwrites current data)")

        # --- Scores Upload ---
        uploaded_scores = st.file_uploader("Upload Scores CSV", type="csv", key="up_scores")
        if uploaded_scores:
            try:
                df_new = pd.read_csv(uploaded_scores)
                conn_scores = sqlite3.connect('scores.db')
                df_new.to_sql('scores', conn_scores, if_exists='replace', index=False)
                st.success("Scores data uploaded & replaced.")
            except Exception as e:
                st.error(f"Upload failed: {e}")

        # --- Vocab Progress Upload ---
        uploaded_vocab = st.file_uploader("Upload Vocab Progress CSV", type="csv", key="up_vocab")
        if uploaded_vocab:
            try:
                df_new = pd.read_csv(uploaded_vocab)
                conn_vocab = sqlite3.connect('vocab_progress.db')
                df_new.to_sql('vocab_progress', conn_vocab, if_exists='replace', index=False)
                st.success("Vocab Progress uploaded & replaced.")
            except Exception as e:
                st.error(f"Upload failed: {e}")

        # --- Schreiben Progress Upload ---
        uploaded_schreiben = st.file_uploader("Upload Schreiben Progress CSV", type="csv", key="up_schreiben")
        if uploaded_schreiben:
            try:
                df_new = pd.read_csv(uploaded_schreiben)
                conn_schreiben = sqlite3.connect('vocab_progress.db')
                df_new.to_sql('schreiben_progress', conn_schreiben, if_exists='replace', index=False)
                st.success("Schreiben Progress uploaded & replaced.")
            except Exception as e:
                st.error(f"Upload failed: {e}")

        # --- Sprechen Progress Upload ---
        uploaded_sprechen = st.file_uploader("Upload Sprechen Progress CSV", type="csv", key="up_sprechen")
        if uploaded_sprechen:
            try:
                df_new = pd.read_csv(uploaded_sprechen)
                conn_sprechen = sqlite3.connect('vocab_progress.db')
                df_new.to_sql('sprechen_progress', conn_sprechen, if_exists='replace', index=False)
                st.success("Sprechen Progress uploaded & replaced.")
            except Exception as e:
                st.error(f"Upload failed: {e}")

        # --- Show all students table (as before) ---
        st.markdown("---")
        st.markdown("### 👀 View All Student Records")
        df_students = load_student_data()
        st.dataframe(df_students)
