/**
 * Domain types for the pure part of PowerQueue.
 *
 * Nothing in this file (or in `allocator.ts`) may depend on ioBroker, React or wall-clock time.
 * Every timestamp is passed in explicitly so the whole domain can be tested with a fake clock.
 *
 * Power is always in watts, state of charge in percent, durations in milliseconds.
 */

/** Operating mode. `observe` publishes a plan, `control` additionally writes to armed consumers. */
export type Mode = 'off' | 'observe' | 'control';

/**
 * Consumer lifecycle as shown to the user.
 *
 * - `off`: not running and not asking for power
 * - `waiting`: wants power but does not get it yet (budget, minimum off time)
 * - `committed`: kept running by its minimum on time although the budget no longer covers it
 * - `running`: running with an allocated budget
 * - `override`: someone else owns the target, PowerQueue does not write it
 * - `fault`: unusable right now (unavailable device, invalid inputs) — safe output applies
 */
export type ConsumerState = 'off' | 'waiting' | 'committed' | 'running' | 'override' | 'fault';

/**
 * Stable reason codes. They are published as-is, survive translations and minor releases, and are
 * the only explanation channel the UI is allowed to rely on.
 */
export type ReasonCode =
    | 'ok'
    | 'mode_off'
    | 'grid_missing'
    | 'grid_stale'
    | 'battery_stale'
    | 'soc_below_minimum'
    | 'allocated'
    | 'insufficient_budget'
    | 'min_on_time'
    | 'min_off_time'
    | 'external_override'
    | 'not_enabled'
    | 'not_available'
    | 'input_invalid';

/** One reading of a source state, with the timestamp ioBroker reported for it. */
export interface Sample {
    value: number;
    ts: number;
}

/**
 * Energy source configuration.
 *
 * The two `*Positive` flags are never entered by the user: the admin UI shows the live reading as
 * two complete sentences and derives the convention from the sentence the user confirms.
 */
export interface EnergyConfig {
    /** `true` when the raw grid state counts consumption from the grid as a positive number. */
    gridImportPositive: boolean;
    /** `true` when the raw battery state counts charging as a positive number. */
    batteryChargePositive: boolean;
    /** Global reserve in watts, phrased in the UI as "keep X W in reserve". */
    reserveW: number;
    /** Readings older than this are treated as missing. */
    maxAgeMs: number;
    /** Grid readings are averaged over this window before anything is decided. */
    smoothingWindowMs: number;
    /** Allocation is blocked below this state of charge. `null` disables the constraint. */
    minBatterySoc: number | null;
}

/** One consumer. A device that can only be switched on and off has `minPowerW === nominalPowerW`. */
export interface ConsumerConfig {
    /** Generated once, never derived from the display name. */
    key: string;
    name: string;
    /** Participates in planning. */
    enabled: boolean;
    /** Permits PowerQueue to write the external target. Independent of {@link enabled}. */
    armed: boolean;
    /** Lower number wins. Ties are broken by `key` so the order is deterministic. */
    priority: number;
    /** Highest power the consumer may be given. */
    nominalPowerW: number;
    /**
     * Lowest power the consumer can run at. Equal to `nominalPowerW` for a device that can only be
     * switched; a wallbox cannot charge below 6 A per phase and a modulating heater has a floor too.
     */
    minPowerW: number;
    /** Granularity of the allocated power. `0` is continuous; a wallbox steps by 1 A per phase. */
    stepW: number;
    minOnMs: number;
    minOffMs: number;
    /** Applied on invalid input and on unavailable devices. */
    safeOutputW: number;
}

export interface Config {
    mode: Mode;
    energy: EnergyConfig;
    consumers: ConsumerConfig[];
}

/** Per-consumer measured inputs. */
export interface ConsumerInput {
    /** The availability condition the user configured; `true` when none is configured. */
    available: boolean;
    /** Measured power feedback, `null` when the consumer has none. */
    actualPowerW: number | null;
}

/** One immutable set of inputs. A single snapshot drives one evaluation, never a mixed one. */
export interface Snapshot {
    now: number;
    /** Recent raw grid readings, oldest first. Empty means the required input is missing. */
    grid: Sample[];
    batteryPower: Sample | null;
    batterySoc: Sample | null;
    consumers: Record<string, ConsumerInput>;
}

/**
 * Runtime state that survives a restart. It is restored from the adapter's own states, never from a
 * second store: `appliedPowerW`, `lastChange` and `runtimeTodayS` are exactly what the UI shows.
 */
export interface ConsumerRuntime {
    appliedPowerW: number;
    /** Timestamp of the last change of `appliedPowerW`; drives the minimum on/off times. */
    lastChange: number;
    runtimeTodayS: number;
    /** Set when a foreign write was detected. Default expiry is the next midnight. */
    overrideUntil: number | null;
}

export type Runtime = Record<string, ConsumerRuntime>;

/** The budget waterfall the simulation view shows. */
export interface Budget {
    /** Smoothed and normalized grid power, import positive. `null` when unusable. */
    gridPowerW: number | null;
    /** Normalized battery power, charging positive. `null` when unusable or not configured. */
    batteryPowerW: number | null;
    batterySoc: number | null;
    /** Grid export plus battery charging power — the power that would otherwise be given away. */
    surplusW: number;
    reserveW: number;
    /** What the allocator may distribute, including the power running consumers already draw. */
    availableW: number;
    allocatedW: number;
    remainingW: number;
}

export interface ConsumerDecision {
    key: string;
    state: ConsumerState;
    proposedPowerW: number;
    /** `true` when the consumer could receive power at all — not whether it currently does. */
    eligible: boolean;
    reason: ReasonCode;
}

export interface Plan {
    now: number;
    /** `false` when a required input is unusable; consumers then fall back to their safe output. */
    valid: boolean;
    reason: ReasonCode;
    budget: Budget;
    consumers: ConsumerDecision[];
}
