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

import io
import csv
from fpdf import FPDF

def get_chat_csv(messages):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Role", "Message"])
    for msg in messages:
        writer.writerow([msg["role"], msg["content"]])
    return output.getvalue().encode("utf-8")

def get_chat_pdf(messages):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    pdf.cell(200, 10, "Falowen Conversation", ln=1, align='C')
    pdf.ln(4)
    for msg in messages:
        role = "Tutor" if msg["role"] == "assistant" else "You"
        content = msg["content"]
        pdf.set_font("Arial", style='B', size=11)
        pdf.cell(0, 8, f"{role}:", ln=1)
        pdf.set_font("Arial", size=11)
        for line in content.split('\n'):
            pdf.multi_cell(0, 8, line)
        pdf.ln(2)
    return pdf.output(dest="S").encode("latin-1")

# --- Secure API key ---
# Try environment variable first, then Streamlit secrets
import os
api_key = os.getenv("OPENAI_API_KEY") or st.secrets.get("general", {}).get("OPENAI_API_KEY")
if not api_key:
    st.error("❌ API key not found. Set the OPENAI_API_KEY environment variable or add it to .streamlit/secrets.toml under [general].")
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
                st.stop()
    st.stop()

# --- Sidebar Profile & Settings ---
st.sidebar.markdown(f"**Logged in as:** {st.session_state['user_email']}")
if st.sidebar.button("🔓 Log out"):
    del st.session_state["user_email"]
    st.stop()

# Load usage
df_usage = load_usage()

def increment_usage():
    today = pd.Timestamp(datetime.now().date())
    mask = (df_usage.user_email == st.session_state['user_email']) & (df_usage.date == today)
    if not mask.any():
        df_usage.loc[len(df_usage)] = [st.session_state['user_email'], today, 0]
    idx = df_usage.index[mask][0] if mask.any() else len(df_usage)-1
    df_usage.at[idx, 'count'] += 1
    save_usage(df_usage)

# Tutor definitions & scenarios
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
    "Ordering at a Restaurant": {
        "German": "Du bist Gast in einem Restaurant. Bestelle ein Essen und ein Getränk beim Kellner.",
        "French": "Vous êtes au restaurant. Commandez un plat et une boisson auprès du serveur.",
        "English": "You are in a restaurant. Order a meal and a drink from the waiter.",
        "Spanish": "Estás en un restaurante. Pide una comida y una bebida al camarero.",
        "Italian": "Sei al ristorante. Ordina un pasto e una bevanda al cameriere.",
        "Portuguese": "Você está em um restaurante. Peça uma refeição e uma bebida ao garçom.",
        "Chinese": "你在餐厅。向服务员点一份餐和一杯饮料。",
        "Arabic": "أنت في مطعم. اطلب وجبة ومشروبًا من النادل."
    },
    "Checking into a Hotel": {
        "German": "Du bist an der Hotelrezeption. Melde dich an und frage nach Frühstückszeiten.",
        "French": "Vous êtes à la réception de l'hôtel. Enregistrez-vous et demandez les horaires du petit-déjeuner.",
        "English": "You are at a hotel reception. Check in and ask about breakfast times.",
        "Spanish": "Estás en la recepción de un hotel. Regístrate y pregunta por los horarios del desayuno.",
        "Italian": "Sei alla reception dell'hotel. Fai il check-in e chiedi gli orari della colazione.",
        "Portuguese": "Você está na recepção do hotel. Faça o check-in e pergunte sobre os horários do café da manhã.",
        "Chinese": "你在酒店前台。办理入住并询问早餐时间。",
        "Arabic": "أنت في استقبال الفندق. سجّل دخولك واسأل عن مواعيد الإفطار."
    },
    "Asking for Directions": {
        "German": "Du hast dich verlaufen. Frage jemanden auf der Straße nach dem Weg zum Bahnhof.",
        "French": "Vous êtes perdu. Demandez à quelqu'un dans la rue le chemin pour aller à la gare.",
        "English": "You are lost. Ask someone in the street for directions to the train station.",
        "Spanish": "Estás perdido. Pregunta a alguien en la calle cómo llegar a la estación de tren.",
        "Italian": "Ti sei perso. Chiedi a qualcuno per strada come arrivare alla stazione.",
        "Portuguese": "Você está perdido. Pergunte a alguém na rua como chegar à estação de trem.",
        "Chinese": "你迷路了。向路人询问去火车站怎么走。",
        "Arabic": "لقد ضللت الطريق. اسأل شخصًا في الشارع عن الطريق إلى محطة القطار."
    },
    "Shopping for Clothes": {
        "German": "Du bist in einem Bekleidungsgeschäft. Frage nach einer anderen Größe und dem Preis.",
        "French": "Vous êtes dans un magasin de vêtements. Demandez une autre taille et le prix.",
        "English": "You are in a clothing store. Ask for another size and the price.",
        "Spanish": "Estás en una tienda de ropa. Pide otra talla y pregunta el precio.",
        "Italian": "Sei in un negozio di abbigliamento. Chiedi un'altra taglia e il prezzo.",
        "Portuguese": "Você está em uma loja de roupas. Peça outro tamanho e pergunte o preço.",
        "Chinese": "你在服装店。请问有没有别的尺码，多少钱？",
        "Arabic": "أنت في متجر ملابس. اطلب مقاسًا آخر واسأل عن السعر."
    },
    "Making a Doctor's Appointment": {
        "German": "Du möchtest einen Arzttermin vereinbaren. Erkläre deine Beschwerden.",
        "French": "Vous souhaitez prendre rendez-vous chez le médecin. Expliquez vos symptômes.",
        "English": "You want to make a doctor's appointment. Explain your symptoms.",
        "Spanish": "Quieres pedir cita con el médico. Explica tus síntomas.",
        "Italian": "Vuoi prendere un appuntamento dal medico. Spiega i tuoi sintomi.",
        "Portuguese": "Você quer marcar uma consulta médica. Explique seus sintomas.",
        "Chinese": "你想预约医生。说明你的症状。",
        "Arabic": "تريد حجز موعد عند الطبيب. اشرح أعراضك."
    },
    "Booking Travel Tickets": {
        "German": "Du bist am Ticketschalter. Kaufe ein Zugticket nach Berlin für morgen früh.",
        "French": "Vous êtes au guichet. Achetez un billet de train pour Paris pour demain matin.",
        "English": "You are at the ticket counter. Buy a train ticket to London for tomorrow morning.",
        "Spanish": "Estás en la taquilla. Compra un billete de tren a Madrid para mañana por la mañana.",
        "Italian": "Sei alla biglietteria. Acquista un biglietto del treno per Roma per domani mattina.",
        "Portuguese": "Você está na bilheteria. Compre uma passagem de trem para Lisboa para amanhã de manhã.",
        "Chinese": "你在售票处。买一张明天早上去上海的火车票。",
        "Arabic": "أنت في شباك التذاكر. اشترِ تذكرة قطار إلى القاهرة صباح الغد."
    }

# Cultural Fun Facts per Language
cultural_facts = {
    "German": [
        "In Germany, bread is a big part of the culture—there are over 300 kinds of bread!",
        "Most Germans separate their garbage into at least five categories for recycling.",
        "The Autobahn is famous for having stretches with no speed limit.",
        "Christmas markets originated in Germany and are a big tradition.",
        "Germans love their sausages—there are more than 1,500 types!"
    ],
    "French": [
        "France is the most visited country in the world.",
        "Baguettes are so important in France, there are laws regulating their price and ingredients.",
        "The French eat around 30,000 tons of snails every year.",
        "The Eiffel Tower was supposed to be a temporary structure.",
        "In France, lunch breaks often last up to two hours!"
    ],
    "English": [
        "English is the official language of the air—pilots worldwide must communicate in English.",
        "The UK is home to over 1,500 castles.",
        "Tea is a central part of British culture.",
        "The United States has no official national language, but English is the most widely spoken.",
        "Australia is the only continent covered by a single country that speaks English."
    ],
    "Spanish": [
        "Spanish is the second-most spoken language in the world by native speakers.",
        "The tooth fairy in Spain is actually a mouse called 'El Ratón Pérez.'",
        "In Spain, people often eat dinner as late as 10 p.m.",
        "There are 21 countries with Spanish as an official language.",
        "Spanish has two words for 'to be': 'ser' and 'estar.'"
    ],
    "Italian": [
        "Italy is home to the most UNESCO World Heritage sites in the world.",
        "Italians eat more pasta than anyone else in the world.",
        "Italians invented the thermometer in 1612.",
        "The Italian language has over 250,000 words.",
        "Opera was born in Italy at the end of the 16th century."
    ],
    "Portuguese": [
        "Portuguese is the official language of nine countries.",
        "Brazil is the largest Portuguese-speaking country in the world.",
        "The longest word in Portuguese is 'anticonstitucionalissimamente.'",
        "Portugal is the oldest nation-state in Europe.",
        "The famous Portuguese tiles are called 'azulejos.'"
    ],
    "Chinese": [
        "Chinese is the most spoken language in the world.",
        "Mandarin uses four tones to change meaning.",
        "Red is a very lucky color in Chinese culture.",
        "China is home to the world’s largest high-speed rail network.",
        "The Chinese New Year is also called the Spring Festival."
    ],
    "Arabic": [
        "Arabic is written from right to left.",
        "The word ‘algebra’ comes from Arabic.",
        "There are more than 400 million Arabic speakers worldwide.",
        "Arabic has no capital letters.",
        "In Arabic culture, hospitality is extremely important."
    ]
}


# Initialize chat
if 'messages' not in st.session_state:
    st.session_state['messages'] = []

# Sidebar controls
language = st.sidebar.selectbox("Language", list(tutors.keys()), index=2)
level = st.sidebar.selectbox("Level", ["A1", "A2", "B1", "B2", "C1"], index=0)
mode = st.sidebar.selectbox("Mode", ["Free Talk"] + list(roleplays.keys()))

show_grammar = st.sidebar.checkbox("Show grammar corrections", value=True)

# --- Cultural Fun Fact Display ---
if 'fact_idx' not in st.session_state or st.session_state.get('last_fact_lang') != language:
    # On new login or language change, pick a new fact index
    st.session_state['fact_idx'] = random.randint(0, len(cultural_facts[language])-1)
    st.session_state['last_fact_lang'] = language

# Show fact in sidebar (or main page if you prefer)
fact = cultural_facts[language][st.session_state['fact_idx']]
st.sidebar.markdown(f"💡 **Did you know?**\n\n{fact}")

# Button to get another fun fact
if st.sidebar.button("🔄 New Cultural Fact"):
    st.session_state['fact_idx'] = random.randint(0, len(cultural_facts[language])-1)
    fact = cultural_facts[language][st.session_state['fact_idx']]
    st.sidebar.markdown(f"💡 **Did you know?**\n\n{fact}")

tutor = tutors[language]
scenario_prompt = '' if mode == 'Free Talk' else roleplays[mode][language]


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
    st.session_state['messages'].append({'role': 'user', 'content': user_input})
    st.chat_message('user').markdown(user_input)
    sys = f"You are {tutor}, a friendly {language} tutor at level {level}. " + ("Engage freely." if not scenario_prompt else f"Role-play: {scenario_prompt}.")
    msgs = [{'role': 'system', 'content': sys}] + st.session_state['messages']
    with st.spinner("Sir Felix is thinking…"):
        try:
            resp = client.chat.completions.create(model='gpt-3.5-turbo', messages=msgs)
            reply = resp.choices[0].message.content
        except Exception:
            reply = "Sorry, there was a problem."
    st.session_state['messages'].append({'role': 'assistant', 'content': reply})
    st.chat_message('assistant', avatar='🧑‍🏫').markdown(f"**{tutor}:** {reply}")
    
    # Grammar check only if enabled in sidebar
    if show_grammar:
        grammar_msgs = [
            {"role": "system", "content": f"You are {tutor}, a helpful {language} teacher at level {level}. Check the sentence for errors and provide the corrected version with a brief explanation."},
            {"role": "user", "content": user_input}
        ]
        try:
            gresp = client.chat.completions.create(model='gpt-3.5-turbo', messages=grammar_msgs, max_tokens=150)
            feedback = gresp.choices[0].message.content.strip()
            # Split for correction and explanation
            if '\n' in feedback:
                first_line, rest = feedback.split('\n', 1)
            else:
                first_line, rest = feedback, ""
            st.markdown(
                f"<div style='background:#e8f5e9;padding:12px 16px;border-radius:10px;margin:10px 0;'>"
                f"<b>Correction:</b><br><span style='color:#1b5e20;font-weight:bold;'>{first_line.strip()}</span>"
                f"{'<br><b>Explanation:</b> ' + rest.strip() if rest.strip() else ''}"
                f"</div>",
                unsafe_allow_html=True
            )
        except Exception:
            st.error("Grammar check failed.")

# Gamification
today = pd.Timestamp(datetime.now().date())
mask = (df_usage.user_email==st.session_state['user_email'])&(df_usage.date==today)
count = int(df_usage.loc[mask,'count'].iloc[0]) if mask.any() else 0
prog = min(count/10,1)
st.progress(prog)
st.caption(f"{count}/10 messages today")
if count in [5,10]: st.balloons()

# Share button
share = f"I just practiced {language} with {tutor}!"
st.markdown(f'<a href="https://wa.me/?text={share.replace(" ","%20")}" target="_blank"><button style="width:100%;padding:10px;border:none;border-radius:8px;background:#25D366;color:white;">Share on WhatsApp 🚀</button></a>', unsafe_allow_html=True)
