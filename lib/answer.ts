import { sources, searchSources, type Source } from "./knowledge";
export type Answer = {
  text: string;
  sourceIds: string[];
  mode: string;
  title: string;
  followups: string[];
};
export function localAnswer(
  query: string,
  docs: Source[],
  scope: string,
  verified: boolean,
): Answer {
  const q = query.toLowerCase();
  const matches = searchSources(query, docs, scope, verified).slice(0, 6);
  const selected = (ids: string[]) =>
    ids
      .map((id) => docs.find((d) => d.id === id))
      .filter(
        (d): d is Source =>
          !!d &&
          (scope === "All knowledge" ||
            d.system === scope ||
            d.client === scope) &&
          (!verified || d.status === "Verified"),
      );
  let refs = matches;
  let text = "";
  let title = query.slice(0, 80);
  const excerpt = (d: Source) => `### ${d.title}\n${d.content}\n[${d.id}]`;
  const sample = docs.every((d) => d.sample);
  if (
    /meeting|prepare me|executive brief/.test(q) &&
    /northstar|bank/.test(q)
  ) {
    refs = selected([
      "northstar-brief",
      "atlas-status",
      "meeting-notes",
      "banking-cases",
      "atlas-decision",
    ]);
    text = `## Northstar Bank · Meeting brief\n\n### The conversation to have\nConfirm the pilot’s success criteria, security owners and the decision required to move forward. Treat dates and commercial figures as provisional until the relevant owners approve them.\n\n${refs.map(excerpt).join("\n\n")}\n\n### Questions to take into the room\n• Who owns the business process and pilot success measures?\n• What evidence is needed for data-residency approval?\n• Which deployment date can the delivery owner confirm?\n• Who will review the pilot’s evaluation results?`;
    title = "Northstar Bank · Executive meeting brief";
  } else if (/proposal|rfp|pitch/.test(q)) {
    refs = matches.length
      ? matches
      : selected([
          "northstar-rfp",
          "banking-cases",
          "expertise",
          "pricing-current",
        ]);
    text = `## ${/pitch/.test(q) ? "Executive pitch" : "Proposal response strategy"}\n\n### Working draft\nUse the requirements and evidence below as a starting point. Confirm scope, commercial assumptions and source permissions before sharing.\n\n${refs.map(excerpt).join("\n\n")}\n\n### Suggested response structure\n1. Executive summary and business context\n2. Requirements and compliance matrix\n3. Proposed architecture and permission model\n4. Delivery plan and acceptance criteria\n5. Relevant case studies and team\n6. Pricing assumptions and exclusions\n7. Evidence gaps, dependencies and approvals\n\n### Review before submission\nSeparate delivered outcomes from pilot ambitions. Resolve conflicting dates. Obtain Security and Commercial approval where applicable.`;
    title = /pitch/.test(q)
      ? "Executive pitch · Working draft"
      : "RFP response strategy";
  } else if (/resume|\bcv\b/.test(q)) {
    refs = selected(["expertise", "banking-cases"]);
    text = `## Evidence-based profile draft\n\n${refs.map(excerpt).join("\n\n")}\n\n### Profile structure\n• Name and current role\n• Relevant capabilities from the directory\n• Evidence-linked project contributions\n• Delivery responsibilities\n\nQualifications, employment dates and availability are not recorded here. Add them only after verification. No hiring or promotion recommendation is made.`;
    title = "Team profile · Evidence draft";
  } else if (matches.length) {
    text = `## ${/pricing/.test(q) ? "Pricing evidence and assumptions" : /decision|architecture/.test(q) ? "Decision trail" : /people|expertise|experience|skills/.test(q) ? "Relevant expertise" : /gap/.test(q) ? "What the evidence does—and doesn’t—cover" : "What your knowledge says"}\n\n${matches.map(excerpt).join("\n\n")}\n\n### Next step\n${/pricing/.test(q) ? "Use the Pricing workspace to compare scenarios. Estimates are planning assumptions; an approved commercial offer requires review." : /gap/.test(q) ? "Confirm the missing evidence with the source owner before reusing a claim." : "Review the linked sources and their dates before using this material externally."}`;
  } else {
    text =
      "## No matching evidence found\n\nI couldn’t find a relevant source in the selected knowledge scope. Try a client, project or capability name, broaden the scope, or upload a document. I won’t invent an organisational answer without evidence.";
  }
  return {
    text,
    sourceIds: refs.map((d) => d.id),
    mode: "Evidence extracts · AI gateway not connected",
    title,
    followups: [
      "Find the supporting evidence",
      "Identify risks and knowledge gaps",
      "Prepare a meeting brief",
    ],
  };
}
