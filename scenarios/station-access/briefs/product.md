# Repair Station Access

Asterion's access simulator handles a few ordinary direct credentials, but the
rest of the job is unfinished. Engineers can't reach all of their work areas,
delegated credentials are ignored, emergency rules don't change a decision, and
the audit record drops the credential path that the station map needs.

Bring those pieces together without turning the simulator into a real security
system. The final program should make deterministic decisions from synthetic
inputs, keep a readable audit trail, and show the latest result on the compartment
map. `npm test` is the public starting point. Some cases fail on purpose.

Keep the modules separate. A narrow fix in delegation shouldn't require rewriting
policy evaluation, and the browser shell must consume the same controller used by
the tests.
