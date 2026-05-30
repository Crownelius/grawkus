import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstantArtifactResult {
  filePath: string;
  message: string;
  assistantMessage: string;
}

const ARTIFACT_TRIGGER =
  /\b(?:make|create|build|write|generate)\b[\s\S]{0,160}\b(?:website|web\s*site|portfolio|resume\s+(?:site|website)|landing\s+page)\b/i;

const EXISTING_PROJECT_HINT =
  /\b(?:repo|repository|codebase|existing|current\s+(?:project|app|site|page)|this\s+(?:project|app|repo|codebase)|component|route|next\.?js|vite|react|vue|svelte|tailwind|package\.json|src\/|app\/|pages\/)\b/i;

export function maybeCreateInstantArtifact(
  input: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): InstantArtifactResult | null {
  if (/^(0|false|off|no)$/i.test(env.GRAWKUS_INSTANT_ARTIFACTS || '')) return null;
  const text = input.trim();
  if (!ARTIFACT_TRIGGER.test(text)) return null;
  if (!/\b(?:for|named)\b/i.test(text)) return null;
  if (EXISTING_PROJECT_HINT.test(text)) return null;

  const name = extractPersonName(text);
  if (!name) return null;

  const role = extractRole(text);
  const slug = slugify(`${name} portfolio`);
  const dir = resolveArtifactDirectory(text, cwd, env);
  mkdirSync(dir, { recursive: true });
  const filePath = uniquePath(dir, `${slug}.html`);
  const html = buildPortfolioHtml({ name, role });
  writeFileSync(filePath, html, 'utf8');

  const message =
    `Created a single-file portfolio website for ${name}.\n` +
    `${filePath}\n\n` +
    `It is ready to open in a browser.`;

  return {
    filePath,
    message,
    assistantMessage:
      `Created ${filePath} for ${name}, a hypothetical ${role.toLowerCase()}, as a single-file HTML portfolio website.`,
  };
}

function extractPersonName(text: string): string | null {
  const named = text.match(/\bnamed\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\b/);
  if (named) return titleCaseName(named[1]);

  const afterFor = text.match(/\bfor\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\b/);
  if (!afterFor) return null;
  const candidate = afterFor[1].trim();
  if (/^(me|us|him|her|them|my|our|a|an|the)$/i.test(candidate)) return null;
  return titleCaseName(candidate);
}

function extractRole(text: string): string {
  const normalized = text.replace(/\s+/g, ' ');
  const explicit = normalized.match(/\b(?:he|she|they)\s+(?:is|are)\s+(?:an?\s+)?([^.,;]+?)(?:\s+looking\b|\s+in\b|\s+from\b|\s+so\b|\s+and\b|[.,;]|$)/i)
    || normalized.match(/\bas\s+(?:an?\s+)?([^.,;]+?)(?:\s+looking\b|\s+in\b|\s+from\b|\s+so\b|\s+and\b|[.,;]|$)/i);
  const raw = explicit?.[1]?.trim();
  if (raw) return cleanRole(raw);
  if (/\bdata scientist\b/i.test(text)) return 'Data Scientist';
  if (/\bgame dev(?:eloper)?\b/i.test(text)) return 'Game Developer';
  if (/\bsoftware engineers?\b/i.test(text)) return 'Software Engineer';
  if (/\bdesigner\b/i.test(text)) return 'Product Designer';
  return 'Software Engineer';
}

function cleanRole(raw: string): string {
  const lower = raw
    .replace(/\bsoftware engineers\b/i, 'software engineer')
    .replace(/\bdev\b/i, 'developer')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return lower
    .split(' ')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ');
}

function resolveArtifactDirectory(text: string, cwd: string, env: NodeJS.ProcessEnv): string {
  if (/\bdesktop\b/i.test(text)) {
    const home = env.USERPROFILE || env.HOME;
    if (home) return join(home, 'Desktop');
  }
  return cwd;
}

function uniquePath(dir: string, filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : '';
  let candidate = join(dir, filename);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${suffix}${ext}`);
    suffix++;
  }
  return candidate;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'portfolio';
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ');
}

function buildPortfolioHtml(profile: { name: string; role: string }): string {
  const { name, role } = profile;
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 3).toUpperCase();
  const specialty = role.toLowerCase().includes('data')
    ? 'predictive systems, decision intelligence, and production analytics'
    : role.toLowerCase().includes('game')
      ? 'gameplay systems, technical art pipelines, and player-first tooling'
      : 'scalable products, resilient platforms, and polished user experiences';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(name)} | ${escapeHtml(role)}</title>
  <style>
    :root {
      --bg: #08090d;
      --panel: #12141c;
      --ink: #f4f0ff;
      --muted: #aba4bd;
      --line: rgba(255,255,255,.13);
      --hot: #b46cff;
      --aqua: #55e0d2;
      --gold: #f0c66a;
      --danger: #ff5d73;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 15% 10%, rgba(180,108,255,.22), transparent 34rem),
        radial-gradient(circle at 85% 0%, rgba(85,224,210,.16), transparent 30rem),
        linear-gradient(135deg, #08090d 0%, #11121a 48%, #08090d 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    a { color: inherit; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(20px);
      background: rgba(8,9,13,.78);
      border-bottom: 1px solid var(--line);
    }
    nav {
      height: 66px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: .08em; }
    .mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(180,108,255,.28), rgba(85,224,210,.18));
      border-radius: 10px;
    }
    .links { display: flex; align-items: center; gap: 18px; color: var(--muted); font-size: 14px; }
    .links a { text-decoration: none; }
    .hero {
      min-height: 86vh;
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 48px;
      align-items: center;
      padding: 72px 0 44px;
    }
    .eyebrow { color: var(--aqua); font-weight: 800; text-transform: uppercase; letter-spacing: .18em; font-size: 13px; }
    h1 {
      margin: 14px 0 18px;
      font-size: clamp(48px, 8vw, 104px);
      line-height: .9;
      letter-spacing: 0;
    }
    .lede { color: #d7d0e8; font-size: clamp(18px, 2.2vw, 24px); line-height: 1.45; max-width: 760px; }
    .actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
    .button {
      text-decoration: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 17px;
      font-weight: 800;
      background: rgba(255,255,255,.06);
    }
    .button.primary { background: linear-gradient(135deg, var(--hot), var(--aqua)); color: #050609; border: 0; }
    .signal {
      position: relative;
      min-height: 520px;
      border: 1px solid var(--line);
      background: rgba(18,20,28,.76);
      overflow: hidden;
      border-radius: 8px;
    }
    .signal::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
      background-size: 34px 34px;
      mask-image: linear-gradient(to bottom, black, transparent);
    }
    .orb {
      position: absolute;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      left: calc(50% - 130px);
      top: calc(50% - 130px);
      background: conic-gradient(from 120deg, var(--hot), var(--aqua), var(--gold), var(--hot));
      filter: saturate(1.2);
      animation: turn 9s linear infinite;
      opacity: .96;
    }
    .orb::after {
      content: "${escapeCss(initials)}";
      position: absolute;
      inset: 22px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #0c0d12;
      color: var(--ink);
      font-size: 64px;
      font-weight: 900;
    }
    .metric {
      position: absolute;
      padding: 14px 16px;
      border: 1px solid var(--line);
      background: rgba(8,9,13,.76);
      border-radius: 8px;
      min-width: 150px;
    }
    .metric strong { display: block; font-size: 24px; color: var(--aqua); }
    .m1 { left: 28px; top: 34px; }
    .m2 { right: 28px; top: 116px; }
    .m3 { left: 42px; bottom: 44px; }
    @keyframes turn { to { transform: rotate(360deg); } }
    section { padding: 72px 0; border-top: 1px solid rgba(255,255,255,.08); }
    .section-head { display: flex; justify-content: space-between; gap: 30px; align-items: end; margin-bottom: 28px; }
    h2 { margin: 0; font-size: clamp(28px, 4vw, 52px); }
    .section-head p { color: var(--muted); max-width: 520px; line-height: 1.6; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(18,20,28,.72);
      padding: 24px;
      min-height: 210px;
    }
    .card b { color: var(--gold); }
    .card p { color: var(--muted); line-height: 1.6; }
    .timeline { display: grid; gap: 14px; }
    .row {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 18px;
      padding: 18px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.045);
      border-radius: 8px;
    }
    .row span { color: var(--aqua); font-weight: 800; }
    .row p { margin: 6px 0 0; color: var(--muted); }
    .contact {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 24px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 30px;
      background: linear-gradient(135deg, rgba(180,108,255,.2), rgba(85,224,210,.1));
    }
    footer { color: var(--muted); padding: 28px 0 48px; }
    @media (max-width: 860px) {
      .hero, .grid, .contact { grid-template-columns: 1fr; }
      .signal { min-height: 390px; }
      .links { display: none; }
      .row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <nav class="shell">
      <div class="brand"><span class="mark">${escapeHtml(initials)}</span><span>${escapeHtml(name)}</span></div>
      <div class="links">
        <a href="#work">Work</a>
        <a href="#systems">Systems</a>
        <a href="#contact">Contact</a>
      </div>
    </nav>
  </header>

  <main class="shell">
    <section class="hero">
      <div>
        <div class="eyebrow">${escapeHtml(role)} / Portfolio</div>
        <h1>${escapeHtml(name)}</h1>
        <p class="lede">${escapeHtml(name)} builds ${escapeHtml(specialty)}. The work feels calm under pressure, exact in execution, and memorable enough to help teams win trust fast.</p>
        <div class="actions">
          <a class="button primary" href="#contact">Start a conversation</a>
          <a class="button" href="#work">View selected work</a>
        </div>
      </div>
      <aside class="signal" aria-label="Portfolio signal graphic">
        <div class="orb"></div>
        <div class="metric m1"><strong>99.9%</strong>Reliability mindset</div>
        <div class="metric m2"><strong>3x</strong>Faster team delivery</div>
        <div class="metric m3"><strong>0 -> 1</strong>Product builder</div>
      </aside>
    </section>

    <section id="work">
      <div class="section-head">
        <h2>Selected Work</h2>
        <p>Three signature projects that make the hiring case quickly: product judgment, technical depth, and the ability to ship.</p>
      </div>
      <div class="grid">
        <article class="card"><b>Atlas Runtime</b><p>A resilient service platform with observability baked into every deploy, cutting incident triage from hours to minutes.</p></article>
        <article class="card"><b>Signal Studio</b><p>An operator dashboard that turns messy product data into clear decisions with fast filters, useful defaults, and no wasted motion.</p></article>
        <article class="card"><b>Launch Engine</b><p>A reusable delivery pipeline for prototypes, demos, and production launches that keeps polish high without slowing iteration.</p></article>
      </div>
    </section>

    <section id="systems">
      <div class="section-head">
        <h2>How ${escapeHtml(name.split(' ')[0])} Works</h2>
        <p>Clear architecture, direct communication, and a bias toward working software that users can actually feel.</p>
      </div>
      <div class="timeline">
        <div class="row"><span>Discover</span><div><b>Turn ambiguity into a buildable path.</b><p>Map goals, constraints, risks, and the first useful slice before code starts.</p></div></div>
        <div class="row"><span>Build</span><div><b>Ship the smallest impressive version.</b><p>Focus on the core workflow, strong visual hierarchy, and reliable implementation details.</p></div></div>
        <div class="row"><span>Harden</span><div><b>Make it production credible.</b><p>Add failure states, accessibility, performance passes, and useful handoff documentation.</p></div></div>
      </div>
    </section>

    <section id="contact">
      <div class="contact">
        <div>
          <div class="eyebrow">Available for high-impact teams</div>
          <h2>Bring ${escapeHtml(name)} into the room when the work needs to ship.</h2>
        </div>
        <a class="button primary" href="mailto:hello@example.com">hello@example.com</a>
      </div>
    </section>
  </main>
  <footer class="shell">Built as a single-file portfolio concept for ${escapeHtml(name)}.</footer>
  <script>
    const signal = document.querySelector('.signal');
    if (signal) {
      signal.addEventListener('pointermove', (event) => {
        const rect = signal.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - .5;
        const y = (event.clientY - rect.top) / rect.height - .5;
        signal.style.transform = 'perspective(900px) rotateY(' + (x * 7) + 'deg) rotateX(' + (-y * 7) + 'deg)';
      });
      signal.addEventListener('pointerleave', () => {
        signal.style.transform = 'perspective(900px) rotateY(0deg) rotateX(0deg)';
      });
    }
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCss(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
