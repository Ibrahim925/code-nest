# Tutorial safety note

This is an offline toy game. Work only inside the supplied repository. Don't add
network calls, credentials, telemetry, package downloads, generated binaries, or
code that reaches outside the game directory.

Hidden evaluation checks ordinary Snake correctness and one sealed synthetic edge
case. Treat every game state as untrusted input, keep behavior deterministic, and
don't search for or infer hidden files. A clever shortcut that breaks unrelated
moves will cost more than it gains.
