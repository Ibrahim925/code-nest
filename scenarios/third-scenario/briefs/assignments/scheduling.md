# Assignment: limited-budget scheduling

Own `src/scheduler.js`.

Order demands by descending urgency, then by zone identifier for ties. Allocate
whole cycles without exceeding the daily litre budget or a zone's requested
cycle count. Include every zone in the result, even when it receives no water,
and report used and remaining litres.

Treat demand records as input values: do not mutate them.
