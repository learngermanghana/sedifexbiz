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

# --- Email Login ---
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

# --- Expanded Role-play Scenarios with language-specific prompts ---
roleplays = {
    "Ordering at a Restaurant": {
        "German":     "Sie sind Kellner in einem Restaurant. Der Schüler wird Essen bestellen und Fragen stellen.",
        "French":     "Vous êtes serveur dans un restaurant. L'étudiant commandera de la nourriture et posera des questions.",
        "English":    "You are a waiter at a restaurant. The student will order food and ask questions.",
        "Spanish":    "Eres camarero en un restaurante. El estudiante pedirá comida y hará preguntas.",
        "Italian":    "Sei un cameriere in un ristorante. Lo studente ordinerà cibo e farà domande.",
        "Portuguese": "Você é um garçom em um restaurante. O aluno pedirá comida e fará perguntas.",
        "Chinese":    "你是餐厅的服务员。学生将点菜并提出问题。",
        "Arabic":     "أنت نادل في مطعم. سيطلب الطالب الطعام ويطرح الأسئلة."
    },
    "Checking into a Hotel": {
        "German":     "Sie sind Rezeptionist in einem Hotel. Der Schüler wird einchecken und nach Annehmlichkeiten fragen.",
        "French":     "Vous êtes réceptionniste dans un hôtel. L'étudiant s'enregistrera et demandera des commodités.",
        "English":    "You are a hotel receptionist. The student will check in and ask about amenities.",
        "Spanish":    "Eres recepcionista en un hotel. El estudiante hará el check-in y preguntará por las comodidades.",
        "Italian":    "Sei receptionist in un hotel. Lo studente effettuerà il check-in e chiederà dei servizi.",
        "Portuguese": "Você é recepcionista em um hotel. O aluno fará check-in e perguntará sobre comodidades.",
        "Chinese":    "你是酒店前台接待。学生将办理入住并询问设施。",
        "Arabic":     "أنت موظف استقبال في الفندق. سيقوم الطالب بتسجيل الوصول ويسأل عن المرافق."
    },
    "Asking for Directions": {
        "German":     "Sie sind Einheimischer, der den Weg erklärt. Der Schüler wird nach Wegbeschreibungen zu Sehenswürdigkeiten fragen.",
        "French":     "Vous êtes un local donnant des indications. L'étudiant demandera comment se rendre aux sites touristiques.",
        "English":    "You are a local giving directions. The student will ask how to get to landmarks.",
        "Spanish":    "Eres un local que da direcciones. El estudiante preguntará cómo llegar a los lugares de interés.",
        "Italian":    "Sei un locale che fornisce indicazioni. Lo studente chiederà come arrivare ai luoghi d'interesse.",
        "Portuguese": "Você é um morador local dando direções. O aluno perguntará como chegar aos pontos turísticos.",
        "Chinese":    "你是当地人，提供方向指引。学生将询问如何到达地标。",
        "Arabic":     "أنت مقيم محلي تعطي اتجاهات. سيطلب الطالب كيفية الوصول إلى المعالم."
    },
    "Shopping for Clothes": {
        "German":     "Sie sind Verkäufer in einem Bekleidungsgeschäft. Der Schüler wird Kleidung anprobieren und kaufen.",
        "French":     "Vous êtes vendeur dans un magasin de vêtements. L'étudiant essaiera et achètera des vêtements.",
        "English":    "You are a shop assistant. The student will try on and purchase clothing items.",
        "Spanish":    "Eres asistente de tienda. El estudiante se probará y comprará ropa.",
        "Italian":    "Sei commesso in un negozio di abbigliamento. Lo studente proverà e acquisterà vestiti.",
        "Portuguese": "Você é um assistente de loja. O aluno vai experimentar e comprar roupas.",
        "Chinese":    "你是服装店的店员。学生将试穿并购买衣服。",
        "Arabic":     "أنت مساعد متجر. سيجرب الطالب الملابس ويشتريها."
    },
    "Making a Doctor's Appointment": {
        "German":     "Sie sind Praxisassistent. Der Schüler wird einen Arzttermin vereinbaren und Fragen dazu stellen.",
        "French":     "Vous êtes assistant médical. L'étudiant prendra rendez-vous chez le médecin et posera des questions.",
        "English":    "You are a medical assistant. The student will make a doctor's appointment and ask questions.",
        "Spanish":    "Eres asistente médico. El estudiante hará una cita con el médico y hará preguntas.",
        "Italian":    "Sei assistente medico. Lo studente fisserà un appuntamento dal dottore e farà domande.",
        "Portuguese": "Você é assistente médico. O aluno marcará uma consulta médica e fará perguntas.",
        "Chinese":    "你是医生助理。学生将预约看医生并提出问题。",
        "Arabic":     "أنت مساعد طبي. سيحدد الطالب موعدًا مع الطبيب ويطرح الأسئلة."
    },
    "Booking Travel Tickets": {
        "German":     "Sie sind Reisedesk-Agent. Der Schüler wird Flug- oder Bahntickets buchen und Sitzplatzwünsche äußern.",
        "French":     "Vous êtes agent de voyage. L'étudiant réservera des billets d'avion ou de train et exprimera des préférences de siège.",
        "English":    "You are a travel agent. The student will book flight or train tickets and state seat preferences.",
        "Spanish":    "Eres agente de viajes. El estudiante reservará boletos de avión o tren y expresará preferencias de asiento.",
        "Italian":    "Sei agente di viaggio. Lo studente prenoterà biglietti aerei o del treno e esprimerà preferenze di posto.",
        "Portuguese": "Você é agente de viagens. O aluno reservará passagens de avião ou trem e informará preferências de assento.",
        "Chinese":    "你是旅行社代理。学生将预订机票或火车票并说明座位偏好。",
        "Arabic":     "أنت وكيل سفر. سيقوم الطالب بحجز تذاكر طيران أو قطار ويذكر تفضيلات المقعد."
    }
}

# --- Session State ---
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
scenario = st.selectbox(
    "Choose Role-play Scenario",
    list(roleplays.keys())
)
scenario_prompt = roleplays[scenario][language]

# --- App Header with dynamic tutor, scenario & level ---
st.markdown(
    f"""
    <h1 style='font-size:2.4em; margin-bottom: 0.2em;'>🌟 Falowen – {scenario} with {tutor}</h1>
    <div style='font-size:1.1em; margin-bottom: 1em; color:#446;'>
      Practice {language} ({level}) role-play: <em>{scenario}</em>
    </div>
    """,
    unsafe_allow_html=True
)

# --- Tips & Challenges ---
tips = {
    "German": [
        "💡 All nouns are capitalized. Example: _Das Haus_.",
        "💡 'Bitte' can mean 'please', 'you're welcome', or 'pardon?'."
    ],
    "French": [
        "💡 Les adjectifs en français suivent souvent le nom.",
        "💡 Les noms ont un genre: 'le' (masculin) vs 'la' (féminin)."
    ],
    # ... add other languages as needed ...
}
st.info(random.choice(tips.get(language, ["💡 Practice makes perfect!"])))

facts = [
    f"{tutor} believes every mistake is a step to mastery.",
    f"{tutor} once helped 100 students in a single day!"
]
st.info(f"🧑‍🏫 Did you know? {random.choice(facts)}")

challenges = [
    "Ask three questions using 'where' or 'when'.",
    "Write a short greeting in your selected language.",
    "Describe your favorite food in your language."
]
st.warning(f"🔥 **Daily Challenge:** {random.choice(challenges)}")

# --- Chat Interface ---
for msg in st.session_state["messages"]:
    role = msg["role"]
    avatar = "🧑‍🏫" if role == "assistant" else None
    with st.chat_message(role, avatar=avatar):
        st.markdown(msg["content"])

user_input = st.chat_input("💬 Type your message here...")
if user_input:
    st.session_state["messages"].append({"role": "user", "content": user_input})
    st.chat_message("user").markdown(user_input)

    # AI response with role-play & level context
    try:
        conversation = [
            {"role": "system", "content":
                f"You are {tutor}, a friendly {language} tutor at level {level}."
                f" Role-play scenario: {scenario_prompt}. Engage the student accordingly."
            },
            *st.session_state["messages"]
        ]
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=conversation
        )
        ai_reply = response.choices[0].message.content
    except Exception as e:
        ai_reply = "Sorry, there was a problem generating a response."
        st.error(str(e))

    st.session_state["messages"].append({"role": "assistant", "content": ai_reply})
    with st.chat_message("assistant", avatar="🧑‍🏫"):
        st.markdown(f"**{tutor}:** {ai_reply}")

    # Grammar check
    grammar_prompt = (
        f"You are {tutor}, a helpful {language} teacher at level {level}."
        f" Check this sentence for errors, give a correction and brief explanation:\n\n{user_input}"
    )
    try:
        gram = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": grammar_prompt}],
            max_tokens=120
        )
        st.info(f"📝 **Correction by {tutor}:**\n{gram.choices[0].message.content.strip()}")
    except:
        st.warning("Grammar check failed. Please try again.")

# --- Share on WhatsApp ---
share_text = f"I practiced '{scenario}' in {language} ({level}) with {tutor} on Falowen!"
share_url = f"https://wa.me/?text={share_text.replace(' ', '%20')}"
st.markdown(
    f'<a href="{share_url}" target="_blank">'
    '<button style="background:#25D366;color:white;padding:7px 14px;'
    'border:none;border-radius:6px;margin-top:10px;font-size:1em;">'
    'Share on WhatsApp 🚀</button></a>',
    unsafe_allow_html=True
)
