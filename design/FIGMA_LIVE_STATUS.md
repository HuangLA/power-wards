# Figma live design build

File: https://www.figma.com/design/DotpmkBbAn2IrGkxg0wqfG

State: blocked by the Figma MCP Starter plan tool-call quota. The file is real; screens and reusable components are not yet complete. This is not the final design delivery.

Source of truth: REQUIREMENTS.md; existing design/tokens.json and approved concept image. No application implementation changes.

Discovery: empty file (page 0:1), no local variables or Code Connect files; Noto Sans SC Regular/Medium/Bold confirmed available. Generic subscribed kits use different component/token models; build custom PW components to preserve approved visual direction and domain semantics. Local tokens are design tokens, not production CSS contracts. WEB variable syntax uses proposed --pw-* names.

Scope: dark mode only; primitive+semantic colors, spacing/radius variables, five text sizes and overlay shadow; Button, Category, Tag, Profile and WardMarker sets; five screens and agent handoff. No business rule changes, no accounts/cloud sync, no application code.

## Persisted results

- `00 / Foundations & Components` — page `0:1`; foundation frame `4:6`.
- `01 / Screens` — page `4:4`, currently empty.
- `02 / Agent Handoff` — page `4:5`, currently empty.
- 3 collections: 14 raw colors, 14 aliased semantic colors, 12 dimension variables; total 40 variables with explicit scopes and WEB syntax.
- Noto Sans SC confirmed and loaded. Text styles: PW/Caption, PW/Body, PW/Section, PW/Title, PW/Brand. Effect style: PW/Overlay.
- Foundations frame has native editable text and bound color swatches. Actual Figma screenshot was returned and inspected. It is not a five-screen layout validation.

The Starter page limit was handled by grouping planned content into three pages without dropping scope. A later request returned `You've reached the Figma MCP tool call limit on the Starter plan`. Authentication was rechecked successfully; a read-only `use_figma` check returned the same quota error. Work stopped rather than bypassing the limit.

## Resume

Restore sufficient Figma MCP quota/access for this team, then continue in this SAME file. Do not create another file. Read local state JSON files and re-inspect actual nodes first. Foundations screenshot exists; components, five states, real map upload, bindings audit and final screenshots remain. No request to install the local development plugin is needed.

Foundation link: https://www.figma.com/design/DotpmkBbAn2IrGkxg0wqfG?node-id=4-6
