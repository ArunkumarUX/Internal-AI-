export type Source = {
  id: string;
  title: string;
  system: string;
  owner: string;
  date: string;
  kind: string;
  client: string;
  tags: string[];
  content: string;
  status: string;
  version?: string;
  url?: string;
  sample?: boolean;
};
export const sources: Source[] = [
  {
    id: "northstar-brief",
    title: "Northstar Bank · Relationship brief",
    system: "Notion",
    owner: "Sarah Chen",
    date: "2026-09-17",
    kind: "Client brief",
    client: "Northstar Bank",
    tags: ["banking", "client", "relationship", "meeting"],
    status: "Verified",
    version: "3.0",
    sample: true,
    content:
      "Northstar Bank is a fictional retail banking client in our sample workspace. Relationship owner: Sarah Chen. The current focus is responsible GenAI adoption in operations and customer service. Discovery workshops identified document-heavy onboarding and knowledge retrieval as priority use cases. The next steering conversation should confirm the target pilot, governance owners and success criteria. No signed production expansion is recorded. Open commitments: share the architecture decision record, confirm data residency, and nominate business process owners.",
  },
  {
    id: "atlas-status",
    title: "Project Atlas · September delivery update",
    system: "Confluence",
    owner: "James Wilson",
    date: "2026-09-18",
    kind: "Project update",
    client: "Northstar Bank",
    tags: ["banking", "atlas", "project", "status", "deployment", "risk"],
    status: "Verified",
    version: "4.0",
    sample: true,
    content:
      "Project Atlas supports Northstar Bank’s internal banking knowledge assistant. Status: discovery complete; pilot in delivery. Current planned deployment is August 2027, subject to security approval. An earlier proposal listed June 2027; this discrepancy requires owner confirmation. Completed: source inventory, identity mapping and the retrieval evaluation plan. Risks: data-residency sign-off and incomplete permission metadata. Owners: James Wilson, delivery; Maya Patel, architecture. Next action: confirm pilot access groups before the steering meeting. No production performance results are available yet.",
  },
  {
    id: "banking-cases",
    title: "Banking AI · Three delivery case studies",
    system: "SharePoint",
    owner: "Maya Patel",
    date: "2026-08-28",
    kind: "Case study",
    client: "Northstar Bank",
    tags: ["banking", "genai", "expertise", "use cases", "proposal", "pitch"],
    status: "Verified",
    sample: true,
    content:
      "Sample delivery evidence contains three banking engagements. Meridian: an internal policy assistant with permission-aware retrieval and source citations. Harbour: an onboarding document triage pilot with human review of extracted fields. Northstar: Project Atlas, an internal knowledge assistant currently in pilot delivery. Reusable assets include retrieval evaluation rubrics, an access-control checklist and a source-provenance component. Maya Patel led retrieval architecture; Daniel Okafor led evaluation; Sofia Rossi led adoption research. These are fictional examples, not verified commercial outcomes. No quantified savings have been substantiated.",
  },
  {
    id: "atlas-decision",
    title: "ADR 014 · Permission-aware retrieval",
    system: "Confluence",
    owner: "Maya Patel",
    date: "2026-09-10",
    kind: "Decision",
    client: "Northstar Bank",
    tags: ["architecture", "decision", "atlas", "security"],
    status: "Verified",
    sample: true,
    content:
      "Decision: use architecture B, with source permission filters applied before retrieval. Owner: Maya Patel. Date: 10 September 2026. Context: the pilot indexes documents across several teams with different access groups. Rationale: filtering before retrieval reduces the risk of inaccessible content entering model context. Trade-off: more integration work to refresh group membership. Rejected alternative: retrieve all documents and redact after generation. Affected work: Project Atlas. Follow-up: evaluate access revocation propagation and test cross-team isolation.",
  },
  {
    id: "northstar-rfp",
    title: "Northstar Bank · AI transformation RFP",
    system: "SharePoint",
    owner: "Sarah Chen",
    date: "2026-09-15",
    kind: "RFP",
    client: "Northstar Bank",
    tags: ["rfp", "proposal", "requirements", "banking", "pitch"],
    status: "Verified",
    sample: true,
    content:
      "Sample RFP requirements: R1. Provide a permission-aware internal knowledge assistant. R2. Retain answer citations with source ownership and dates. R3. Support an approved UK data-residency model. R4. Provide evaluation results for retrieval and answer quality. R5. Deliver a 12-week discovery and pilot plan. R6. Include banking case studies, a proposed team and transparent pricing assumptions. R7. Include human approval before external write actions. Evidence gaps: formal residency sign-off and production performance benchmarks are not available. Response deadline: 30 September 2026.",
  },
  {
    id: "pricing-current",
    title: "Advisory pricing · 2026 reference",
    system: "SharePoint",
    owner: "Emma Thompson",
    date: "2026-09-02",
    kind: "Pricing",
    client: "All clients",
    tags: ["pricing", "commercial", "rates", "margin", "proposal"],
    status: "Verified",
    version: "2.0",
    sample: true,
    content:
      "Illustrative pricing reference, not an approved offer: lead architect £1,200 per day; consultant £850 per day; delivery manager £950 per day. Standard planning assumption: five working days per week. A 12-week pilot with one architect at 50%, two consultants at 100%, and a delivery manager at 50% implies 30 architect days, 120 consultant days and 30 manager days, totaling £166,500 before contingency, tax and expenses. Apply a 10% contingency for a planning total of £183,150. Cost inputs and actual margins require finance authorisation. Commercial approval is required before sending any offer.",
  },
  {
    id: "pricing-old",
    title: "Advisory pricing · 2025 archive",
    system: "Notion",
    owner: "Emma Thompson",
    date: "2025-02-01",
    kind: "Pricing",
    client: "All clients",
    tags: ["pricing", "commercial", "rates"],
    status: "Stale",
    version: "1.0",
    sample: true,
    content:
      "Archived illustrative reference: lead architect £1,000 per day; consultant £750 per day; delivery manager £850 per day. This document is superseded by Advisory pricing · 2026 reference. Do not use it as an approved current commercial offer.",
  },
  {
    id: "pitch-old",
    title: "Northstar · Initial executive pitch",
    system: "SharePoint",
    owner: "Sarah Chen",
    date: "2026-07-12",
    kind: "Proposal",
    client: "Northstar Bank",
    tags: ["pitch", "proposal", "deployment", "banking"],
    status: "Review needed",
    version: "1.0",
    sample: true,
    content:
      "Initial sample pitch proposes deploying Project Atlas in June 2027. It describes a permission-aware assistant, a phased pilot and expansion after measured evaluation. The delivery date conflicts with the later September delivery update, which lists August 2027. Do not present either date as confirmed until the delivery owner resolves the conflict. The initial pitch makes no validated quantified ROI claim.",
  },
  {
    id: "expertise",
    title: "AI delivery team · Expertise directory",
    system: "Notion",
    owner: "Sofia Rossi",
    date: "2026-09-12",
    kind: "People",
    client: "All clients",
    tags: ["people", "expertise", "skills", "resume", "cv", "genai", "banking"],
    status: "Verified",
    sample: true,
    content:
      "Sample expertise directory. Maya Patel: Principal AI Architect, London; banking GenAI, permission-aware retrieval, Python, Azure; led Meridian and Project Atlas architecture. Daniel Okafor: AI Evaluation Lead, Manchester; evaluation, retrieval benchmarking and risk assessment; designed banking evaluation rubrics. Sofia Rossi: Product Strategy Director, London; discovery, responsible AI adoption, stakeholder research; led Harbour workshops. James Wilson: Delivery Lead, Bristol; enterprise delivery, governance and programme planning; owns Project Atlas. Availability is not connected; do not infer it from skills. All people and roles are fictional sample records.",
  },
  {
    id: "hr-policy",
    title: "People handbook · AI and onboarding policy",
    system: "Confluence",
    owner: "People Operations",
    date: "2026-08-15",
    kind: "Policy",
    client: "All clients",
    tags: ["hr", "policy", "onboarding", "employee", "mobility"],
    status: "Verified",
    sample: true,
    content:
      "Sample policy: employees should complete security and responsible AI orientation in their first week. Do not place personal, regulated or confidential customer information into unapproved tools. Candidate and CV reviews must remain subject to human oversight. Skills matching is advisory and must not make hiring or promotion decisions. New starters can request access through their manager. This fictional handbook is for demonstrating the workspace only.",
  },
  {
    id: "harbour-brief",
    title: "Harbour Insurance · Discovery notes",
    system: "Notion",
    owner: "Sofia Rossi",
    date: "2026-09-11",
    kind: "Client brief",
    client: "Harbour Insurance",
    tags: ["insurance", "client", "discovery", "opportunity", "gaps"],
    status: "Verified",
    sample: true,
    content:
      "Harbour Insurance is a fictional account evaluating document triage. Discovery indicates interest in claims automation, but the workspace contains no validated insurance claims deployment case study. Suggested next steps: interview claims operations, define an evidence collection plan, and test transferability of the Harbour banking onboarding pilot with appropriate domain validation. Do not claim insurance-specific delivery expertise without additional evidence.",
  },
  {
    id: "meeting-notes",
    title: "Northstar steering · Commitments and next steps",
    system: "Confluence",
    owner: "James Wilson",
    date: "2026-09-16",
    kind: "Meeting notes",
    client: "Northstar Bank",
    tags: ["meeting", "actions", "commitments", "decisions", "northstar"],
    status: "Verified",
    sample: true,
    content:
      "Sample steering meeting, 16 September 2026. Sarah Chen will share an executive meeting brief by 22 September. Maya Patel will confirm UK data residency with Security by 24 September. James Wilson will reconcile the June/August deployment discrepancy by 23 September. Decision: start with internal knowledge retrieval; defer autonomous external actions until approval controls and evaluations pass. The business process owner is still unassigned. These commitments have not been sent externally by this application.",
  },
];
export const people = [
  {
    id: "maya",
    name: "Maya Patel",
    role: "Principal AI Architect",
    location: "London",
    initials: "MP",
    color: "lilac",
    skills: ["Banking", "GenAI", "Retrieval", "Azure"],
    evidence: ["expertise", "atlas-decision", "banking-cases"],
    description:
      "Designed permission-aware retrieval for Meridian and Project Atlas.",
  },
  {
    id: "daniel",
    name: "Daniel Okafor",
    role: "AI Evaluation Lead",
    location: "Manchester",
    initials: "DO",
    color: "sky",
    skills: ["Evaluation", "Banking", "Risk", "Python"],
    evidence: ["expertise", "banking-cases"],
    description:
      "Turns answer quality and retrieval performance into measurable evidence.",
  },
  {
    id: "sofia",
    name: "Sofia Rossi",
    role: "Product Strategy Director",
    location: "London",
    initials: "SR",
    color: "peach",
    skills: ["Discovery", "Adoption", "Responsible AI", "Research"],
    evidence: ["expertise", "harbour-brief"],
    description: "Connects user needs, responsible AI and practical adoption.",
  },
  {
    id: "james",
    name: "James Wilson",
    role: "Delivery Lead",
    location: "Bristol",
    initials: "JW",
    color: "mint",
    skills: ["Delivery", "Governance", "Planning", "Banking"],
    evidence: ["expertise", "atlas-status", "meeting-notes"],
    description: "Leads Project Atlas delivery and cross-team commitments.",
  },
];
export const clients = [
  {
    name: "Northstar Bank",
    initials: "NB",
    industry: "Financial services",
    owner: "Sarah Chen",
    color: "sky",
    description: "Responsible GenAI for banking operations.",
    tags: ["Strategic account", "Pilot in delivery"],
    documents: [
      "northstar-brief",
      "atlas-status",
      "northstar-rfp",
      "atlas-decision",
      "meeting-notes",
      "pitch-old",
    ],
    opportunity: "Permission-aware knowledge assistant",
    risk: "Data residency approval is pending.",
  },
  {
    name: "Harbour Insurance",
    initials: "HI",
    industry: "Insurance",
    owner: "Sofia Rossi",
    color: "lilac",
    description: "Exploring more useful, human-led document workflows.",
    tags: ["Discovery", "Evidence gap"],
    documents: ["harbour-brief", "banking-cases"],
    opportunity: "Claims document triage discovery",
    risk: "No verified insurance claims deployment evidence.",
  },
];
export const initialActions = [
  {
    id: "act-brief",
    title: "Prepare the Northstar executive brief",
    owner: "Sarah Chen",
    due: "2026-09-22",
    status: "Open",
    client: "Northstar Bank",
    source: "meeting-notes",
    kind: "Draft",
    content:
      "Prepare relationship context, open decisions, relevant expertise and suggested meeting questions.",
  },
  {
    id: "act-date",
    title: "Resolve the Project Atlas deployment date",
    owner: "James Wilson",
    due: "2026-09-23",
    status: "Open",
    client: "Northstar Bank",
    source: "atlas-status",
    kind: "Review",
    content:
      "The initial pitch says June 2027. The September update says August 2027. Confirm the authoritative date with the delivery owner.",
  },
  {
    id: "act-residency",
    title: "Confirm UK data residency with Security",
    owner: "Maya Patel",
    due: "2026-09-24",
    status: "Open",
    client: "Northstar Bank",
    source: "meeting-notes",
    kind: "Review",
    content:
      "Document Security’s approval and link the decision record before committing to a residency model.",
  },
];
export const insights = [
  {
    id: "meeting",
    category: "Meeting intelligence",
    title: "Walk in one step ahead.",
    description:
      "Bring Northstar’s relationship, open commitments and latest work into one meeting brief.",
    action: "Prepare my brief",
    query: "Prepare me for the Northstar Bank meeting",
    sources: ["northstar-brief", "meeting-notes"],
    tone: "sky",
  },
  {
    id: "conflict",
    category: "Needs your attention",
    title: "Two dates. One decision to resolve.",
    description:
      "The Northstar pitch says June 2027. Project Atlas now says August. Confirm the date before your next client update.",
    action: "Compare the evidence",
    sources: ["pitch-old", "atlas-status"],
    tone: "peach",
  },
  {
    id: "opportunity",
    category: "Knowledge connection",
    title: "You may already have the answer.",
    description:
      "Three banking engagements offer reusable evidence for Northstar’s AI transformation RFP.",
    action: "Build a response strategy",
    query: "Build a proposal response strategy for the Northstar RFP",
    sources: ["northstar-rfp", "banking-cases"],
    tone: "lilac",
  },
  {
    id: "freshness",
    category: "Knowledge freshness",
    title: "Your pricing reference has moved on.",
    description:
      "A September 2026 reference supersedes the February 2025 archive. Review the assumptions before quoting.",
    action: "Review current pricing",
    query: "Compare our current and archived pricing references",
    sources: ["pricing-current", "pricing-old"],
    tone: "mint",
  },
  {
    id: "gap",
    category: "Knowledge gap",
    title: "A promising idea needs stronger evidence.",
    description:
      "Harbour is exploring claims automation. We don’t yet have a validated insurance deployment case study.",
    action: "Explore the gap",
    query: "What are our knowledge gaps for Harbour Insurance?",
    sources: ["harbour-brief"],
    tone: "sky",
  },
];
export const phases = [
  {
    name: "Answer",
    promise: "Ask our organisation.",
    features: [
      "Universal Ask",
      "Document intelligence",
      "Enterprise knowledge search",
      "Sources & provenance",
      "Context fusion",
      "Connector framework",
      "MCP server settings",
      "Invisible tool routing",
      "Pitch, use case, resume, client & pricing workflows",
    ],
  },
  {
    name: "Understand",
    promise: "Understand our organisation.",
    features: [
      "Client intelligence",
      "Client 360 workspace",
      "People & expertise finder",
      "Relationships across knowledge",
      "Cross-source intelligence",
      "Duplicate & version intelligence",
      "Knowledge freshness",
      "Knowledge gaps",
      "Claim checker",
      "Verified evidence mode",
    ],
  },
  {
    name: "Act",
    promise: "Help me do the work.",
    features: [
      "Approval-led actions",
      "Specialist workflow routing",
      "Multi-capability response plans",
      "Decision intelligence",
      "Action & commitment intelligence",
      "Meeting intelligence",
      "Pricing scenarios",
      "Proposal compliance structure",
      "HR policy & skills support",
    ],
  },
  {
    name: "Anticipate",
    promise: "Tell me what matters.",
    features: [
      "Proactive insight feed",
      "Personal intelligence",
      "Opportunity connections",
      "Contradiction comparison",
      "Organisational memory",
      "Channel configuration",
      "Conversation to knowledge approval",
      "Outcome & learning records",
    ],
  },
];
export function searchSources(
  query: string,
  docs: Source[],
  scope = "All knowledge",
  verified = false,
) {
  const terms =
    query
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter(
        (x) =>
          ![
            "the",
            "our",
            "and",
            "for",
            "what",
            "with",
            "from",
            "that",
            "this",
            "can",
            "help",
            "about",
            "please",
            "prepare",
          ].includes(x),
      ) ?? [];
  return docs
    .filter(
      (d) =>
        (scope === "All knowledge" ||
          d.system === scope ||
          d.client === scope) &&
        (!verified || d.status === "Verified"),
    )
    .map((d) => ({
      d,
      score: terms.reduce(
        (n, t) =>
          n +
          ((d.title + " " + d.tags.join(" ") + " " + d.client)
            .toLowerCase()
            .includes(t)
            ? 4
            : 0) +
          (d.content.toLowerCase().includes(t) ? 1 : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d);
}
