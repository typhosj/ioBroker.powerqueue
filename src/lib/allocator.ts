/**
 * The pure core of PowerQueue: normalization, the consumer state machine and the greedy allocator.
 *
 * `allocate()` is a pure function from configuration, one immutable snapshot and the restored
 * runtime state to a decision plan. It never reads the clock, never touches ioBroker and never
 * mutates its arguments, so every transition can be tested with a fake clock.
 */

import type {
    Budget,
    Config,
    ConsumerConfig,
    ConsumerDecision,
    ConsumerRuntime,
    ConsumerState,
    Plan,
    ReasonCode,
    Runtime,
    Sample,
    Snapshot,
} from './types';

/**
 * Floor for the switching margin. A reserve of zero would otherwise remove the margin completely
 * and let a load switch on the measurement noise around its own nominal power.
 */
const MIN_MARGIN_FRACTION = 0.05;

/**
 * How much a target has to move before it is worth writing, as a fraction of the maximum power.
 * The surplus is never still, and a wallbox that renegotiates its current on every watt of noise is
 * worse off than one that follows the budget a little more coarsely.
 */
const WRITE_DEADBAND_FRACTION = 0.05;

/**
 * Runtime state of a consumer that has never run. `lastChange` is 0 on purpose: a consumer without
 * a history must not be blocked by a minimum off time it never earned. After a restart the real
 * `lastChange` comes back from the adapter's own states instead.
 */
export function emptyRuntime(): ConsumerRuntime {
    return { appliedPowerW: 0, lastChange: 0, runtimeTodayS: 0, overrideUntil: null };
}

/**
 * Average the readings inside the smoothing window.
 *
 * The newest reading decides freshness — a long window must not keep a dead source alive.
 *
 * @param samples - recent readings, oldest first
 * @param now - evaluation timestamp
 * @param windowMs - smoothing window
 * @param maxAgeMs - readings older than this make the input unusable
 * @returns the smoothed value, or `null` when the input is missing or stale
 */
export function smooth(samples: Sample[], now: number, windowMs: number, maxAgeMs: number): number | null {
    const newest = samples[samples.length - 1];
    if (!newest || now - newest.ts > maxAgeMs) {
        return null;
    }
    const inWindow = samples.filter(sample => now - sample.ts <= windowMs);
    const used = inWindow.length ? inWindow : [newest];
    return used.reduce((sum, sample) => sum + sample.value, 0) / used.length;
}

/**
 * Upper bound for the grid history. A source that reports every few milliseconds must not be able
 * to grow the buffer without limit inside a long smoothing window.
 */
const MAX_SAMPLES = 600;

/**
 * Drop readings that have left the smoothing window.
 *
 * The newest reading always survives: {@link smooth} needs it to decide freshness, and dropping it
 * would turn a stale source into a missing one.
 *
 * @param samples - recent readings, oldest first
 * @param now - evaluation timestamp
 * @param windowMs - smoothing window
 * @returns the readings still worth keeping, oldest first
 */
export function pruneSamples(samples: Sample[], now: number, windowMs: number): Sample[] {
    const kept = samples.filter(sample => now - sample.ts <= windowMs);
    return (kept.length ? kept : samples.slice(-1)).slice(-MAX_SAMPLES);
}

/**
 * Normalize a signed reading to the internal convention (grid: import positive, battery: charging
 * positive).
 *
 * @param value - raw reading
 * @param alreadyPositive - whether the source already uses the internal convention
 * @returns the normalized reading
 */
function normalize(value: number, alreadyPositive: boolean): number {
    return alreadyPositive ? value : -value;
}

/**
 * @param sample - newest reading of the source, `null` when it is not configured
 * @param now - evaluation timestamp
 * @param maxAgeMs - maximum accepted age
 * @returns the reading, or `null` when it is missing or stale
 */
function fresh(sample: Sample | null, now: number, maxAgeMs: number): number | null {
    return sample && now - sample.ts <= maxAgeMs ? sample.value : null;
}

/**
 * How much of the remaining budget a consumer may take.
 *
 * A device that can only be switched takes its full power or nothing, because its lowest power is
 * its nominal power. A modulating device takes anything between its lowest power and its maximum,
 * quantized to whole steps: the steps are counted from the lowest power, since 6 A per phase is the
 * floor of a wallbox and every further ampere is one step on top of that floor.
 *
 * @param consumer - consumer configuration
 * @param budgetW - the power that is still unallocated
 * @returns the power to hand out, `0` when the budget does not even cover the lowest power
 */
function grantFor(consumer: ConsumerConfig, budgetW: number): number {
    if (budgetW < consumer.minPowerW) {
        return 0;
    }
    const capped = Math.min(budgetW, consumer.nominalPowerW);
    if (consumer.stepW <= 0) {
        return capped;
    }
    return consumer.minPowerW + Math.floor((capped - consumer.minPowerW) / consumer.stepW) * consumer.stepW;
}

/**
 * Whether a new target differs enough from the commanded one to be worth writing.
 *
 * Switching on or off always is. Everything else has to clear a dead band, so a modulating device
 * is not re-commanded on every evaluation just because the sun moved behind a cloud for a moment.
 *
 * @param consumer - consumer configuration
 * @param fromW - the power that was last commanded
 * @param toW - the power the plan proposes
 * @returns whether the target should be written
 */
export function worthWriting(consumer: ConsumerConfig, fromW: number, toW: number): boolean {
    if (fromW > 0 !== toW > 0) {
        return true;
    }
    return Math.abs(toW - fromW) >= Math.max(consumer.stepW, WRITE_DEADBAND_FRACTION * consumer.nominalPowerW);
}

/**
 * Priority order: lower priority number first, ties broken by the stable key.
 *
 * @param a - first consumer
 * @param b - second consumer
 * @returns the comparison result for `Array.sort`
 */
function byPriority(a: ConsumerConfig, b: ConsumerConfig): number {
    return a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * @param runtime - runtime state of the consumer
 * @param actualPowerW - measured power, `null` when the consumer has no feedback
 * @returns the power the consumer draws right now, measured if it reports it, commanded otherwise
 */
function currentPowerW(runtime: ConsumerRuntime, actualPowerW: number | null): number {
    return actualPowerW ?? runtime.appliedPowerW;
}

/**
 * @param runtime - runtime state of the consumer
 * @param now - evaluation timestamp
 * @returns whether someone else currently owns the target
 */
function isOverridden(runtime: ConsumerRuntime, now: number): boolean {
    return runtime.overrideUntil !== null && runtime.overrideUntil > now;
}

/**
 * A consumer someone else owns. PowerQueue never reasserts its own value here, so the proposal is
 * whatever the target currently has.
 *
 * @param consumer - consumer configuration
 * @param runtime - runtime state of the consumer
 * @param snapshot - the current snapshot
 * @returns the unchanged decision for the overridden consumer
 */
function overrideDecision(consumer: ConsumerConfig, runtime: ConsumerRuntime, snapshot: Snapshot): ConsumerDecision {
    return {
        key: consumer.key,
        state: 'override',
        proposedPowerW: currentPowerW(runtime, snapshot.consumers[consumer.key]?.actualPowerW ?? null),
        eligible: false,
        reason: 'external_override',
    };
}

/**
 * Plan in which no consumer is asked to do anything, used for `off` and for unusable inputs.
 *
 * @param config - normalized configuration
 * @param snapshot - the current snapshot
 * @param runtime - runtime state of all consumers
 * @param reason - why no decision was taken
 * @param budget - the budget as far as it could be determined
 * @returns an invalid plan whose proposals are safe outputs
 */
function fallbackPlan(config: Config, snapshot: Snapshot, runtime: Runtime, reason: ReasonCode, budget: Budget): Plan {
    const consumers = [...config.consumers].sort(byPriority).map((consumer): ConsumerDecision => {
        const state = runtime[consumer.key] ?? emptyRuntime();
        if (isOverridden(state, snapshot.now)) {
            return overrideDecision(consumer, state, snapshot);
        }
        return {
            key: consumer.key,
            state: reason === 'mode_off' ? 'off' : 'fault',
            // Safe output wins over the minimum on time: a load that is running on unusable
            // measurements is exactly the situation the safe output exists for.
            proposedPowerW: reason === 'mode_off' ? state.appliedPowerW : consumer.safeOutputW,
            eligible: false,
            reason,
        };
    });
    // Not a decision: either nothing was decided (`off`) or it could not be decided safely.
    return { now: snapshot.now, valid: false, reason, budget, consumers };
}

/**
 * Decide what every consumer should do.
 *
 * @param config - normalized configuration
 * @param snapshot - one immutable set of inputs
 * @param runtime - runtime state restored from the adapter's own states
 * @returns the decision plan; in `observe` it is published only, in `control` it is also written
 */
export function allocate(config: Config, snapshot: Snapshot, runtime: Runtime): Plan {
    const { energy } = config;
    const now = snapshot.now;

    const gridRaw = smooth(snapshot.grid, now, energy.smoothingWindowMs, energy.maxAgeMs);
    const gridPowerW = gridRaw === null ? null : normalize(gridRaw, energy.gridImportPositive);

    const batteryRaw = fresh(snapshot.batteryPower, now, energy.maxAgeMs);
    const batteryPowerW = batteryRaw === null ? null : normalize(batteryRaw, energy.batteryChargePositive);
    const batteryStale = snapshot.batteryPower !== null && batteryPowerW === null;

    const batterySoc = fresh(snapshot.batterySoc, now, energy.maxAgeMs);

    // Grid export plus the power the battery is currently absorbing: both would be given away or
    // stored instead of being used by a flexible load.
    const surplusW = gridPowerW === null ? 0 : -gridPowerW + Math.max(batteryPowerW ?? 0, 0);

    const socBlocked = energy.minBatterySoc !== null && batterySoc !== null && batterySoc < energy.minBatterySoc;

    const emptyBudget: Budget = {
        gridPowerW,
        batteryPowerW,
        batterySoc,
        surplusW,
        reserveW: energy.reserveW,
        availableW: 0,
        allocatedW: 0,
        remainingW: 0,
    };

    if (config.mode === 'off') {
        return fallbackPlan(config, snapshot, runtime, 'mode_off', emptyBudget);
    }
    if (gridPowerW === null) {
        const reason: ReasonCode = snapshot.grid.length ? 'grid_stale' : 'grid_missing';
        return fallbackPlan(config, snapshot, runtime, reason, emptyBudget);
    }

    const ordered = [...config.consumers].sort(byPriority);

    // Running consumers already show up in the grid reading, so their power has to be added back
    // before it can be redistributed. Overridden consumers are not ours to redistribute.
    const controlled = ordered.filter(consumer => {
        const state = runtime[consumer.key] ?? emptyRuntime();
        return !isOverridden(state, now);
    });
    const drawnW = controlled.reduce((sum, consumer) => {
        const state = runtime[consumer.key] ?? emptyRuntime();
        return sum + currentPowerW(state, snapshot.consumers[consumer.key]?.actualPowerW ?? null);
    }, 0);

    // A blocked battery does not remove the commitments of already running loads, it only stops
    // PowerQueue from handing out anything new.
    const availableW = socBlocked ? 0 : surplusW + drawnW;

    let remainingW = availableW;
    const decisions: ConsumerDecision[] = [];

    for (const consumer of ordered) {
        const state = runtime[consumer.key] ?? emptyRuntime();
        const input = snapshot.consumers[consumer.key];

        if (isOverridden(state, now)) {
            decisions.push(overrideDecision(consumer, state, snapshot));
            continue;
        }

        if (!consumer.enabled) {
            decisions.push({
                key: consumer.key,
                state: 'off',
                proposedPowerW: 0,
                eligible: false,
                reason: 'not_enabled',
            });
            continue;
        }

        if (!input) {
            decisions.push({
                key: consumer.key,
                state: 'fault',
                proposedPowerW: consumer.safeOutputW,
                eligible: false,
                reason: 'input_invalid',
            });
            continue;
        }

        if (!input.available) {
            decisions.push({
                key: consumer.key,
                state: 'fault',
                proposedPowerW: consumer.safeOutputW,
                eligible: false,
                reason: 'not_available',
            });
            continue;
        }

        const margin = Math.max(energy.reserveW, MIN_MARGIN_FRACTION * consumer.minPowerW);
        const running = state.appliedPowerW > 0;
        // Keeping a device running costs what it draws; starting one costs the margin on top.
        const keepW = grantFor(consumer, remainingW);
        const startW = grantFor(consumer, remainingW - margin);
        let proposedPowerW = 0;
        let consumerState: ConsumerState;
        let reason: ReasonCode;

        if (running) {
            if (keepW > 0) {
                proposedPowerW = keepW;
                consumerState = 'running';
                reason = 'allocated';
            } else if (now - state.lastChange < consumer.minOnMs) {
                // Held above the budget on purpose: switching the device off again this soon is
                // worse for it than the small import this causes. A device that can modulate is
                // held at its lowest power, which is the cheapest way to keep that commitment.
                proposedPowerW = consumer.minPowerW;
                consumerState = 'committed';
                reason = 'min_on_time';
            } else {
                consumerState = 'off';
                reason = socBlocked ? 'soc_below_minimum' : 'insufficient_budget';
            }
        } else if (now - state.lastChange < consumer.minOffMs) {
            consumerState = 'waiting';
            reason = 'min_off_time';
        } else if (startW > 0) {
            // Starting costs the reserve on top of the lowest power; staying on does not. That
            // asymmetry is the hysteresis, derived from the reserve the user already configured.
            proposedPowerW = startW;
            consumerState = 'running';
            reason = 'allocated';
        } else {
            consumerState = 'waiting';
            reason = socBlocked ? 'soc_below_minimum' : 'insufficient_budget';
        }

        remainingW -= proposedPowerW;
        decisions.push({ key: consumer.key, state: consumerState, proposedPowerW, eligible: true, reason });
    }

    const allocatedW = decisions.reduce(
        (sum, decision) => sum + (decision.state === 'override' ? 0 : decision.proposedPowerW),
        0,
    );

    return {
        now,
        valid: true,
        reason: socBlocked ? 'soc_below_minimum' : batteryStale ? 'battery_stale' : 'ok',
        budget: { ...emptyBudget, availableW, allocatedW, remainingW: availableW - allocatedW },
        consumers: decisions,
    };
}

/**
 * @param ts - timestamp in milliseconds
 * @returns the local calendar day, used to reset day-scoped accounting after a restart
 */
function localDay(ts: number): string {
    return new Date(ts).toDateString();
}

/**
 * Default expiry of a manual override: someone who switches a device by hand owns it for the rest
 * of the day, not forever.
 *
 * @param ts - timestamp in milliseconds
 * @returns the next local midnight after `ts`
 */
export function nextMidnight(ts: number): number {
    const date = new Date(ts);
    date.setHours(24, 0, 0, 0);
    return date.getTime();
}

/**
 * Fold an executed plan back into the runtime state.
 *
 * Call this only with what was actually applied — in `observe` nothing is written, so nothing is
 * folded back. `lastChange` moves only on a real change, which is what the minimum on/off times
 * and the restart behavior depend on.
 *
 * @param runtime - previous runtime state
 * @param plan - the plan whose targets were applied
 * @param lastEvaluation - timestamp of the previous evaluation, `null` right after a start
 * @returns a new runtime state; the argument is not modified
 */
export function applyPlan(runtime: Runtime, plan: Plan, lastEvaluation: number | null): Runtime {
    const newDay = lastEvaluation === null || localDay(lastEvaluation) !== localDay(plan.now);
    const elapsedS = lastEvaluation === null || newDay ? 0 : Math.max(plan.now - lastEvaluation, 0) / 1000;
    const next: Runtime = {};

    for (const decision of plan.consumers) {
        const previous = runtime[decision.key] ?? emptyRuntime();
        const wasRunning = previous.appliedPowerW > 0;
        const changed = decision.proposedPowerW !== previous.appliedPowerW;
        next[decision.key] = {
            appliedPowerW: decision.proposedPowerW,
            lastChange: changed ? plan.now : previous.lastChange,
            runtimeTodayS: (newDay ? 0 : previous.runtimeTodayS) + (wasRunning ? elapsedS : 0),
            overrideUntil: previous.overrideUntil,
        };
    }

    return next;
}
