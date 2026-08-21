# ioBroker.powerqueue

<p align="center">
    <img src="admin/powerqueue.png" alt="PowerQueue logo" width="280" />
</p>

[![NPM version](https://img.shields.io/npm/v/iobroker.powerqueue.svg)](https://www.npmjs.com/package/iobroker.powerqueue)
[![Downloads](https://img.shields.io/npm/dm/iobroker.powerqueue.svg)](https://www.npmjs.com/package/iobroker.powerqueue)
![Number of Installations](https://iobroker.live/badges/powerqueue-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/powerqueue-stable.svg)
[![Test and Release](https://github.com/typhosj/ioBroker.powerqueue/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/typhosj/ioBroker.powerqueue/actions/workflows/test-and-release.yml)
[![License](https://img.shields.io/github/license/typhosj/ioBroker.powerqueue)](LICENSE)

PowerQueue is a vendor-neutral ioBroker adapter that distributes an available electrical
power budget among prioritized, flexible consumers.

The adapter will use existing ioBroker states for grid power, battery state of charge, device
availability, feedback, and control. It will not implement manufacturer protocols itself.

> Status: first public release. Observation mode is the default — PowerQueue only switches a device
> after you have set it to control and released that device explicitly.

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
- Consumers that are switched on and off, and consumers that are given a power: watts, amperes
  per phase, or a percentage of their maximum
- Ordered priorities, one global reserve, per-consumer minimum on/off times
- `off`, `observe`, and explicitly armed `control` modes
- Per-consumer availability, feedback, manual override, and safe state
- PowerQueue never reasserts a target against a manual or external change
- Stable machine-readable reason codes plus translated explanations
- Live simulation preview before active control
- Restart-safe runtime state, stored in the adapter's own states

One-shot job loads, deadlines, weekday windows and daily runtime quotas are deliberately deferred
to later versions, and so is automatic phase switching between one and three phases.

## Published states

- `plan.valid`, `plan.reason`, `plan.reasonText`, `plan.updated` — what PowerQueue decided and why
- `budget.*` — the waterfall from the grid reading to the unallocated watts
- `stats.plannedTodayWh` — the energy today's plans add up to: what the devices got, or in
  `observe` what they would have got
- `consumers.<key>.*` — state, reason, proposed, applied and measured power, runtime today, last
  change and the expiry of a manual override

The consumer states are also the restart-safe runtime state: minimum on/off times and the daily
runtime survive a restart because they are read back from these states.

In `observe` no foreign state is ever written. A device PowerQueue does not operate — because it
is only watching, or because that device was never released — is read from its measurement instead
of from a command that was never sent: a pump running on its own schedule counts as running. In `control` PowerQueue writes only the switch of a
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
- No job consumers with a deadline yet, and no automatic 1P/3P phase switching
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

- (typhosj) Devices that can be set to a power instead of only being switched: a wallbox takes a
  charging current in amperes per phase, a heating element a percentage, some adapters watts.
  PowerQueue keeps such a device between its lowest and its highest power, in the steps the device
  can follow, and switches it off rather than running it below its floor.
- (typhosj) A target is only written when it moves by a whole step or by five percent of the
  maximum, so a wallbox is not re-commanded on every cloud.
- (typhosj) The mains voltage used to turn watts into amperes can be corrected; 230 V is only the
  nominal value.
- (typhosj) `stats.plannedTodayWh` counts what the plans of the day add up to, so watching alone
  already answers whether PowerQueue would be worth switching on.
- (typhosj) The configuration page scrolls again. Nothing in it had a height of its own, so every
  tab ended at the lower edge of the frame — the button that adds a device was below it.
- (typhosj) A device card asks what kind of device it is first, and then asks for its values in
  the unit that kind is spoken in: a wallbox is configured in amperes, not in watts.
- (typhosj) A device that reports only its charging current can be used as the measured value; the
  phases and the voltage turn it into watts.
- (typhosj) A selected state answers the question about its unit itself whenever its unit says so:
  `A` picks amperes, `W` picks watts. Units that would have to be scaled, like `kW`, keep asking.
- (typhosj) "Right now" no longer reads like a report about the house while PowerQueue is only
  watching. It says so, calls the column a proposal, and shows next to it what each device really
  draws — published as `consumers.<key>.measuredPowerW`.
- (typhosj) A plan takes the devices PowerQueue does not operate as they really are. Before, every
  device counted as off while PowerQueue was only watching, so the surplus a running pump already
  used was offered to another device on top of it.
- (typhosj) The power of a device that takes no part in the planning is no longer added to the
  budget. It keeps drawing whatever it draws, so offering it to another device spent the same watts
  twice; only the command PowerQueue is about to revoke comes back.
- (typhosj) The budget lines say why the distributable power can be larger than what the house
  feeds in: the flexible devices that are already running are part of it.

### 0.1.0 (2026-08-13)

- (typhosj) Runtime: inputs, evaluation loop, published plan and armed control writes.
- (typhosj) Devices tab: house battery, reserve, and the full device list with order and switching
  times.
- (typhosj) "Right now" tab: the live plan of the running instance, in the language of the admin UI.
- (typhosj) Optional availability condition per device, with the value that means "may run".
- (typhosj) Survive a stored configuration whose empty device list comes back as an object — the
  adapter crashed on start instead of reporting what was missing.
- (typhosj) Translations for every supported language.
- (typhosj) The PowerQueue icon from the chosen logo concept, instead of the scaffold placeholder.
- (typhosj) Load the socket library in the configuration page, which never opened without it.
- (typhosj) Ask for the momentary grid power instead of "the meter", and hide energy counters from
  every power selection.
- (typhosj) Confirming a sentence works again: two configuration fields changed in one click
  overwrote each other, and on a meter whose readings are negative the confirmed sentence was
  mapped back to the other one.
- (typhosj) The guided setup opens the next step as soon as one is finished, instead of only after
  leaving the tab and coming back.
- (typhosj) A device that reports its power can hand its current reading to the configured power
  with one click.
- (typhosj) The simulation said "drawing" while the house was feeding in, and the budget lines now
  say that the handed-out power is part of the free power, not on top of it.
- (typhosj) Device cards fold away once a device is complete, and say in one line what they hide.
- (typhosj) The availability condition explains itself instead of being labelled "only when this is
  set".

### 0.0.1 (2026-08-07)

- (typhosj) Adapter scaffold: TypeScript runtime, React admin UI, CI and release tooling.
  Not published; the first public version is 0.1.0.

## License

MIT

Copyright (c) 2026 PowerQueue contributors
