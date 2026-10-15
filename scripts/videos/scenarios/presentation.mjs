// The project presentation: a walkthrough of reports/bright-smile-report.md in
// VS Code that works through the project files behind each part of it.
//
// Recorded as a person would present it by hand: files are opened by clicking
// down the explorer tree, the report is scrolled with the wheel, the cursor
// rests on what is being described, and code is highlighted by selecting it.
// The only thing added to the screen is the caption. Captions paraphrase the
// report and the code on screen, so nothing is claimed that they do not say.

import { hover, pause } from "../lib/human.mjs";
import {
  closeEditor,
  collapseExplorer,
  explorerExpand,
  explorerOpen,
  explorerRow,
  lineOf,
  pointAt,
  previewFrame,
  previewHeading,
  scrollPreviewTo,
  showLines,
} from "../lib/vscode.mjs";

const REPORT_TITLE = "Project Report";
const BACKEND = "backend/src/bright_smile";

const report = (page) => previewFrame(page, REPORT_TITLE);

/** Scroll the report to a heading and, optionally, point at what is below it. */
function present(heading, { mark, offset } = {}) {
  return async (page) => {
    const frame = await report(page);
    if (heading) await scrollPreviewTo(page, frame, previewHeading(frame, heading), { offset });
    for (const pick of [mark].flat().filter(Boolean)) {
      await pointAt(page, frame, pick(frame));
      await pause(900);
    }
  };
}

/** Scroll the report so `pick(frame)` is near the top, then point at it. */
function presentAt(pick, { offset = 140 } = {}) {
  return async (page) => {
    const frame = await report(page);
    const target = pick(frame);
    await scrollPreviewTo(page, frame, target, { offset });
    await pointAt(page, frame, target);
  };
}

/** Close every file opened since the last return, and tidy the tree. */
async function backToReport(page, state) {
  for (let i = 0; i < (state.open ?? 0); i += 1) await closeEditor();
  state.open = 0;
  await report(page);
  await collapseExplorer(page);
  await pause(300);
}

const row = (text) => (frame) => frame.locator("tr").filter({ hasText: text }).first();
const table = (text) => (frame) => frame.locator("table").filter({ hasText: text }).first();
const para = (text) => (frame) => frame.locator("p").filter({ hasText: text }).first();
const list = (text) => (frame) => frame.locator("ol, ul").filter({ hasText: text }).first();

// Long enough to read the caption at a relaxed pace, on top of the action.
const read = (caption) => Math.round(1000 + caption.length * 46);

function beat(caption, action, { extra = 0 } = {}) {
  return { caption, action, holdMs: read(caption) + extra };
}

/** A report beat: back from any open files first, then to the section. */
function section(caption, heading, options) {
  return beat(caption, async (page, state) => {
    if (state.open) await backToReport(page, state);
    await present(heading, options)(page);
  });
}

/** A code beat: open `file` from the explorer and select from the line
 * matching `from` through the first line after it matching `to`. */
function code(caption, file, from, to, { endOffset = 0 } = {}) {
  return beat(
    caption,
    async (page, state) => {
      await explorerOpen(page, file);
      state.open = (state.open ?? 0) + 1;
      const start = await lineOf(file, from);
      const end = to ? (await lineOf(file, to, start)) + endOffset : start;
      await showLines(page, start, end);
    },
    { extra: 1800 },
  );
}

export default [
  // Opening
  beat("Bright Smile Dental AI Front Desk: the project presentation.", async () => {
    await pause(1500);
  }),
  beat(
    "The repository: backend holds the FastAPI service and the AI agent, frontend the website and the staff dashboard, and reports this project report.",
    async (page) => {
      for (const name of ["backend", "frontend", "reports"]) {
        await hover(page, explorerRow(page, name));
        await pause(700);
      }
    },
  ),
  beat(
    "I'll follow the report, and open the code behind each part as we go.",
    async (page) => {
      await explorerOpen(page, "reports/bright-smile-report.md");
      const frame = await report(page);
      await pause(800);
      await pointAt(page, frame, list("Status:")(frame));
    },
  ),

  // 1. Executive summary
  section(
    "The brief: use the practice's knowledge base to build something that drives more revenue and makes the employees' lives easier.",
    "1. Executive summary",
    { mark: para("The brief was open") },
  ),
  beat(
    "I built an AI Front Desk in two parts: a patient chat assistant that answers only from the knowledge base and turns a conversation into an appointment request, and a dashboard that tells staff who to call first.",
    present(null, { mark: list("A patient chat assistant") }),
  ),
  beat(
    "In four lines: requests captured 24/7, routine questions answered before they reach the phone, safety rules enforced in code, and the evidence behind it.",
    presentAt(table("Staff time"), { offset: 110 }),
  ),

  // 3.1 The chat assistant, in the code
  section(
    "3.1 The chat assistant: grounded answers, prices quoted as estimates, insurance questions, the practice's offers when relevant, and validated appointment requests.",
    "3.1 Patient chat assistant",
    { mark: [row("Grounded answers"), row("Appointment requests")] },
  ),
  code(
    "Every chat message arrives at api/routes/chat.py: one message in, a server-sent event stream out, rate limited per IP.",
    `${BACKEND}/api/routes/chat.py`,
    /^@router\.post\(/,
    /^async def post_chat/,
  ),
  code(
    "On the website, lib/chat/sse.ts reads that stream. Its event types are generated from the backend's own schema, so the two cannot drift apart.",
    "frontend/src/lib/chat/sse.ts",
    /^export type ChatStreamEvent/,
    /DoneEvent"\];/,
  ),
  code(
    "When the visitor has given every detail, the model calls the capture_lead tool in agent/tools.py. Its argument schema is LeadCreate.",
    `${BACKEND}/agent/tools.py`,
    /^capture_lead: BaseTool/,
    /response_format=/,
    { endOffset: 1 },
  ),
  code(
    "LeadCreate, in schemas/leads.py, refuses a request without a real US phone number, normalized to E.164, or without explicit consent.",
    `${BACKEND}/schemas/leads.py`,
    /^UsPhone = /,
    /^ContactConsent = /,
  ),
  code(
    "create_lead in services/leads.py saves the request with its priority, callback deadline and after-hours flag, all computed by code.",
    `${BACKEND}/services/leads.py`,
    /created_at = now or utc_now\(\)/,
    /after_hours=is_after_hours/,
  ),

  // 3.2 The dashboard, in the code
  section(
    "3.2 The dashboard answers one question: who should we call next? One queue ordered P1 to P4, a callback deadline on every row, the transcript, and safety warnings.",
    "3.2 Front-desk dashboard",
    { mark: [row("Prioritized queue"), row("Callback SLA")] },
  ),
  code(
    "In frontend/src/components/leads, leads-table.tsx tints overdue rows and marks requests that arrived after hours.",
    "frontend/src/components/leads/leads-table.tsx",
    /^function LeadRow/,
    /lead\.after_hours \?/,
  ),
  code(
    "lib/leads/format.ts turns the deadline into the labels staff read: Due in 3 h, or Overdue by 30 h.",
    "frontend/src/lib/leads/format.ts",
    /^export function slaStatus/,
    /^}/,
  ),
  code(
    "proxy.ts sends anyone without a session to the login page. The backend still checks every request on its own.",
    "frontend/src/proxy.ts",
    /^export function proxy/,
    /^}/,
  ),

  // 3.3 The website
  section(
    "3.3 Every fact on the practice website comes from the same knowledge base the assistant uses.",
    "3.3 Practice website",
    { mark: para("Every fact on the page") },
  ),
  code(
    "The website reads content/kb.json, which is exported from the backend's knowledge base, never typed by hand.",
    "frontend/src/content/kb.json",
    /"practice_name"/,
    /"email"/,
  ),
  code(
    "check:api regenerates it with the API types, and CI fails if anything changed. The website and the assistant cannot disagree.",
    "frontend/package.json",
    /"check:api"/,
    /"gen:kb"/,
  ),

  // 4. Benefit
  section(
    "4. The customer benefit. Revenue: requests that arrive while both offices are closed, questions turned into bookings, the practice's offers used consistently, and high-value consults called first.",
    "4.1 Revenue",
    { mark: table("Requests that would otherwise be lost") },
  ),
  beat(
    "Illustrative, not measured: five extra new-patient requests a week, half of them booking the $149 visit, is about $370 a week in first visits alone.",
    presentAt(para("Illustrative only"), { offset: 160 }),
  ),
  section(
    "Staff time: every request arrives complete with its transcript, in one queue ordered by rule, and overdue callbacks are counted instead of slipping by.",
    "4.2 Staff time",
    { mark: table("With the AI Front Desk") },
  ),

  // 5. Why
  section(
    "5. Why this solution. The knowledge base describes the moment a new patient makes contact. That is where revenue is won or lost, so I improved it end to end.",
    "5.1 Starting from the knowledge base",
    { mark: para("Read together") },
  ),
  section(
    "Options set aside: a scripted chatbot, a voice agent, real-time booking, vector search over a one-page knowledge base, and an assistant without a dashboard.",
    "5.2 Options considered",
    { mark: table("FAQ page") },
  ),
  section(
    "Four principles: the knowledge base is the only source of truth, rules are code and not prompts, fail safe, and build to hand over.",
    "5.3 Design principles",
    { mark: list("only source of truth") },
  ),
  code(
    "The knowledge base is typed data in agent/kb.py. Its Saturday-hours conflict is recorded here with how to handle it, never left to the model.",
    `${BACKEND}/agent/kb.py`,
    /^KNOWN_ISSUES = \(/,
    /^\)/,
  ),
  code(
    "agent/prompts.py builds the system prompt: the knowledge base first, then the rules. It is identical on every request, so OpenAI's prompt caching applies.",
    `${BACKEND}/agent/prompts.py`,
    /^@cache/,
    /return render_kb\(\)/,
  ),

  // 5.4 Technology and LangGraph
  section(
    "5.4 Technology: Python with async FastAPI, Pydantic, LangGraph with OpenAI, MongoDB, and Next.js with shadcn/ui, each with the trade-off accepted.",
    "5.4 Technology choices",
    { mark: table("FastAPI") },
  ),
  code(
    "agent/llm.py: the OpenAI model through langchain-openai, output capped, with a timeout and retries, on the Responses API.",
    `${BACKEND}/agent/llm.py`,
    /return ChatOpenAI\(/,
    /use_responses_api=True/,
    { endOffset: 1 },
  ),
  section(
    "Why LangGraph: the conversation is an explicit graph. A deterministic safety guard runs before the model on every turn, and the model cannot skip it.",
    "Why LangGraph",
    { mark: para("The assistant has to do more than answer") },
  ),
  code(
    "That graph is agent/graph.py: START to guard, guard to agent, agent to tools and back, then END.",
    `${BACKEND}/agent/graph.py`,
    /graph\.add_node\(Node\.GUARD/,
    /graph\.add_edge\(Node\.AGENT, END\)/,
  ),
  code(
    "The guard in agent/guard.py is plain, tested Python: it flags emergencies and medical questions, and adds the required instruction for that turn.",
    `${BACKEND}/agent/guard.py`,
    /^def detect_flags/,
    /return frozenset\(flags\)/,
  ),

  // 6. How it was built
  section(
    "6. How it was built. The browser only talks to the website. Next.js forwards /api to FastAPI, which runs the guard, the agent and the tool, with OpenAI and MongoDB behind it.",
    "6.1 Architecture",
    { mark: para("The browser only ever talks") },
  ),
  beat(
    "The backend is layered: api routes stay thin, services orchestrate, domain holds the pure business rules, db the MongoDB documents, and agent the AI.",
    async (page) => {
      await explorerExpand(page, BACKEND);
      for (const name of ["api", "services", "domain", "db", "agent"]) {
        await hover(page, explorerRow(page, name));
        await pause(650);
      }
    },
  ),
  section(
    "6.3 The business rules are pure functions with unit tests: priority, the callback deadline, after hours, and overdue.",
    "6.3 Business rules",
    { mark: table("Callback deadline") },
  ),
  code(
    "compute_priority in domain/leads.py: first match wins. Emergencies are P1; Invisalign, implants and crowns P2; new patients P3. The model never decides this.",
    `${BACKEND}/domain/leads.py`,
    /^def compute_priority/,
    /return Priority\.P4/,
  ),
  code(
    "sla_due_at in domain/schedule.py: 5 PM practice time on the next business day, which is the practice's own callback promise.",
    `${BACKEND}/domain/schedule.py`,
    /^def sla_due_at/,
    /return datetime\.combine/,
  ),
  code(
    "tests/unit/test_schedule.py pins the edge cases: practice time rather than UTC, and both daylight-saving changes.",
    "backend/tests/unit/test_schedule.py",
    /^def test_sla_uses_practice_time_not_utc/,
    /assert due == datetime\(2026, 11, 2/,
  ),
  code(
    "6.4 Data: a conversation is one MongoDB document. Anonymous ones expire through a TTL index; those that produced a request are kept for staff.",
    `${BACKEND}/db/documents/conversation.py`,
    /^class Conversation\(Document\)/,
    /IndexModel\(\[\("lead_id"/,
  ),
  section(
    "6.6 How the work was run: specification first, then issue, branch, pull request, green CI, merge. Nine pull requests built the product in layers.",
    "6.6 How the work was run",
    { mark: list("Specification first") },
  ),
  beat(
    "SPEC.md is the source of truth for behavior, data model, API contract and quality bar, and it changes in the same pull request as the behavior.",
    async (page, state) => {
      await explorerOpen(page, "SPEC.md");
      state.open = (state.open ?? 0) + 1;
      const spec = await previewFrame(page, "Specification");
      await pause(800);
      await scrollPreviewTo(page, spec, previewHeading(spec, "3. User stories"), { offset: 90 });
    },
  ),
  code(
    "One required check, ci-ok, gates every merge: lint, format, strict typing, tests, the build, and a check that the generated files still match the backend.",
    ".github/workflows/ci.yml",
    /^ {2}ci-ok:/,
    /timeout-minutes/,
  ),

  // 7. Quality
  section(
    "7. Quality: 157 backend tests against a real MongoDB, 24 frontend tests, strict mypy, and a clean lint and build.",
    "7.1 Automated checks",
    { mark: table("157 passed") },
  ),
  section(
    "12 golden evaluations drive the real model and check behavior, not wording. All 12 must pass before a release, and they do.",
    "7.2 Golden evaluations",
    { mark: table("Patient says") },
  ),
  code(
    "Here is one in tests/evals/test_golden.py: a severe emergency must get ER or 911 guidance and raise the emergency flag.",
    "backend/tests/evals/test_golden.py",
    /^async def test_e05/,
    /says\(turn, r"emergency room/,
  ),
  section(
    "7.3 Defects were found by exercising the real system, and fixed: tool calls with reasoning needed the Responses API, and a mild symptom question is now flagged for staff.",
    "7.3 Defects found and fixed",
    { mark: list("Every live chat turn failed") },
  ),

  // 8. Demonstration
  section(
    "8. Demonstration: four recorded videos of the running system with the live model. Every caption about a reply is backed by an automatic check of what was on screen.",
    "8.1 Recorded demo videos",
    { mark: table("video-1") },
  ),
  beat("The videos are in reports/videos, and scripts/videos re-records them from a script.", async (page) => {
    await explorerExpand(page, "reports/videos");
    await hover(page, explorerRow(page, "video-4-the-front-desk-dashboard.mp4"));
  }),

  // 9 and 10
  beat(
    "9. Security and privacy: no message content or personal data in the logs, rate limits on chat, form and login, and anonymous chats deleted after 90 days.",
    async (page) => {
      await collapseExplorer(page);
      await present("9.1 Data handling", { mark: list("Logs never contain") })(page);
    },
  ),
  code(
    "The limits live in core/rate_limit.py: 20 chat messages a minute, 5 form requests an hour, and 5 login attempts per 15 minutes, per IP.",
    `${BACKEND}/core/rate_limit.py`,
    /^POLICIES/,
    /Policy\.LOGIN: RateLimit/,
    { endOffset: 1 },
  ),
  section(
    "Known limits, by design: not HIPAA-ready yet, one shared staff password, no scheduling-system integration. Each has a path forward in the report.",
    "9.4 Limitations of v1",
    { mark: table("Not HIPAA-ready") },
  ),
  section(
    "Next step: SonarQube analysis on every pull request, with its Quality Gate as a required check alongside ci-ok.",
    "10. Next steps",
    { mark: table("Analyze both codebases"), offset: 120 },
  ),
  beat("That is the Bright Smile Dental AI Front Desk. Thank you.", async () => {
    await pause(1000);
  }),
];
