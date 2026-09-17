# Delegated credentials

Own `src/delegation.js`. Validate delegated roles, issuer authority, and expiry at
the request timestamp, then return the effective role and the credential path used
for the decision. Bad, expired, or self-issued credentials should fail closed.

Leave the zone policy in `src/policy.js`. Your module decides whether a credential
is usable and what role it carries, not whether that role may enter Reactor
Control.
