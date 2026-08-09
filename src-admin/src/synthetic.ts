/**
 * The example household the simulation runs on while nothing real is configured yet.
 *
 * Only the measurements are fabricated. The decisions come from the same allocator the adapter
 * runs, so what the simulation shows is what PowerQueue would really do.
 */

import { allocate, applyPlan } from '../../src/lib/allocator';
import { DEFAULT_CONSUMER, DEFAULT_NATIVE, toDomainConfig, type NativeConfig } from '../../src/lib/config';
import type { Plan, Runtime, Sample } from '../../src/lib/types';

const MINUTE = 60_000;
const STEP_MS = 5 * MINUTE;
const HOUR = 60 * MINUTE;

/** A household with a photovoltaic system, no battery and one pool pump. */
export function exampleHousehold(): NativeConfig {
    return {
        ...DEFAULT_NATIVE,
        gridPowerId: 'example.0.grid.power',
        gridConfirmed: true,
        reserveW: 200,
        consumers: [
            {
                ...DEFAULT_CONSUMER,
                key: 'example-pump',
                name: 'Pool pump',
                targetId: 'example.0.pump',
                nominalPowerW: 1000,
                minOnMinutes: 30,
                minOffMinutes: 15,
                priority: 1,
                armed: true,
            },
        ],
    };
}

/**
 * @param hour - hour of the day as a fraction, 13.5 is half past one
 * @returns the photovoltaic production in watts
 */
function photovoltaicW(hour: number): number {
    if (hour <= 6 || hour >= 20) {
        return 0;
    }
    return Math.round(5500 * Math.sin((Math.PI * (hour - 6)) / 14) ** 1.5);
}

/**
 * @param hour - hour of the day as a fraction
 * @returns what the household uses without any flexible consumer, in watts
 */
function inflexibleLoadW(hour: number): number {
    let load = 350;
    if (hour >= 7 && hour < 8) {
        load += 1200; // breakfast
    }
    if (hour >= 18 && hour < 19.5) {
        load += 1800; // cooking
    }
    return load;
}

/** One simulated step: what was measured, and what PowerQueue decided from it. */
export interface SimulationStep {
    ts: number;
    /** Grid exchange without the flexible consumers, import positive. */
    baseGridW: number;
    /** Grid exchange as the meter would show it, including the running consumers. */
    gridW: number;
    plan: Plan;
}

/**
 * Replay a whole day through the real allocator.
 *
 * The loop is closed: the power the consumers draw is added to the grid reading of the next step,
 * so switching a load on really does eat the surplus, exactly as it would in the house.
 *
 * @param native - the configuration to simulate
 * @param dayStart - local midnight of the simulated day
 * @returns one entry per five minutes of the day
 */
export function simulateDay(native: NativeConfig, dayStart: number): SimulationStep[] {
    const config = toDomainConfig(native);
    const historyLength = Math.ceil(config.energy.smoothingWindowMs / STEP_MS) + 1;
    const steps: SimulationStep[] = [];
    const history: Sample[] = [];

    let runtime: Runtime = {};
    let drawnW = 0;
    let lastEvaluation: number | null = null;

    for (let ts = dayStart; ts < dayStart + 24 * HOUR; ts += STEP_MS) {
        const hour = (ts - dayStart) / HOUR;
        const baseGridW = inflexibleLoadW(hour) - photovoltaicW(hour);
        const gridW = baseGridW + drawnW;

        history.push({ value: gridW, ts });
        if (history.length > historyLength) {
            history.shift();
        }

        const plan = allocate(
            config,
            {
                now: ts,
                grid: [...history],
                batteryPower: null,
                batterySoc: null,
                consumers: Object.fromEntries(
                    native.consumers.map(consumer => [consumer.key, { available: true, actualPowerW: null }]),
                ),
            },
            runtime,
        );

        runtime = applyPlan(runtime, plan, lastEvaluation);
        lastEvaluation = ts;
        drawnW = Object.values(runtime).reduce((sum, state) => sum + state.appliedPowerW, 0);

        steps.push({ ts, baseGridW, gridW, plan });
    }

    return steps;
}

/** A moment at which the simulation switched a device on or off. */
export interface SwitchEvent {
    ts: number;
    key: string;
    on: boolean;
}

/**
 * @param steps - the simulated day
 * @returns every switch action of the day, in order
 */
export function switchEvents(steps: SimulationStep[]): SwitchEvent[] {
    const events: SwitchEvent[] = [];
    const previous: Record<string, number> = {};

    for (const step of steps) {
        for (const decision of step.plan.consumers) {
            const before = previous[decision.key] ?? 0;
            if (decision.proposedPowerW > 0 !== before > 0) {
                events.push({ ts: step.ts, key: decision.key, on: decision.proposedPowerW > 0 });
            }
            previous[decision.key] = decision.proposedPowerW;
        }
    }

    return events;
}

/**
 * @param steps - the simulated day
 * @returns runtime in seconds per consumer key
 */
export function runtimeByConsumer(steps: SimulationStep[]): Record<string, number> {
    const total: Record<string, number> = {};
    for (const step of steps) {
        for (const decision of step.plan.consumers) {
            total[decision.key] = (total[decision.key] ?? 0) + (decision.proposedPowerW > 0 ? STEP_MS / 1000 : 0);
        }
    }
    return total;
}
