# Emergency rules

Own `src/emergency.js`. Add the small set of documented emergency overrides while
preserving ordinary denials outside an emergency. Every override needs a distinct
reason so the audit trail can explain why the base policy changed.

Avoid a blanket emergency bypass. The public case asks for an engineer to stabilize
Reactor Control; other roles and zones still need deliberate treatment.
