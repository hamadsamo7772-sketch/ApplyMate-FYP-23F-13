import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';
import { useUser } from '../App.jsx';

const PLATFORMS = [
  ['Fulbright', 'Masterâ€™s and PhD in the USA, through USEFP'],
  ['Chevening', 'One-year Masterâ€™s in the UK'],
  ['Stipendium Hungaricum', 'Bachelorâ€™s to PhD in Hungary, through HEC'],
  ['DAAD EPOS', 'Development-related postgraduate courses in Germany'],
  ['Erasmus Mundus', 'Joint Masterâ€™s across Europe, live from the EU catalogue'],
  ['Jobs', 'A practice job on our demo portal, with more jobs coming soon'],
];

export default function Landing() {
  const { user } = useUser();
  return (
    <div className="landing">
      <nav className="l-nav" aria-label="Site">
        <Link to="/" className="brand"><span className="brand-mark"><Logo /></span> ApplyMate</Link>
        <span className="grow" />
        {user ? (
          <Link to="/app" className="btn btn-primary">Open dashboard</Link>
        ) : (
          <>
            <Link to="/login" className="btn btn-quiet">Log in</Link>
            <Link to="/signup" className="btn btn-primary">Create account</Link>
          </>
        )}
      </nav>

      <header className="hero">
        <div>
          <h1>Fill your profile once. ApplyMate fills the application forms.</h1>
          <p className="lead">
            One place for Pakistani students to find scholarships and jobs that fit them, and an AI agent that
            fills the application forms from your profile. You check the result and press submit.
          </p>
          <div className="hero-cta">
            <Link to={user ? '/app' : '/signup'} className="btn btn-primary btn-lg">
              {user ? 'Open dashboard' : 'Create your profile'}
            </Link>
            <a href="#how" className="btn btn-secondary btn-lg">See how it works</a>
          </div>
          <p className="hero-note"><Icon name="shield" size={16} /> The AI runs offline on your computer. Your CNIC and documents never leave it.</p>
        </div>

        <div className="demo" aria-label="Example: profile values being filled into an application form">
          <div className="demo-card demo-profile">
            <div className="who">
              <span className="avatar">HS</span>
              <div>
                <strong className="small" style={{ display: 'block' }}>Your ApplyMate profile</strong>
                <span className="tiny muted">Saved once</span>
              </div>
            </div>
            <dl>
              <dt>Name</dt><dd>Hamadullah Samo</dd>
              <dt>Father</dt><dd>Muhammad Raza</dd>
              <dt>CNIC</dt><dd>45504-â€¢â€¢â€¢â€¢â€¢â€¢â€¢-9</dd>
              <dt>Degree</dt><dd>BS Computer Science</dd>
              <dt>CGPA</dt><dd>3.50</dd>
            </dl>
          </div>
          <div className="demo-card demo-form">
            <div className="site"><i /><i /><i /> scholarship portal, application step 1 of 3</div>
            <div className="demo-field d1"><label>Applicant name</label><div className="box"><span>Hamadullah Samo</span></div></div>
            <div className="demo-field d2"><label>Guardianâ€™s name</label><div className="box"><span>Muhammad Raza</span></div></div>
            <div className="demo-field d3"><label>National identity card #</label><div className="box"><span>45504-â€¢â€¢â€¢â€¢â€¢â€¢â€¢-9</span></div></div>
            <div className="demo-field d4"><label>Highest qualification</label><div className="box"><span>BS Computer Science</span></div></div>
            <div className="demo-stop"><Icon name="pause" size={15} /> Statement of purpose: your turn to write</div>
          </div>
        </div>
      </header>

      <section className="l-band" id="how">
        <div className="l-section">
          <h2>How it works</h2>
          <p>Four steps, and you stay in control of every one.</p>
          <ol className="how">
            <li>
              <h3>Build one profile</h3>
              <p>Upload your CV and the local AI pre-fills your details. Review them, add documents, save.</p>
            </li>
            <li>
              <h3>See what fits you</h3>
              <p>Scholarships and jobs are ranked against your level, field and city, with the reasons shown.</p>
            </li>
            <li>
              <h3>Give permission</h3>
              <p>Choose an opportunity and allow the agent to fill it. It opens the form and fills it field by field.</p>
            </li>
            <li>
              <h3>Review and submit</h3>
              <p>The agent pauses for essays and â€œIâ€™m not a robotâ€ checks and never submits. You check the form and press submit.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="l-section">
        <div className="shot-head">
          <div>
            <h2>What you see while the agent works</h2>
            <p>A real run on the demo scholarship portal. Every field it fills is listed as it happens, and when it reaches the statement of purpose it stops and hands over to you.</p>
          </div>
        </div>
        <figure className="shot">
          <div className="shot-bar" aria-hidden="true">
            <i /><i /><i />
            <span>applymate Â· My applications</span>
          </div>
          <img
            src="/screens/agent-run.webp"
            srcSet="/screens/agent-run-small.webp 1080w, /screens/agent-run.webp 2160w"
            sizes="(max-width: 1160px) 100vw, 1112px"
            width="2160"
            height="1350"
            loading="lazy"
            alt="ApplyMate agent run screen: 11 fields filled with no problems, a highlighted 'Your turn' box asking the user to write the statement of purpose, and a checklist of each field the agent typed."
          />
        </figure>
      </section>

      <section className="l-section" style={{ paddingTop: 0 }}>
        <h2>Built for the platforms Pakistani students actually use</h2>
        <p>Starting with six programmes and portals. More can be added without changing the agent.</p>
        <div className="platforms">
          {PLATFORMS.map(([name, desc]) => (
            <div key={name}><h3>{name}</h3><p>{desc}</p></div>
          ))}
        </div>
      </section>

      <section className="l-band">
        <div className="l-section">
          <h2>Private and honest by design</h2>
          <div className="promises">
            <div>
              <Icon name="cpu" size={24} />
              <h3>Offline AI</h3>
              <p>The language model runs on your own computer. It only sees form labels like â€œGuardianâ€™s nameâ€, never your values.</p>
            </div>
            <div>
              <Icon name="shield" size={24} />
              <h3>You submit, not the bot</h3>
              <p>The agent stops before every submit button. â€œIâ€™m not a robotâ€ checks and essays are always yours, with no shortcuts.</p>
            </div>
            <div>
              <Icon name="board" size={24} />
              <h3>Everything tracked</h3>
              <p>Saved, in progress, submitted, interview: one tracker with deadlines, notes and reminders.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="l-section l-cta">
        <h2>Spend your time on the essay, not the form.</h2>
        <Link to={user ? '/app' : '/signup'} className="btn btn-primary btn-lg">{user ? 'Open dashboard' : 'Create your profile'}</Link>
      </section>

      <footer className="l-foot">
        <span>ApplyMate, final year project 23F-13, Sukkur IBA University</span>
        <span>Hamadullah Samo, Maryam Khatoon, Hassan Ali</span>
      </footer>
    </div>
  );
}

