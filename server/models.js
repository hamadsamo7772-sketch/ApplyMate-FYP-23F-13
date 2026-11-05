// models.js — MongoDB collections (via Mongoose)
//
// The profile uses the SAME structure and key names as agent/profile-keys.js,
// so the agent can read a user's profile directly (e.g. "personal.cnic").

const mongoose = require('mongoose');

const doc = { path: String, originalName: String, uploadedAt: Date };
const degree = {
  programTitle: String, discipline: String, board: String, school: String, sector: String,
  country: String, city: String, startDate: String, endDate: String, rollNumber: String,
  totalMarks: String, obtainedMarks: String, cgpa: String, cgpaScale: String, incomplete: String,
};

const profileSchema = new mongoose.Schema(
  {
    personal: {
      fullName: String,
      firstName: String,
      middleName: String,
      lastName: String,
      fatherName: String,
      gender: String,
      dateOfBirth: String, // YYYY-MM-DD
      email: String,
      phone: String,
      cnic: String,
      nationality: String,
      title: String,          // Mr / Ms (salutation on international forms)
      domicile: String,       // e.g. "Sindh Urban" (HEC and government forms)
      placeOfBirth: String,
      countryOfBirth: String,
      maritalStatus: String,
      passportNumber: String,
      passportExpiry: String, // YYYY-MM-DD
    },
    address: { street: String, city: String, province: String, country: String, postalCode: String },
    education: {
      program: String, lastDegree: String, institution: String, cgpa: String,
      fieldOfStudy: String,     // major, e.g. "Computer Science"
      institutionCity: String,
      institutionCountry: String,
      startDate: String,        // YYYY-MM-DD
      endDate: String,          // graduation (expected) YYYY-MM-DD
      gradeScale: String,       // e.g. "4.00"
    },
    languages: {
      motherTongue: String,
      english: String,          // CEFR level, e.g. C1
      englishTest: String,      // e.g. IELTS Academic
      englishScore: String,     // e.g. 7.0
      german: String,           // CEFR level or "None"
    },
    statements: { motivation: String, careerGoals: String },
    // education history, one degree each (HEC and other portals add them one by one)
    eduMatric: degree, eduInter: degree, eduBachelor: degree, eduMaster: degree, // written by the student, reused in forms
    job: {
      employer: String,
      expectedSalary: String,
      currentSalary: String,
      experienceYears: String,
      noticePeriod: String,
      currentTitle: String,
    },
    // What the user is looking for: used to search and rank opportunities
    preferences: {
      degreeLevel: String,   // Bachelors / Masters / PhD / Short course
      studyField: String,    // e.g. "computer science"
      jobKeywords: String,   // e.g. "web developer, react, mern"
      preferredCities: String, // e.g. "Sukkur, Karachi, Remote"
      previousScholarships: String, // e.g. "DAAD 2019" (some programmes are only for former holders)
    },
    documents: { cv: doc, transcript: doc, cnicCopy: doc, photo: doc, passport: doc, degree: doc, languageCert: doc, motivationLetter: doc },
    // answers the student gave to questions a form asked (reused on every form that asks the same thing)
    answers: [{ q: String, label: String, kind: String, value: String, path: String, originalName: String, updatedAt: Date, _id: false }],
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    profile: { type: profileSchema, default: () => ({}) },
    settings: { emailNotifications: { type: Boolean, default: false } },
    // "Forgot password": a 6-digit code sent by email (only its hash is stored)
    reset: { pinHash: String, expires: Date, tries: Number, sentAt: Date },
  },
  { timestamps: true }
);

const opportunitySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['scholarship', 'job'], required: true },
    source: { type: String, required: true }, // scholars4dev / mustakbil / demo
    title: { type: String, required: true },
    org: String,
    url: { type: String, required: true }, // details page
    applyUrl: String,                      // where the agent starts (defaults to url)
    location: String,
    level: String,
    deadline: String,
    salary: String,
    posted: String,
    description: String,
    tags: [String],
    // scholarship programme details (official catalogue / Erasmus)
    sourceKey: String,
    status: String, // open / closed / upcoming / varies
    statusNote: String,
    opensAt: Date,  // this cycle's dates (official catalogue), for sorting
    closesAt: Date,
    levels: [String],
    fieldsAll: Boolean,
    fieldWords: [String],
    fieldNote: String,
    eligibility: [String],
    documents: [String],
    howToApply: [String],
    details: Object,    // extracted from the programme's website (scrapers/details.js)
    presetTrail: [String],
    requires: Object,      // hard conditions: { minExperienceYears, academic, formerHolder }
    presetSteps: Array,    // route recorded by the ApplyMate team with "npm run teach" (server/catalog/routes.json)
    portal: Object,        // how the programme is named on its application portal, e.g. { programme, targetCountry, status: { Masters, PhD } } // route defined by the ApplyMate team, e.g. ["Personal Funding"] on the DAAD Portal
    // where the application form is, learned by the agent or shown by a student; shared by all students
    route: {
      formUrl: String,
      kind: String,       // 'form' | 'sign-in'
      by: String,         // 'agent' | 'student'
      trail: [String],    // link texts followed, e.g. ["Admissions", "Apply online"]
      foundAt: Date,
      uses: Number,
      fails: Number,
    },
    // questions this programme's form asked that the profile could not answer (no answers stored here)
    formQuestions: [{ label: String, kind: String, options: [String], required: Boolean, hint: String, _id: false }],
    detailsAt: Date,
    covers: String,
    verified: String,
    liveCheckedAt: Date,
    // dry-run check by "npm run check-forms": { result: 'reachable'|'sign-in'|'not-found', url, checkedAt, ms, reason }
    formCheck: Object,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // jobs the user added by link
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
opportunitySchema.index({ source: 1, url: 1 }, { unique: true });

const applicationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    track: { type: mongoose.Schema.Types.ObjectId, ref: 'Track' },
    formUrl: String, // the application form the agent opened (may differ from the listing's page)
    // running -> waiting (needs user) -> ready (user submits) / stopped / incomplete / failed
    status: { type: String, default: 'running' },
    log: [String],
    pause: { kind: String, reason: String, message: String, questions: Array },
    result: { message: String, summary: Object },
  },
  { timestamps: true }
);

// Application tracker: one entry per opportunity the user cares about
const trackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', required: true },
    // saved -> in_progress -> ready -> submitted -> interview -> accepted / rejected
    stage: { type: String, default: 'saved' },
    notes: String,
    deadline: Date,
    history: [{ stage: String, note: String, at: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);
trackSchema.index({ user: 1, opportunity: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: String, // agent-waiting / agent-ready / agent-failed / deadline / cv / info
    title: String,
    body: String,
    link: String,
    key: String, // prevents duplicates (e.g. one deadline reminder per day)
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = {
  User: mongoose.model('User', userSchema),
  Opportunity: mongoose.model('Opportunity', opportunitySchema),
  Application: mongoose.model('Application', applicationSchema),
  Track: mongoose.model('Track', trackSchema),
  Notification: mongoose.model('Notification', notificationSchema),
};
