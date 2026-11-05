# ApplyMate: A Unified AI-Driven Platform for Automated Scholarship and Job Applications

**Final Year Project 23F-13**, Department of Computer Science, Sukkur IBA University  
**Team:** Hamadullah Samo (023-23-0041), Maryam Khatoon (053-23-0021), Hassan Ali (023-23-0046)  
**Supervisor:** Dr Saif Hassan

## Demo video (30% progress)

▶ **[Watch the demo video](https://drive.google.com/file/d/1XJnGHAGClUDpJpzSPFpihuqGx59ItDTP/view?usp=sharing)**

## What ApplyMate does

1. **One profile** for every application: personal details, education history, languages, statements, work experience and documents (can be started by importing a CV).
2. **Only suitable scholarships:** official programmes (Fulbright, Chevening, Stipendium Hungaricum via HEC, Erasmus Mundus, DAAD) on a board *Open now / Opening soon / Deadline passed*, matched to the student's level and field with a fit score.
3. **Details page** with requirements, documents, deadlines and a *Before you apply* checklist.
4. **AI agent:** opens the official website, finds the application form by itself, fills every page from the profile, asks the student only for passwords, CAPTCHAs, essays and preferences, and **never submits** the application itself.
5. **Private:** the AI runs offline (qwen3:4b via Ollama) on the student's computer.
6. Application tracker, deadline reminders, notifications, and the *Ask ApplyMate* chatbot.

## Tech stack

React + Vite · Node.js / Express · MongoDB · Playwright (agent) · Ollama qwen3:4b (offline AI) · Tesseract.js (CV OCR)

## Results so far (real portals, from the agent's run logs)

No application was submitted; every run stopped before the final submit.

| Portal | Result | Time |
|---|---|---|
| Erasmus Mundus EMCL+ (multi-page form) | 50 / 50 actions succeeded, stopped before *Final Submission* | 302 s |
| Erasmus Mundus NOHA (one long page, ~90 fields) | 93 / 93 actions succeeded; asked the student for preferences and essays | 324 s (813 s before optimisation) |
| Erasmus Mundus EuroPubHealth+ (eMundus) | Reached the portal's sign-in page by itself | 114 s |
| HEC Scholarship Portal | Logged in, followed the route, filled the Profile page; HEC blocks the next step until the call opens | n/a |
| Practice portals (HEC-style, DAAD-style, local forms) | All filled correctly (17/17, 37/37 actions) | n/a |

## Documents

- [Software Requirements Specification (SRS)](docs/ApplyMate_SRS_23F-13.pdf)
- [Software Design Specification (SDS)](docs/ApplyMate_SDS_23F-13.pdf)

---

A unified AI-driven platform for automated scholarship and job applications.

## Features (as in the proposal)

| Feature | Where |
|---|---|
| Sign up / log in (hashed passwords, JWT) | `/signup`, `/login` |
| One profile + documents (CV, transcript, CNIC copy, photo) | Profile & documents |
| **CV import:** the offline AI reads your CV and pre-fills the profile; you review each value | Profile â†’ Documents & CV import |
| Separate **Scholarships** and **Jobs** sections, ranked against your profile with reasons | Scholarships, Jobs |
| Fulbright, Chevening, Stipendium Hungaricum, DAAD (official catalogue), Erasmus Mundus (live EU catalogue), Rozee.pk (add by link) | Scholarships, Jobs |
| **Explicit permission** dialog before the agent fills any form | â€œApply with agentâ€ |
| **AI agent** fills the form field by field with live progress; pauses for essays, CAPTCHAs, missing data, uploads; never submits | Agent run page |
| **Application tracker:** Saved â†’ In progress â†’ Ready â†’ Submitted â†’ Interview â†’ Decision, with notes, deadlines, history | Application tracker |
| **Notifications:** bell for â€œagent needs youâ€, â€œform readyâ€, deadline reminders (7 days); optional **email** | Bell, Profile â†’ Notifications |
| **Ask ApplyMate chatbot:** answers only about the scholarships and jobs on the portal (RAG: finds the matching listings in MongoDB, the offline model answers from them only, cites them as cards, refuses off-topic questions) | Chat button, bottom-right |
| Dashboard: profile completeness, best matches, deadlines, recent runs | Home |
| Landing page for visitors | `/` |

## Project structure

```
applymate/
â”œâ”€â”€ agent/            the form-filling agent (scanner â†’ planner â†’ executor loop)
â”‚   â”œâ”€â”€ test-forms/   local demo portals (also served at http://localhost:5000/demo/...)
â”‚   â””â”€â”€ runs/         one JSON log per agent run (for the evaluation chapter)
â”œâ”€â”€ server/           Express API + MongoDB (auth, profile, opportunities, applications)
â”‚   â”œâ”€â”€ catalog/      programs.js: Fulbright, Chevening, Stipendium Hungaricum, DAAD
â”‚   â”œâ”€â”€ chat.js       the Ask ApplyMate chatbot (retrieve listings â†’ offline model â†’ cited answer)
â”‚   â””â”€â”€ scrapers/     official-status (dates + live check), erasmus (EACEA RSS), job-link (Rozee links)
â””â”€â”€ client/           React web app (Vite)
```

## Setup (Windows, once)

1. **MongoDB Community Server** (free): install from mongodb.com/try/download/community, keeping "Install MongoDB as a Service" ticked. MongoDB Compass (installed with it) lets you browse the data.
2. **Ollama** with `qwen3:4b` (already done).
3. In this folder:
   ```powershell
   copy .env.example .env
   npm install
   npm --prefix client install
   ```
4. Open `.env` and change `JWT_SECRET` to any long random text.

## Run

**Simple (one terminal):** build the web app once, then start the server:
```powershell
npm --prefix client run build
npm run server
```
Open **http://localhost:5000**.

**While developing the UI (two terminals, auto-reload):**
```powershell
npm run dev        # terminal 1: API on :5000
npm run client     # terminal 2: React app on http://localhost:5173
```

## Updating to a new version

1. Stop the server (Ctrl + C).
2. Download the new `applymate.zip` (leave it in Downloads).
3. Double-click **`update.cmd`** in this folder.

It copies the new files over this folder, keeps `node_modules`, `.env`, your uploads and the agent's browser profile,
and runs `npm install` only when the package list changed. The zip already contains the built web app (`client/dist`),
so you can start straight away with `npm run server`.

## Useful commands

| Command | What it does |
|---|---|
| `npm run test-scrapers` | Fetches live scholarships + jobs and prints the ranked results (no database needed) |
| `npm run agent` | Runs the agent on `agent/test-forms/form2.html` from the terminal |
| `node agent/index.js https://demoqa.com/automation-practice-form` | Agent on any URL from the terminal |

## Scholarship details and real portals

**Details page:** click a scholarship to see its requirements, documents, dates, funding and how to apply.
For Erasmus Mundus programmes these are read from the programme's own website (`server/scrapers/details.js`:
home page + up to 3 linked pages such as Admissions / Scholarships), cached for 3 days.

**The agent finds the form by itself** (`agent/navigator.js`): it starts on the programme's website and follows
"Admissions â†’ How to apply â†’ Apply online â†’ portal" links. Clear cases are decided by rules; when several links are
equally good, the offline model picks one (it sees only link texts). It remembers on which portals the student already
has an account, so it goes to "Sign in" there and to "Create an account" on new portals.

**Shared route memory:** when a run reaches a scholarship's application form (or its portal's sign-in page), the
address is saved on that scholarship (`Opportunity.route`) for every student. The next run goes straight there.
If the agent cannot find the form, the student opens it once and ApplyMate learns the route from them. A route that
stops working is counted (`route.fails`); after 3 failures the agent searches again and saves the new route.
Only public addresses are saved: no query parameters like session tokens, no personal pages such as `/application/83742/edit`.
The AI fallback guesses at most twice and never leaves the programme's website unless a link clearly says "apply".

Safety rules on real websites:

- **Sign-in pages:** the agent stops; the student types the email and password. After that the agent opens the
  application itself, and the browser keeps the student signed in for next time.
- **Never handled by the agent:** passwords, email/SMS verification codes, CAPTCHAs, and the final Submit / Register / Save.
- **Terms and declarations** ("I agree", "I declare the information is true") are left for the student to tick.
- **Cookie banners** are closed, choosing "Reject" / "Only necessary" when offered.
- **Documents** are uploaded only after the student says yes.

To check how the agent reads a real portal **without filling anything**:
```powershell
npm run scan -- https://apply.example.org/
```
Log in / open the form in the window that opens, press Enter, and the field list is printed and saved to
`agent/runs/scan-<site>-<time>.json` (field names only, never values).

## HEC Scholarship Portal (Stipendium Hungaricum and other HEC-nominated scholarships)

Pakistani students apply first on `scholarship.hec.gov.pk`. Recorded route: dashboard â†’ **Hungarian Scholarship Program**.
The agent then fills **Profile** (name, marital status, gender, date of birth, father's name, addresses, domicile,
country / city / postal code) and **Education**: for every degree in *Profile â†’ Education history* (Matric,
Intermediate, Bachelor's, Master's) that is not listed yet it clicks **Add Education**, fills the 4-step pop-up
(level, dates, name on degree â†’ country, city, board, school, sector, programme, discipline â†’ roll number â†’
marks or CGPA, "Incomplete Education" for a degree in progress) and saves it, then continues with **NEXT STEP**.
It handles Angular Material dropdowns (with search boxes) and calendar dates (tries the formats until one is accepted).
It never clicks the final Submit.

## DAAD scholarships: the complete flow

ApplyMate lists the DAAD programmes for Pakistani applicants (from DAAD Pakistan's official list): EPOS,
Helmut-Schmidt-Programme, Study Scholarships in Fine Art / Design / Film, Research Grants â€“ Doctoral Programmes, and
Bi-nationally Supervised Doctoral Degrees. All of them are applied for in the **DAAD Portal**:

`portal.daad.de` â†’ student signs in â†’ **Personal Funding â†’ Application** â†’ selection page (funding programme,
country of residence, target country, status) â†’ online form pages â†’ attachments â†’ **Send** (by the student).

- The agent fills the selection page from the scholarship itself (`portal` in `programs.js`) and the profile.
- Fields common on international forms (place of birth, passport, mother tongue, degree dates, best possible grade,
  motivation â€¦) are matched by fixed rules first (`LABEL_RULES` in `agent/planner.js`), the offline model does the rest.
- Motivation / career-plan texts are written once in **Profile â†’ Statements** and reused (length limits are checked).
- It reads forms inside frames and SAP UI5 components, waits for slow portal pages, and follows new tabs.

### Teach the route once (ApplyMate team)
```powershell
npm run teach -- daad-fine-art
```
1. Log in in the window that opens, press Enter.
2. Click to the application form as a student would (Personal Funding â†’ Application â†’ choose programme â†’ Continue).
3. On each form page press Enter (field names are read, never values), then type `done`.

The route is saved in `server/catalog/routes.json` and replayed for every student (restart the server).
A field report is saved in `agent/runs/teach-<programme>-<time>.json`: use it to check that every field maps to the profile.
Programme keys: `erasmus-deai` (Erasmus Mundus DEAI, open to Pakistani students now), `daad-study-visits-artistic` (open now), `daad-reinvitation` (open now), `daad-epos`, `daad-helmut-schmidt`, `daad-fine-art`, `daad-doctoral`, `daad-binational`.

## Email notifications (optional)

The bell works without any setup. To also get emails, use a Gmail **App password**
(Google Account â†’ Security â†’ 2-Step Verification â†’ App passwords) and add to `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourname@gmail.com
SMTP_PASS=the-16-letter-app-password
MAIL_FROM="ApplyMate <yourname@gmail.com>"
```

Restart the server, then Profile â†’ Notifications â†’ turn on email â†’ â€œSend a test emailâ€.

## Demo checklist (Mid-Defense)

1. MongoDB service running, Ollama running (`ollama ps` should list qwen3:4b after the first call).
2. `npm run server`, open http://localhost:5000.
3. Sign up â†’ Profile â†’ Documents: upload `agent/documents/sample-cv.pdf` â†’ **Import from CV** â†’ review â†’ use values.
4. Fill the remaining fields (gender, expected salary, scholarship level, field of study), upload `transcript.pdf`.
5. Scholarships â†’ **Check for new scholarships** (loads Erasmus Mundus) â†’ save Chevening to the tracker.
6. Jobs â†’ paste a real Rozee job link â†’ it is ranked.
7. **Apply with agent** on the demo job â†’ permission dialog â†’ watch it fill â†’ â€œReady for you to submitâ€.
8. Demo scholarship â†’ agent pauses for the Statement of Purpose â†’ type it in the browser â†’ â€œIâ€™ve done it, continueâ€.
9. Tracker: open a card, set a deadline within 7 days â†’ the bell shows a reminder on Home.
10. Chat button â†’ â€œWhich scholarships fit my profile?â€ â†’ answer with listing cards; then ask something off-topic (â€œWhat is the capital of France?â€) â†’ polite refusal.

## Logo for slides and the report

`client/public/brand/` has the ApplyMate logo as SVG and PNG: `applymate-logo.png` (on white), `applymate-logo-white.png` (on indigo slides), `applymate-mark.png` (icon only). Brand colours: indigo `#3B3FD8`, ink `#1B1F3B`, background `#F6F7FB`, saffron `#E09A2D` (only for "needs you"), green `#1E8E5A`.

## Notes

- Only one agent runs at a time; it opens a visible Edge window on this computer.
- To use MongoDB Atlas (cloud) instead of a local database, change `MONGO_URI` in `.env`.
- Sources are read only when the user clicks "Find newâ€¦", a few pages at most, with pauses in between.
- DAAD's scholarship database disallows automated access (robots.txt) and the USEFP site blocks it, so those programmes come from the catalogue file. **Before the demo, confirm each programme's dates on its official page and update `programs.js` (`cycle`, `verified`).**



