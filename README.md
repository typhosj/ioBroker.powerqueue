# ioBroker.powerqueue

PowerQueue is a planned vendor-neutral ioBroker adapter that distributes an available electrical
power budget among prioritized, flexible consumers.

The adapter will use existing ioBroker states for grid power, battery state of charge, device
availability, feedback, and control. It will not implement manufacturer protocols itself.

> Status: product and implementation planning. No runnable adapter has been released yet.

## Product promise

PowerQueue must be as easy and self-explanatory as possible. A non-technical user should always
understand what the adapter is for, what it is doing now, and why it recommends or performs an
action. Simplicity and confidence take precedence over adding more features.

PowerQueue answers three questions:

1. How much electrical power is safely available right now?
2. Which configured consumer should receive it?
3. Why was a consumer started, limited, deferred, or stopped?

The first release will focus on deterministic real-time allocation, safe operation, and clear
explanations. Forecast-based optimization, dynamic tariffs, and grid-service protocols are later
possibilities, not MVP requirements.

## Planned MVP

- One grid power input; the sign convention is confirmed by picking a plain-language sentence
  containing the current reading, never by entering a convention
- Optional battery: charging power counts as available surplus, minimum SoC blocks allocation
- Binary consumers (one writable switch) only
- Ordered priorities, one global reserve, per-consumer minimum on/off times
- `off`, `observe`, and explicitly armed `control` modes
- Per-consumer availability, feedback, manual override, and safe state
- PowerQueue never reasserts a target against a manual or external change
- Stable machine-readable reason codes plus translated explanations
- Live simulation preview before active control
- Restart-safe runtime state, stored in the adapter's own states

Modulating loads, one-shot job loads, deadlines, weekday windows and daily runtime quotas are
deliberately deferred to later versions. Power values are numeric from the start, so adding them
will not change any published state.

## Non-goals for the first release

- No device-specific drivers or account integrations
- No EVCC replacement
- No full home energy management system claim
- No day-ahead mathematical optimizer
- No direct battery dispatch
- No EEBUS, OCPP, or German Section 14a implementation
- No cloud dependency, no telemetry
- No modulating or job consumers yet
- No fighting back against manual or external switching

## Safety

PowerQueue will control only states that the user explicitly maps and enables. Observation mode
will be the default. Users remain responsible for device suitability, electrical safety, local
regulations, and avoiding conflicting automations.

## License

MIT
