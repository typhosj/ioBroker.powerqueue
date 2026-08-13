# ioBroker.powerqueue

PowerQueue is a planned vendor-neutral ioBroker adapter that distributes an available electrical
power budget among prioritized, flexible consumers.

The adapter will use existing ioBroker states for grid power, battery state of charge, device
availability, feedback, and control. It will not implement manufacturer protocols itself.

> Status: in development. The adapter runs and publishes its plan, but no version has been
> released yet.

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

## Published states

- `plan.valid`, `plan.reason`, `plan.reasonText`, `plan.updated` — what PowerQueue decided and why
- `budget.*` — the waterfall from the grid reading to the unallocated watts
- `consumers.<key>.*` — state, reason, proposed and applied power, runtime today, last change and
  the expiry of a manual override

The consumer states are also the restart-safe runtime state: minimum on/off times and the daily
runtime survive a restart because they are read back from these states.

In `observe` no foreign state is ever written. In `control` PowerQueue writes only the switch of a
consumer that is explicitly armed, and only when its target changes. A command from anyone else
hands the device over until midnight.

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

## Development

```bash
npm ci
npm run build      # adapter (build/) and admin UI (admin/index.html + admin/assets/)
npm run check      # typecheck backend and admin
npm run lint
npm test
```

## Changelog

<!-- Add changes for the next release here; the release script turns this into a version entry. -->

### **WORK IN PROGRESS**

- (typhosj) Runtime: inputs, evaluation loop, published plan and armed control writes.
- (typhosj) Devices tab: house battery, reserve, and the full device list with order and switching
  times.

### 0.0.1 (2026-08-07)

- (typhosj) Adapter scaffold: TypeScript runtime, React admin UI, CI and release tooling.
  Not published; the first public version is 0.1.0.

## License

MIT

Copyright (c) 2026 PowerQueue contributors
