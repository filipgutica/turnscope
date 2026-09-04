# Turnscope Product and Experience Specification

**Status:** Awaiting concept approval

**Scope:** First useful local agent-tool observability release

**Primary user:** An individual developer reviewing their own local agent activity

## Context

Turnscope imports local agent-session data and can normalize sessions, events, tool activity, source provenance, and partial coverage. The current interface exposes too much of that measurement machinery at once. It presents several equally weighted pages, metric groups, caveats, and diagnostic concepts without first answering a useful product question.

The available data is also uneven. Tool status is known for only part of the imported activity, tool timing and session outcomes may be unavailable, and some raw tool records cannot yet be mapped to a useful semantic category. The interface must not turn those gaps into zeros, quality judgments, or false confidence.

This document is the product and interaction source of truth for the redesign. The README remains the technical setup and architecture guide.

## Product promise

> Turnscope shows which agent tools I use, where they encounter observable friction, and which sessions I should inspect.

Turnscope is an evidence browser, not an agent scorecard. It reports what the imported source directly supports, derives transparent aggregates from those facts, and exposes the source evidence behind actionable findings.

## Goal

Within ten seconds of opening Turnscope, a user must be able to:

1. Identify the most-used normalized tool categories for the selected range.
2. See directly reported failures, rejections, and cancellations.
3. Identify the sessions affected by those observations.
4. Open representative source evidence in one action.
5. Understand whether incomplete data limits the result.

The primary workflow is:

`choose range → scan tool use → inspect observed friction → open session evidence`

## Non-goals

This release does not:

- Measure active agent time, productivity, task quality, or prompt effectiveness.
- Sum session spans or present session span as active work.
- Treat a correction candidate, repeated command, long session, or missing result as an automatic quality judgment.
- Add an LLM judge, prompt rewriting, causal claims, or skill-effectiveness claims.
- Add a Claude Code adapter, cloud storage, accounts, team reporting, or telemetry upload.
- Add charts that repeat values without improving comparison or diagnosis.
- Make Patterns or data diagnostics a peer of the primary activity workflow.

## Product language

The interface uses these terms consistently:

| Term | Meaning |
| --- | --- |
| **Observed issue** | A tool invocation whose source explicitly reports failure, permission rejection, or cancellation. |
| **Invocation** | The smallest defensible normalized tool operation, paired by a stable source identifier when available. |
| **Reliability** | Successful invocations divided by invocations with a known status. |
| **Status coverage** | Invocations with a known status divided by all normalized invocations. |
| **Affected session** | A session containing at least one invocation represented by the aggregate or finding. |
| **Repeat** | A defensible repeated invocation signature. It is not called a retry unless the source explicitly identifies it as one. |
| **Unclassified** | An invocation that is preserved but cannot yet be mapped to a stable semantic category without guessing. |
| **Unknown** | The source did not provide enough evidence to determine a value. Unknown is never rendered as zero. |

The interface must not use “needs attention,” “mistake,” “bad session,” or similar judgmental language for heuristic findings. Directly reported failures, rejections, and cancellations may be described as observed friction.

## Information architecture

The primary navigation has two destinations:

1. **Activity** — the default experience, combining the useful parts of the current Overview and Tool Health pages.
2. **Settings** — imports, data sources, adapter and product versions, themes, compatibility warnings, and advanced diagnostics.

Session and tool-category details are drill-down destinations, not top-level navigation items.

Patterns and correction candidates move under an explicitly labeled **Diagnostics** area in Settings. They are not shown on Activity and must retain diagnostic or experimental labeling.

Existing Overview and Tool Health routes must redirect to Activity so existing local bookmarks do not become dead ends.

## Activity requirements

### Page structure

Activity contains one page heading and, in order:

1. A shared time-range control.
2. An observed-friction list.
3. A compact tool-usage table.
4. A short recent-sessions list below the primary analysis.
5. One compact data-coverage disclosure shared by the page.

There are no metric-card grids on Activity. The first desktop viewport must contain no more than two visually dominant analysis regions: observed friction and tool usage.

Explanatory copy is progressive disclosure. Each section may have at most one short supporting sentence in its default state. Definitions, methodology, and detailed limitations live in accessible help text or the coverage disclosure rather than being repeated beside every value.

### Time range

- Choices are **7 days**, **30 days**, and **All time**.
- The default is **30 days**.
- Activity aggregates, friction findings, recent sessions, and drill-down entry points use the same active range.
- A bounded range includes records at the exact lower boundary and excludes records after the captured upper boundary.
- The upper boundary is captured once per analytics request so all aggregates in that response describe the same interval.
- The active range remains visible while reviewing the Activity aggregates.
- The control is keyboard accessible, has a visible focus state, and provides an accessible selected-state announcement.

### Observed friction

The observed-friction list is the page’s single point of emphasis.

- Show at most three items in the default view, ordered by most recent supporting event.
- An item appears only for a source-reported failure, permission rejection, or cancellation.
- Each item shows the normalized tool category, the reported status in text, the affected session, the event time, and why it appears.
- Each item has one action that opens the affected session at the supporting event.
- Direct observations remain visible when overall status coverage is low. Low coverage limits general conclusions; it does not erase known evidence.
- Do not infer that a session needs attention from duration, repeats, correction wording, or missing data.
- If there are no observed issues, say: “No failures, rejections, or cancellations were reported in {known status numerator} of {invocation denominator} invocations.” Do not claim that all activity succeeded.
- If the source evidence cannot be linked to a session and event, the item must not appear as actionable friction.

### Tool usage

The default desktop table has no more than five columns:

1. Tool category
2. Invocations
3. Affected sessions
4. Reported issues
5. Reliability among known statuses

Additional details belong in the tool-category drill-down.

- Default sorting is invocations descending.
- Counts use normalized unique invocations, not raw event rows.
- Reliability includes its numerator and denominator wherever the rate is displayed.
- Reported issues separate failed, rejected, and cancelled counts in accessible detail; the compact cell may show their combined total.
- Zero is shown only when the field is known and the observed count is zero.
- Unknown values render as an em dash with an accessible “Not reported by source” label.
- Unsupported timing, outcome, permission, or repeat metrics are omitted rather than added as empty columns.
- **Unclassified** activity is included in coverage totals but is not ranked as a meaningful tool category. It appears as a subdued disclosure row with a path to its raw names and source evidence.
- Selecting a row opens the tool-category detail for the active range.
- The primary table must not require horizontal scrolling at a 390-pixel viewport. At narrow widths it becomes a compact two-line row layout and moves secondary values into the drill-down.

### Recent sessions

- Show at most five sessions, ordered by most recent imported event.
- Each row shows a concise session label, project when known, latest event time, and any directly observed issue count.
- Session span, token totals, and heuristic correction labels are not shown in this list.
- Selecting a session opens its evidence timeline.
- A link exposes the full session list without expanding the primary Activity page.

### Coverage disclosure

Activity displays one subdued summary near the aggregates, for example:

> Status known for 25,012 of 61,309 invocations (40.8%). Timing and outcomes unavailable. Details

The actual values come from the selected range. The disclosure:

- Shows numerator and denominator for every displayed coverage rate.
- Names unavailable fields and the feature each absence limits.
- Opens detailed data health without duplicating the full panel on Activity.
- Is the only persistent caveat block on the page.
- Does not hide direct observed evidence when aggregate coverage is incomplete.

## Tool-category detail requirements

A tool-category drill-down shows:

- Normalized category and the raw provider tool names included in it.
- Unique invocations and affected sessions.
- Known-status numerator and invocation denominator.
- Successful, failed, rejected, and cancelled invocation counts when reported.
- Reliability among known statuses, including numerator and denominator.
- Repeat count only when a comparable signature can be derived without guessing; otherwise the metric is omitted.
- Median and P90 execution time only when timing is reported, with timing coverage numerator and denominator.
- Representative evidence ordered by recency, with raw tool name, source status, session, timestamp, and a link to the exact event.

The page must preserve provider provenance without exposing provider-specific keys as its application contract.

## Session detail requirements

- Preserve the session event timeline and direct event anchors.
- Show normalized tool status alongside raw provenance when present.
- Opening evidence from Activity or a tool detail lands on and visibly identifies the supporting event.
- Filters and drill-down controls remain keyboard accessible.
- Correction candidates, instruction classification, and other heuristics appear only in a collapsed diagnostic area.
- Injected instructions, plugin catalogs, and host metadata are never classified as user corrections.

## Settings and data-health requirements

Settings owns import, data-source, appearance, and diagnostic controls. It includes:

- Import action, progress, last successful import, and recoverable error state.
- Imported-session count.
- Source product and adapter versions.
- Token-usage coverage with numerator and denominator.
- Tool-status coverage with numerator and denominator.
- Tool-timing coverage with numerator and denominator.
- Sessions with known outcomes with numerator and denominator.
- Active compatibility warnings.
- Light, Dark, System, built-in themes, and imported VS Code themes.
- An Advanced Diagnostics entry containing detailed data health and Patterns.

Each missing-data explanation names what is absent and which feature it prevents. The full data-health surface is not repeated on Activity or tool detail pages.

## Data and analytics requirements

### Normalized hierarchy

Where the source supports it, normalization follows:

`session → turn or prompt → model request or tool invocation → result → outcome`

Every normalized field retains source provenance and a coverage state.

### Tool invocation integrity

- Investigate and use provider invocation identifiers and explicit result relationships before pairing records.
- Do not merge raw records by timestamp, display label, or adjacency alone.
- Multiple phases of one invocation must not inflate invocation counts.
- Duplicate raw records for the same invocation and phase must not inflate counts.
- Provider aliases map to stable semantic categories only when the mapping is supported by source evidence.
- Raw names remain available in evidence and diagnostics.
- Provider-specific keys remain inside adapters; analytics and Vue components consume provider-neutral contracts.

### Observed, derived, and inferred values

- Observed values come directly from imported source records.
- Derived values use a documented deterministic calculation over observed values.
- Inferred values are labeled as diagnostic and never drive a primary finding.
- Every aggregate has an active date range, a denominator where applicable, and a coverage value.
- Missing fields remain `null` or an equivalent unknown state through storage, analytics, contracts, and rendering.

### Percentiles and session span

Session span is the interval between the first and last imported event in one session. It is not active agent time and is never summed across sessions.

Session-span median and P90 may remain available in Advanced Diagnostics when timestamps support them. They do not appear on Activity, in the primary navigation, or as evidence that a session has a problem.

### Correction diagnostics

Correction candidates remain diagnostic only. Classification scans only authored user-message content. It excludes injected instruction payloads, `AGENTS.md` content, plugin catalogs, environment context, host metadata, and other attached system material.

## Empty, partial, and incompatible states

### First run

Show one primary action to import local sessions and one sentence explaining that data remains local. Do not render empty metric scaffolding.

### Empty range

State that no imported activity falls in the selected range and offer the adjacent broader range. Do not show zeros for aggregates whose denominator is empty.

### Partial coverage

Show trustworthy results, omit unsupported metrics, and display the single coverage disclosure. Do not replace the page with a warning wall.

### Incompatible source

Preserve any trustworthy imported data. Put the compatibility warning and recovery action in Settings. If no reliable primary result can be computed, Activity explains the unavailable result and links directly to the relevant warning.

### Import failure

Keep the last successful data visible, identify its freshness, and offer retry from Settings. Never discard known-good imported data merely because a later import failed.

## Visual and interaction requirements

- Use open sections and dividers for the primary hierarchy; do not place every value in a card.
- Use one deliberate emphasis treatment for observed friction. Color is supplementary; every status also has text or an icon with an accessible label.
- Keep headings compact and proportional to a desktop utility application.
- Apply consistent padding to headings, descriptions, controls, empty states, and panel bodies.
- Prevent grid rows from stretching across unused vertical space.
- Use compact definition rows when a full card adds no hierarchy.
- Maintain high-contrast semantic borders in Light, Dark, System, built-in, and imported themes.
- Interactive targets are at least 44 by 44 CSS pixels where space permits and always provide a visible keyboard focus indicator.
- Package-owned `@filipgutica/ui` primitives own common control behavior and accessibility. Turnscope owns analytics-specific tables, evidence timelines, and data semantics.
- Use Vue 3 Composition API and `<script setup lang="ts">`. Use Tailwind for reusable layout and semantic CSS variables for runtime colors.

## Component changes and ownership

| Area | Required outcome | Contract owner | Dependency | Verification |
| --- | --- | --- | --- | --- |
| Activity experience | Replace competing Overview and Tool Health summaries with the bounded primary workflow in this spec. | Turnscope web application | Range-aware normalized aggregates and evidence links | Rendering, keyboard, empty/partial-state, desktop, and narrow-width tests |
| Tool analytics | Supply compact category summaries without raw-row inflation or false zeros. | Analytics and shared normalized contracts | Adapter invocation identity and alias evidence | Pairing, alias, duplicate, status-coverage, and unknown-value tests |
| Tool detail | Explain one category and expose representative evidence without provider leakage. | Turnscope web application and shared contracts | Tool summary plus event provenance | Drill-down, evidence-anchor, partial timing, and alias rendering tests |
| Session evidence | Land on the supporting event and preserve normalized plus raw provenance. | Session analytics and web application | Stable session and event identifiers | Evidence-link and keyboard-navigation tests |
| Data sources and diagnostics | Centralize import, compatibility, data health, themes, and heuristics outside the primary workflow. | Settings and importer surfaces | Import metadata and coverage contracts | Import, warning, theme, empty, and incompatible-source tests |
| Shared UI primitives | Provide accessible controls and disclosure primitives without owning Turnscope analytics semantics. | `@filipgutica/ui` | Stable package exports and semantic theme tokens | Package typecheck plus Turnscope consumer tests |

## Release gates

Implementation is not ready to merge until all of these gates pass:

1. **Concept approval:** A single sparse Activity-screen concept demonstrates the hierarchy in this spec at desktop and narrow widths and is approved before UI implementation.
2. **Normalization usefulness:** The ranked tool list cannot ship while **Unclassified** represents more than 25% of normalized invocations in the representative local data set. Mappings must be supported by raw source evidence; the threshold must not be met by relabeling unknown records as a guessed category.
3. **Evidence integrity:** Every observed-friction item opens the exact supporting session event.
4. **Coverage integrity:** Every displayed rate includes its numerator and denominator, and unknown values remain unknown end to end.
5. **Primary-screen restraint:** Activity has no metric-card grid, no repeated data-health panel, no session-span metric, and no correction metric.
6. **Responsive usability:** The Activity workflow works without primary-table horizontal scrolling at 390 pixels and preserves keyboard focus and non-color status signals.
7. **Regression safety:** Theme import, Open VSX search, Settings, built-in themes, and existing import behavior continue to work.

## Verification

Automated verification must include:

- Session-span median and P90 calculations, outliers, and missing timestamps.
- Exact time-range boundary behavior.
- Exclusion of injected instructions, plugin catalogs, and metadata from correction classification.
- Tool-invocation pairing, alias normalization, and duplicate raw-event handling.
- Partial status and timing coverage.
- Unknown versus known-zero behavior through analytics and rendering.
- Observed-friction inclusion rules and exact evidence links.
- Activity, tool-detail, session-detail, Settings, and diagnostic rendering.
- First-run, empty-range, partial-coverage, and incompatible-source states.
- Keyboard-accessible range, table-row, disclosure, and evidence controls.

The release verification commands are:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:electron
```

Runtime verification must cover:

- Activity at 7 days, 30 days, and All time.
- Default tool sorting and the Unclassified disclosure.
- Observed-friction evidence drill-down.
- One centralized coverage disclosure and detailed Settings data health.
- Desktop and 390-pixel layouts.
- Light, Dark, System, a built-in theme, and an imported VS Code theme.
- Open VSX search and theme import.

A short comprehension check must confirm that a user can answer these questions from the initial Activity view without opening Settings:

1. Which tool categories did I use most?
2. What directly reported friction occurred, and in which session?
3. How complete is the status evidence behind this view?

## Rollout and migration

- Reuse the existing local database where the normalized contract remains sufficient; add only cohesive schema changes required for evidence identity or provenance.
- Redirect retired Overview and Tool Health routes to Activity.
- Preserve source data, local databases, imported sessions, build output, and Electron state outside Git.
- Do not implement the Claude Code adapter in this release. Keep normalized contracts compatible with a future adapter based primarily on Claude Code’s documented OpenTelemetry events; treat transcript JSONL as version-specific.
- Record important runtime observations and any known coverage limits in the draft pull-request description.

## Risks, assumptions, and open questions

- **Current category usefulness:** A large Unclassified share would prevent the product from answering its primary question. Raw-name sampling and evidence-backed alias mapping are required before implementation acceptance.
- **Status interpretation:** Provider sources may distinguish result, permission, and cancellation phases differently. The adapter must preserve those distinctions instead of forcing every source into a single success flag.
- **Sparse evidence:** Direct observed issues can be useful under partial coverage, but absence of an issue cannot be presented as evidence of success beyond the known-status denominator.
- **Outcome limits:** No outcome comparison appears until the source provides a defensible outcome contract and enough coverage to support it.
- **Implementation gate:** UI implementation remains blocked on approval of the sparse desktop and narrow-width concept derived from this specification.
