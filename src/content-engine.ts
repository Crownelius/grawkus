/**
 * Content Engine — content creation and business skills system.
 * Inspired by everything-claude-code's article-writing, content-engine,
 * market-research, and investor-materials skills.
 *
 * Provides prompt builders for:
 * - Article writing with voice preservation
 * - Content repurposing across platforms
 * - Slide deck generation
 * - Market research with source attribution
 * - Investor pitch decks and outreach
 * - Code quality enforcement
 * - Skill audits
 * - Chief of staff communication triage
 */

// ── Content Creation ──────────────────────────────────────

/**
 * Build a detailed article prompt for long-form writing.
 * Includes SEO structure, voice preservation, and reader engagement tactics.
 *
 * @param topic — The article topic/headline
 * @param options — Optional: voice style, target length, audience
 * @returns Complete article-writing prompt
 */
export function buildArticlePrompt(
  topic: string,
  options?: {
    voice?: string;
    length?: 'short' | 'medium' | 'long';
    audience?: string;
  }
): string {
  const voice = options?.voice ?? 'expert, accessible, engaging';
  const length = options?.length ?? 'medium';
  const audience = options?.audience ?? 'general professional readers';

  const wordTargets: Record<string, { min: number; max: number }> = {
    short: { min: 500, max: 1000 },
    medium: { min: 1500, max: 2500 },
    long: { min: 2500, max: 4000 },
  };

  const target = wordTargets[length];

  return `
Write a long-form article on: "${topic}"

## Output Requirements
- **Word count:** ${target.min}–${target.max} words
- **Format:** Markdown with proper heading hierarchy (H1, H2, H3)
- **Audience:** ${audience}
- **Tone/Voice:** ${voice}

## Structure (Use this outline)
1. **Introduction** (100–150 words)
   - Hook: Open with a compelling question, insight, or stat
   - Context: Explain why this topic matters now
   - Thesis: State the article's core argument or promise
   - Roadmap: Preview the 3–5 main sections

2. **Body Sections** (3–5 sections)
   - Each section: 200–400 words
   - Lead with a clear subheading that answers a reader question
   - Open with a topic sentence or mini-story
   - Support claims with data, examples, or expert quotes
   - Close with a takeaway or transition to the next idea
   - Use short paragraphs (2–3 sentences) for scannability

3. **Practical Examples or Case Studies** (if applicable)
   - Real-world application or proof point
   - Show, don't tell: use concrete details
   - Extract a key lesson

4. **Conclusion** (100–150 words)
   - Restate the thesis in fresh language
   - Summarize the 3 biggest takeaways
   - End with a forward-looking statement or call to action
   - Optionally: pose a question for reader reflection

## SEO & Engagement
- Include 2–3 subheadings that match likely search queries
- Use active voice and strong verbs
- Break up text with bullet points or short lists where appropriate
- Aim for 60–70 Flesch Reading Ease (accessible to educated readers)
- Include at least one memorable quote, stat, or analogy
- Vary sentence length to maintain rhythm

## Quality Checklist
- [ ] Fact-checked claims (link to sources if available)
- [ ] No jargon without explanation
- [ ] Consistent terminology throughout
- [ ] Specific details rather than vague generalities
- [ ] Strong opening and closing
- [ ] Reader can apply insights immediately

---
**Begin the article below. Use Markdown. Do not include a title — start with H2 headings for sections.**
`;
}

/**
 * Build a prompt to repurpose a single piece of content across multiple platforms.
 * Adapts tone, length, and format for Twitter/X, LinkedIn, blog, email, Reddit, etc.
 *
 * @param content — Original content to repurpose
 * @param platforms — List of target platforms (e.g., ["twitter", "linkedin", "email"])
 * @returns Repurposing prompt with platform-specific guidance
 */
export function buildContentRepurposePrompt(
  content: string,
  platforms: string[]
): string {
  const platformGuides: Record<string, { maxLength: number; tone: string; format: string }> = {
    twitter: {
      maxLength: 280,
      tone: 'punchy, conversational, hook-first',
      format: 'Single tweet or thread (up to 10 tweets)',
    },
    x: {
      maxLength: 300,
      tone: 'witty, thought-provoking, debate-ready',
      format: 'Thread or standalone post',
    },
    linkedin: {
      maxLength: 1300,
      tone: 'professional, narrative-driven, insight-focused',
      format: 'Post with optional carousel or document',
    },
    blog: {
      maxLength: 2000,
      tone: 'educational, detailed, link-rich',
      format: 'Blog post excerpt (300–800 words)',
    },
    email: {
      maxLength: 500,
      tone: 'personal, benefit-driven, action-oriented',
      format: 'Email body (no subject) with clear CTA',
    },
    reddit: {
      maxLength: 800,
      tone: 'authentic, conversational, community-aware',
      format: 'Post or comment thread response',
    },
    newsletter: {
      maxLength: 1000,
      tone: 'curated, editorial, compelling',
      format: 'Newsletter section or standalone item',
    },
  };

  const platformsList = platforms
    .map(p => {
      const guide = platformGuides[p.toLowerCase()] || {
        maxLength: 500,
        tone: 'professional',
        format: 'standard format',
      };
      return `
**${p.toUpperCase()}**
- Max length: ${guide.maxLength} characters
- Tone: ${guide.tone}
- Format: ${guide.format}
`;
    })
    .join('\n');

  return `
Repurpose the following content for multiple platforms.

## Original Content
\`\`\`
${content}
\`\`\`

## Target Platforms & Requirements
${platformsList}

## Key Instructions
1. **Extract the core insight** — Identify the most valuable, shareable takeaway
2. **Adapt voice** — Match each platform's culture and audience expectations
3. **Reformat for platform constraints** — Respect character/length limits
4. **Optimize for discoverability** — Use platform-native features (hashtags on Twitter/LinkedIn, questions on Reddit, hooks in email subject)
5. **Preserve credibility** — Keep claims accurate; add context where needed
6. **Include CTAs** — Where appropriate, link back to full content or suggest next action

## Output Format
For each platform, provide:
- Platform name
- Adapted copy (full text)
- Any suggested hashtags, tags, or metadata
- Brief note on why this version works for that platform

---
**Begin below.**
`;
}

/**
 * Build a prompt to generate HTML slide deck content.
 * Useful for pitch decks, presentations, or educational materials.
 *
 * @param topic — Presentation topic
 * @param slideCount — Number of slides (default: 10)
 * @returns Slide-generation prompt
 */
export function buildSlidePrompt(topic: string, slideCount: number = 10): string {
  return `
Generate an HTML slide deck presentation on: "${topic}"

## Specifications
- Total slides: ${slideCount}
- Format: Self-contained HTML file with embedded CSS and JavaScript
- Styling: Modern, clean, readable; use a consistent color scheme
- Navigation: Arrow keys or on-screen buttons to advance slides
- Include a title slide, content slides, and a closing slide

## Slide Structure (adjust as needed)
1. **Title Slide** — Topic, date, optionally author/company
2. **Agenda or Overview** — What the presentation covers
3–${slideCount - 2}. **Content Slides** — Main topics, ideas, examples, data
${slideCount}. **Closing Slide** — Summary, call to action, contact info

## Design Guidelines
- **Typography:** Use a readable sans-serif font (Helvetica, Arial, or system sans)
- **Colors:** Limit to 2–3 primary colors + white/dark backgrounds
- **Images/Icons:** Use only if needed; keep visual clutter minimal
- **Text:** Keep bullet points to 3–5 lines per slide; use short, punchy phrases
- **Data:** Use charts or simple visuals for complex information
- **Contrast:** Ensure text is legible on background (WCAG AA minimum)

## HTML Requirements
- Responsive design (mobile-friendly)
- No external dependencies (embed all CSS/JS)
- Include keyboard navigation (arrow keys)
- Slide counter (e.g., "Slide 3 of ${slideCount}")
- Optional: slide transition effects (fade or slide)

## Output Format
Return complete, ready-to-save HTML. It should be able to run in any modern browser.

---
**Begin below. Provide ONLY the HTML code, no explanation.**
`;
}

// ── Business & Research ───────────────────────────────────

/**
 * Build a prompt for source-attributed market research.
 * Includes competitor analysis, trends, and data points with citations.
 *
 * @param topic — Research topic (e.g., "AI chatbot market")
 * @param sources — Optional list of source types to prioritize
 * @returns Market research prompt
 */
export function buildMarketResearchPrompt(
  topic: string,
  sources?: string[]
): string {
  const sourceGuide = sources
    ? `Prioritize these sources: ${sources.join(', ')}`
    : 'Use a mix of: industry reports, news articles, company earnings calls, analyst research, academic papers, and regulatory filings.';

  return `
Conduct market research on: "${topic}"

## Research Requirements
1. **Market Size & Growth**
   - Current market size (with year)
   - YoY growth rate (last 3 years if available)
   - Projected growth (next 3–5 years)
   - Key geographic regions

2. **Competitive Landscape**
   - Top 3–5 competitors: names, market share, key strengths/weaknesses
   - Market concentration (fragmented vs. consolidated)
   - Barriers to entry
   - New entrants or disruptors

3. **Trends & Drivers**
   - 3–5 major trends shaping the market
   - Customer pain points or unmet needs
   - Regulatory or policy changes
   - Technological shifts

4. **Customer Segments**
   - Primary buyers/users
   - Customer pain points or priorities
   - Purchasing drivers (price, features, brand, support)

5. **Distribution & Pricing**
   - How solutions reach customers (direct, reseller, marketplace)
   - Typical pricing models and ranges
   - Customer acquisition costs (if known)

## Source Guidance
${sourceGuide}

## Output Format
Use this structure:

### [Section Title]
**Finding:** [Clear statement or data point]
**Source:** [Source type and credibility note, e.g., "Gartner Magic Quadrant 2024" or "Q3 2024 SEC filing"]
**Date:** [Publication/data date]
**Notes:** [Brief context or supporting detail]

---

**Critical Rule:** Every claim must be attributed. If you're uncertain about a data point, note it as "likely range" or "estimated by [source]."

**Begin below.**
`;
}

/**
 * Build a prompt to create investor pitch deck content.
 * Includes: problem, solution, market, traction, team, ask.
 *
 * @param company — Company name
 * @param stage — Funding stage (e.g., "seed", "Series A", "Series B")
 * @returns Investor deck prompt
 */
export function buildInvestorDeckPrompt(
  company: string,
  stage?: string
): string {
  const stageContext =
    stage && ['seed', 'series-a', 'series-b', 'series-c', 'growth'].includes(stage.toLowerCase())
      ? `This is a ${stage} round.`
      : 'Stage not specified; use standard startup pitch format.';

  return `
Generate an investor pitch deck outline for: "${company}"

${stageContext}

## Standard Pitch Deck Structure (12–15 slides)

1. **Title Slide**
   - Company name, tagline, logo
   - Founder names (optional)

2. **The Problem**
   - Customer pain point (specific, quantified if possible)
   - Current inefficiency or cost
   - Who feels this pain? (target customer segment)
   - Why now? (market conditions, urgency)

3. **The Solution**
   - How your product/service solves the problem
   - Unique approach or differentiation
   - Key features or capabilities (if not obvious)
   - Product demo or visual mockup (if applicable)

4. **Market Opportunity**
   - Total Addressable Market (TAM)
   - Serviceable Addressable Market (SAM)
   - Serviceable Obtainable Market (SOM) — Year 1 target
   - Market growth trajectory

5. **Business Model**
   - How you make money (SaaS, marketplace, licensing, etc.)
   - Pricing strategy
   - Unit economics (if favorable)
   - Customer lifetime value vs. CAC

6. **Go-to-Market Strategy**
   - How you'll acquire customers
   - Sales/marketing channels
   - Partnerships or distribution deals
   - Timeline to first revenue (if pre-revenue)

7. **Competitive Landscape**
   - Direct and indirect competitors
   - Your competitive advantages
   - Market positioning (what's different?)

8. **Traction**
   - Users, revenue, or engagement metrics
   - Growth rate (MoM or YoY)
   - Key milestones achieved
   - Customer testimonials or logos (if applicable)

9. **Team**
   - Founder/leadership backgrounds (relevant experience)
   - Key hires or advisors
   - Why this team can win

10. **Financials & Projections** (3-year forward)
    - Historical revenue (if applicable)
    - Revenue projections (conservative, realistic, optimistic)
    - Path to profitability or key profitability milestones
    - Burn rate and runway

11. **Use of Funds**
    - Allocation: product, sales/marketing, operations, hiring
    - Key hires or investments planned
    - How this accelerates growth

12. **The Ask**
    - Funding amount
    - Post-money valuation (if appropriate)
    - Investor benefits/rights

13. **Closing / Vision**
    - Long-term vision (where is the company in 10 years?)
    - Why this matters
    - Call to action (discuss further, office hours, etc.)

## Content Guidelines
- **Problem & Solution:** Make it visceral and urgent, not abstract
- **Numbers:** Use realistic, defensible figures; note assumptions
- **Tone:** Confident but not overconfident; show you understand risks
- **Design Notes:** Recommend high-contrast colors, minimal text, strong visuals
- **Storytelling:** Lead with narrative (why does this founder care?), then data

## Investor Mindset
Investors ask: "Is this a real problem? Can this team solve it? Is the market big? Will they spend the money wisely? What's my return?"

---
**For each slide, provide:**
- **Slide Title**
- **Key Points** (3–5 bullet points)
- **Visual Recommendations** (e.g., "charts showing market growth," "team photos")

**Begin below.**
`;
}

/**
 * Build a prompt for personalized investor outreach and follow-up sequences.
 * Creates multi-step email templates tailored to specific investors.
 *
 * @param investor — Investor name and firm
 * @param company — Your company name
 * @returns Outreach prompt with email templates
 */
export function buildInvestorOutreachPrompt(
  investor: string,
  company: string
): string {
  return `
Create a personalized investor outreach sequence for: ${investor} at their firm, on behalf of ${company}.

## Objectives
1. Grab attention with a specific, credible hook
2. Briefly convey your value proposition
3. Request an initial conversation (office hours, brief call)
4. Follow up if no response (2–3 touch points)
5. Maintain professionalism and respect for their time

## Email Sequence

### Email 1: Initial Outreach
**Subject Line:** [Create 2 options: one reference-based, one curiosity-based]
**Body:**
- Personalization: Show you know their recent investments, thesis, or public comments
- Credibility: Why you're reaching out to them specifically (not form email)
- Hook: Lead with the biggest insight or problem your company solves
- Social proof: Any mutual connections, relevant credential, or early traction
- Clear CTA: Request 15–20 min call or office hours; link to calendar if possible
- Tone: Warm, respectful, brief (under 150 words in body)

### Email 2: Follow-up (5–7 days after #1, if no response)
**Subject Line:** [Light, not pushy; e.g., "Quick thought on [specific area]"]
**Body:**
- Acknowledge you may have missed them
- Add one new detail, article, or social proof not in Email 1
- Soften the CTA: "If you're open to a brief conversation, I'd love to share..."
- Keep it short (100 words)

### Email 3: Final Touch (10–14 days after #1)
**Subject Line:** [Ask for specific advice or specific feedback, not a meeting]
**Body:**
- Shift from "I want your money" to "I value your expertise"
- Ask a genuine question about their thesis, the market, or your approach
- Make it clear this is your last outreach attempt
- Leave door open: "No pressure, but always happy to connect if timing improves"

## Personalization Checklist
- [ ] Investor's recent investment(s) or public statement(s) mentioned
- [ ] Reason why *this investor specifically* is a good fit (not just a big firm)
- [ ] Company's unique angle or unfair advantage briefly stated
- [ ] One concrete metric or milestone (users, revenue, engagement)
- [ ] Honest, conversational tone — not salesy
- [ ] Calendar link or specific meeting options provided

---
**Provide the sequence below. For each email, include:**
- **Subject Line**
- **Body Text** (formatted as it would appear in email)
- **Brief notes** on timing and personalization cues

**Begin below.**
`;
}

// ── Code Quality ──────────────────────────────────────────

/**
 * Build a prompt for write-time code quality enforcement.
 * Checks naming, function length, complexity, documentation, test coverage expectations.
 * Inspired by plankton-code-quality.
 *
 * @param cwd — Working directory context (used to determine language/framework)
 * @returns Code quality prompt
 */
export function buildCodeQualityPrompt(cwd: string): string {
  return `
Review code quality for the project at: ${cwd}

## Code Quality Checklist

### 1. Naming Conventions
- [ ] Functions, variables, and methods use clear, intention-revealing names
- [ ] No single-letter variables except for loop counters (i, j, k)
- [ ] Class/type names are nouns; function names are verbs
- [ ] Avoid abbreviations unless universally understood (e.g., "id" OK, "idx" not OK)
- [ ] Boolean functions/variables start with "is", "has", "can", "should"
- [ ] Constant names use SCREAMING_SNAKE_CASE
- [ ] Private methods/fields prefixed with underscore (if not using access modifiers)

### 2. Function Length & Complexity
- [ ] Functions are short and focused (prefer <30 lines; max 50)
- [ ] Functions do one thing well
- [ ] Cyclomatic complexity <= 10 (avoid deep nesting)
- [ ] Early returns reduce indentation and improve readability
- [ ] No nested callbacks or callback hell

### 3. Comments & Documentation
- [ ] Public APIs (exports) have JSDoc or equivalent docstrings
- [ ] Complex logic has inline comments explaining the "why", not "what"
- [ ] No obsolete or redundant comments
- [ ] TODOs are dated and reference an issue/PR if possible
- [ ] README or file-level comments explain module purpose

### 4. Error Handling
- [ ] All promises are awaited or explicitly handled
- [ ] No silent failures (catch blocks log or throw)
- [ ] Errors include context (not just generic messages)
- [ ] Type safety: use typed errors, not generic strings

### 5. Testing Expectations
- [ ] Critical paths have test coverage (>80% target)
- [ ] Tests are descriptive: test names explain the scenario
- [ ] Tests are isolated (no shared state between tests)
- [ ] Edge cases are covered (empty input, null, boundary values)
- [ ] No test-only code in production

### 6. Code Style & Formatting
- [ ] Consistent indentation and spacing
- [ ] Lines under 100 characters (adjust for project)
- [ ] Imports organized: dependencies first, then relative imports
- [ ] No unused imports or variables
- [ ] Consistent quote style and semicolon usage

### 7. Type Safety (if applicable)
- [ ] Exported functions have explicit return types
- [ ] Generic types are narrow and well-constrained
- [ ] No use of "any" unless unavoidable (with comment)
- [ ] Objects prefer interfaces/types over inline shapes
- [ ] Nullable types are explicit (Optional, null, undefined)

### 8. Performance & Resources
- [ ] No N+1 queries or unnecessary loops
- [ ] No memory leaks (event listeners cleaned up, streams closed)
- [ ] No console.log in production code
- [ ] Heavy operations are async/non-blocking

### 9. Maintainability
- [ ] DRY: no obvious code duplication (extract to helper)
- [ ] Prefer composition over inheritance
- [ ] Constants are defined once (no magic numbers)
- [ ] Configuration is centralized, not scattered
- [ ] Dependencies are minimal and justified

### 10. Security & Best Practices
- [ ] No hardcoded secrets (API keys, passwords)
- [ ] Input validation for user-facing APIs
- [ ] SQL queries use parameterized statements (no injection)
- [ ] Dependencies are up-to-date and vulnerable-free
- [ ] CORS, CSP, or other security headers configured (if web)

---
## Output Format
For each file or module reviewed:
- **File:** [path/to/file]
- **Status:** PASS / WARNINGS / FAIL
- **Issues Found:** [List each issue with line number if applicable]
- **Recommendations:** [Specific, actionable improvements]
- **Priority:** CRITICAL / HIGH / MEDIUM / LOW

---
**Begin audit below. Scan all source files in the directory.**
`;
}

/**
 * Build a prompt to audit all skills and commands for quality and coverage gaps.
 * Useful for maintaining skill libraries and identifying missing coverage.
 *
 * @returns Skill stocktake prompt
 */
export function buildSkillStocktakePrompt(): string {
  return `
Audit all available skills and commands for quality, coverage, and consistency.

## Audit Scope

### 1. Coverage Analysis
- [ ] List all available skills/commands by category
- [ ] Identify any obvious gaps (e.g., "we have email drafting but no email reply")
- [ ] Note overlapping or redundant skills
- [ ] Flag skills that seem underused or unfinished
- [ ] Check for skills that depend on external tools/APIs (and their health)

### 2. Quality Assessment
For each skill:
- **Documentation:** Is the skill description clear and actionable?
- **Parameters:** Are inputs well-defined and validated?
- **Output:** Does the skill return useful, formatted output?
- **Error Handling:** How does it fail gracefully?
- **Examples:** Are there usage examples?

### 3. Consistency Check
- [ ] Naming: Are skill names consistent in style (verbs, nouns, hyphens)?
- [ ] Behavior: Do similar skills work in similar ways?
- [ ] Parameters: Common parameters use same names across skills
- [ ] Output Format: Is output (JSON, markdown, etc.) predictable?
- [ ] Error Messages: Are failures explained clearly?

### 4. Performance & Reliability
- [ ] Skills respond in <5s for typical use cases
- [ ] No unnecessary external API calls
- [ ] Caching or batching where applicable
- [ ] Rate limiting or retry logic in place
- [ ] Uptime/reliability track record (if known)

### 5. Integration Opportunities
- [ ] Skills that could feed into each other (chaining)
- [ ] Skills that could share common utilities
- [ ] Duplicate logic that could be extracted
- [ ] Cross-tool dependency issues

---
## Output Format
Provide a structured report:

### Summary
- Total skills audited: X
- Pass: X | Warnings: X | Improvements needed: X

### By Category
For each category (e.g., Writing, Research, Data):
- Skills in category: [list]
- Coverage: [what's well covered, what's missing]
- Quality: [overall assessment]

### Gaps & Recommendations
- **High Priority:** [Missing skills or broken features]
- **Medium Priority:** [Quality or consistency improvements]
- **Low Priority:** [Nice-to-have enhancements or optimizations]

### Top 5 Improvements
1. [Specific action with expected benefit]
2. [...]

---
**Begin audit below.**
`;
}

// ── Chief of Staff / Communication ────────────────────────

/**
 * Build a prompt for communication triage and Chief of Staff duties.
 * Helps draft emails, summarize threads, prioritize messages.
 *
 * @param context — Current context (e.g., email thread, list of messages)
 * @returns Chief of staff triage prompt
 */
export function buildChiefOfStaffPrompt(context: string): string {
  return `
Act as a Chief of Staff to triage and manage the following communications context.

## Context
\`\`\`
${context}
\`\`\`

## Triage Tasks

### 1. Priority Assessment
For each message, email, or thread:
- **Priority:** URGENT | HIGH | MEDIUM | LOW
- **Category:** Decision Needed | FYI | Action Required | Discussion
- **Owner:** Who should handle this? (if identifiable)
- **Timeline:** When is a response/decision due?
- **Impact:** If left unaddressed, what happens?

### 2. Summarization
For long threads or email chains:
- **Subject:** One-line summary
- **Key Points:** 3–5 bullet points of the core issue
- **Stakes:** What's at risk? What's the decision?
- **Sentiment:** Is there urgency, conflict, or alignment?
- **Recommended Response:** Approving, requesting more info, escalating, etc.

### 3. Draft Responses
For messages requiring replies:
- **To:** Recipient(s)
- **Subject Line:** Clear, professional
- **Body:**
  - Acknowledge the sender's concern/question
  - Provide a clear answer or next step
  - Keep it concise (under 150 words if possible)
  - Maintain consistent tone
- **Tone Options:** Professional, warm, direct, collaborative (choose based on context)

### 4. Meeting Notes / Action Items
If this involves a meeting or decision point:
- **Attendees:** Who was there?
- **Decisions Made:** What was agreed?
- **Action Items:** Who owns what, with deadline?
- **Follow-up:** What's the next touchpoint?

### 5. Identify Patterns
- **Recurring Issues:** Any themes across messages?
- **Blocking Points:** What's slowing decisions or actions?
- **Communication Gaps:** Where's unclear or missing info?
- **Escalation Risks:** What could become problems if not addressed?

---
## Output Format

### Quick Triage Table
| Subject | Priority | Category | Owner | Due | Action |
|---------|----------|----------|-------|-----|--------|
| [subject] | HIGH | Decision | [name] | [date] | [brief action] |
| ... | | | | | |

### Detailed Summaries
**[Message/Thread 1 Subject]**
- Priority: HIGH
- Summary: [2–3 sentences]
- Recommended Action: [Specific next step]
- Draft Response: [If needed, include suggested reply]

### Patterns & Recommendations
- Pattern 1: [Observation]
- Pattern 2: [Observation]
- Recommended Process Change: [How to avoid this in future]

---
**Begin triage below.**
`;
}
