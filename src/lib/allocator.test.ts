/**
 * Fake-clock tests for the pure domain model. Every timestamp is explicit; nothing here reads the
 * real clock or touches ioBroker.
 */

import { expect } from 'chai';
import { allocate, applyPlan, emptyRuntime, nextMidnight, pruneSamples, smooth, worthWriting } from './allocator';
import type { Config, ConsumerConfig, ConsumerRuntime, Plan, Runtime, Snapshot } from './types';

const T0 = new Date('2026-08-09T12:00:00Z').getTime();
const MINUTE = 60_000;

function consumer(overrides: Partial<ConsumerConfig> = {}): ConsumerConfig {
    const merged = {
        key: 'pump',
        name: 'Pool pump',
        enabled: true,
        armed: true,
        priority: 1,
        nominalPowerW: 1000,
        minPowerW: 0,
        stepW: 0,
        minOnMs: 10 * MINUTE,
        minOffMs: 10 * MINUTE,
        safeOutputW: 0,
        ...overrides,
    };
    // A device that can only be switched has exactly one power. Only a test that asks for a floor
    // of its own gets a modulating consumer.
    return { ...merged, minPowerW: overrides.minPowerW ?? merged.nominalPowerW };
}

/** Three-phase wallbox: 6 A per phase at the bottom, 16 A at the top, one ampere per step. */
function wallbox(overrides: Partial<ConsumerConfig> = {}): ConsumerConfig {
    return consumer({
        key: 'wallbox',
        name: 'Wallbox',
        nominalPowerW: 11_040,
        minPowerW: 4140,
        stepW: 690,
        ...overrides,
    });
}

function config(consumers: ConsumerConfig[], energy: Partial<Config['energy']> = {}): Config {
    return {
        mode: 'control',
        energy: {
            gridImportPositive: true,
            batteryChargePositive: true,
            reserveW: 200,
            maxAgeMs: 5 * MINUTE,
            smoothingWindowMs: MINUTE,
            minBatterySoc: null,
            ...energy,
        },
        consumers,
    };
}

/** Snapshot with a single fresh grid reading and all consumers available without feedback. */
function snapshot(gridW: number, keys: string[], overrides: Partial<Snapshot> = {}): Snapshot {
    const consumers: Snapshot['consumers'] = {};
    for (const key of keys) {
        consumers[key] = { available: true, actualPowerW: null };
    }
    return {
        now: T0,
        grid: [{ value: gridW, ts: T0 }],
        batteryPower: null,
        batterySoc: null,
        consumers,
        ...overrides,
    };
}

function runtimeOf(overrides: Partial<ConsumerRuntime> = {}, key = 'pump'): Runtime {
    return { [key]: { ...emptyRuntime(), ...overrides } };
}

function decision(plan: Plan, key: string): Plan['consumers'][number] {
    const found = plan.consumers.find(entry => entry.key === key);
    expect(found, `no decision for ${key}`).to.not.equal(undefined);
    return found!;
}

describe('smooth', () => {
    it('averages only the readings inside the window', () => {
        const samples = [
            { value: 1000, ts: T0 - 5 * MINUTE },
            { value: 200, ts: T0 - 30_000 },
            { value: 400, ts: T0 },
        ];
        expect(smooth(samples, T0, MINUTE, 5 * MINUTE)).to.equal(300);
    });

    it('rejects a stale source even when older readings are inside the window', () => {
        const samples = [{ value: 400, ts: T0 - 10 * MINUTE }];
        expect(smooth(samples, T0, MINUTE, 5 * MINUTE)).to.equal(null);
    });

    it('reports a missing source', () => {
        expect(smooth([], T0, MINUTE, 5 * MINUTE)).to.equal(null);
    });
});

describe('pruneSamples', () => {
    it('drops readings that left the window', () => {
        const samples = [
            { value: 1, ts: T0 - 5 * MINUTE },
            { value: 2, ts: T0 - 30_000 },
            { value: 3, ts: T0 },
        ];
        expect(pruneSamples(samples, T0, MINUTE)).to.deep.equal(samples.slice(1));
    });

    it('keeps the newest reading so a stale source stays visible', () => {
        const samples = [{ value: 1, ts: T0 - 10 * MINUTE }];
        expect(pruneSamples(samples, T0, MINUTE)).to.deep.equal(samples);
    });

    it('bounds the buffer for a fast source', () => {
        const samples = Array.from({ length: 1000 }, (_unused, index) => ({ value: index, ts: T0 }));
        const pruned = pruneSamples(samples, T0, MINUTE);
        expect(pruned).to.have.lengthOf(600);
        expect(pruned[pruned.length - 1].value).to.equal(999);
    });
});

describe('nextMidnight', () => {
    it('expires an override at the end of the local day', () => {
        const midnight = nextMidnight(T0);
        expect(midnight).to.be.greaterThan(T0);
        expect(new Date(midnight).getHours()).to.equal(0);
        expect(midnight - T0).to.be.at.most(24 * 60 * MINUTE);
    });
});

describe('allocate', () => {
    it('starts a load only when the surplus covers nominal power plus the reserve', () => {
        const cfg = config([consumer()]);
        const runtime = runtimeOf();

        const tooLittle = allocate(cfg, snapshot(-1100, ['pump']), runtime);
        expect(decision(tooLittle, 'pump').proposedPowerW).to.equal(0);
        expect(decision(tooLittle, 'pump').reason).to.equal('insufficient_budget');

        const enough = allocate(cfg, snapshot(-1200, ['pump']), runtime);
        expect(decision(enough, 'pump').proposedPowerW).to.equal(1000);
        expect(decision(enough, 'pump').state).to.equal('running');
        expect(enough.budget.remainingW).to.equal(200);
    });

    it('applies a switching margin even when the reserve is zero', () => {
        const cfg = config([consumer()], { reserveW: 0 });
        const plan = allocate(cfg, snapshot(-1040, ['pump']), runtimeOf());
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
        expect(allocate(cfg, snapshot(-1050, ['pump']), runtimeOf()).consumers[0].proposedPowerW).to.equal(1000);
    });

    it('serves the higher priority first and lets the rest wait', () => {
        const cfg = config([
            consumer({ key: 'car', priority: 2, nominalPowerW: 1000 }),
            consumer({ key: 'pump', priority: 1, nominalPowerW: 1000 }),
        ]);
        const plan = allocate(cfg, snapshot(-1500, ['pump', 'car']), {});
        expect(plan.consumers.map(entry => entry.key)).to.deep.equal(['pump', 'car']);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
        expect(decision(plan, 'car').proposedPowerW).to.equal(0);
        expect(decision(plan, 'car').state).to.equal('waiting');
    });

    it('breaks priority ties by the stable key', () => {
        const cfg = config([consumer({ key: 'b' }), consumer({ key: 'a' })]);
        const plan = allocate(cfg, snapshot(-1200, ['a', 'b']), {});
        expect(plan.consumers.map(entry => entry.key)).to.deep.equal(['a', 'b']);
        expect(decision(plan, 'a').proposedPowerW).to.equal(1000);
    });

    it('redistributes the power a running load already draws instead of double counting it', () => {
        // The pump is running, so the grid reading already contains its 1000 W.
        const cfg = config([consumer()]);
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE });
        const plan = allocate(cfg, snapshot(-200, ['pump']), runtime);
        expect(plan.budget.availableW).to.equal(1200);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
        expect(decision(plan, 'pump').state).to.equal('running');
    });

    it('keeps a running load on until the budget stops covering its nominal power', () => {
        const cfg = config([consumer()]);
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE });
        // 900 W of the 1000 W it draws remain available: below nominal, and the minimum on time
        // has long expired.
        const plan = allocate(cfg, snapshot(100, ['pump']), runtime);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
        expect(decision(plan, 'pump').reason).to.equal('insufficient_budget');
    });

    it('holds a load above the budget until its minimum on time expires', () => {
        const cfg = config([consumer()]);
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 2 * MINUTE });
        const plan = allocate(cfg, snapshot(100, ['pump']), runtime);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
        expect(decision(plan, 'pump').state).to.equal('committed');
        expect(decision(plan, 'pump').reason).to.equal('min_on_time');
    });

    it('blocks a restart during the minimum off time', () => {
        const cfg = config([consumer()]);
        const runtime = runtimeOf({ appliedPowerW: 0, lastChange: T0 - 2 * MINUTE });
        const plan = allocate(cfg, snapshot(-3000, ['pump']), runtime);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
        expect(decision(plan, 'pump').reason).to.equal('min_off_time');
    });

    it('counts battery charging as surplus and normalizes inverted signs', () => {
        // Export-positive grid state, discharge-positive battery state.
        const cfg = config([consumer()], { gridImportPositive: false, batteryChargePositive: false });
        const snap = snapshot(0, ['pump'], {
            grid: [{ value: 0, ts: T0 }],
            batteryPower: { value: -1500, ts: T0 },
        });
        const plan = allocate(cfg, snap, runtimeOf());
        expect(plan.budget.gridPowerW).to.equal(0);
        expect(plan.budget.batteryPowerW).to.equal(1500);
        expect(plan.budget.surplusW).to.equal(1500);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
    });

    it('ignores a discharging battery instead of subtracting it twice', () => {
        const cfg = config([consumer()]);
        const snap = snapshot(-1500, ['pump'], { batteryPower: { value: -800, ts: T0 } });
        const plan = allocate(cfg, snap, runtimeOf());
        expect(plan.budget.surplusW).to.equal(1500);
    });

    it('ignores a stale battery reading but reports it', () => {
        const cfg = config([consumer()]);
        const snap = snapshot(-1500, ['pump'], { batteryPower: { value: 2000, ts: T0 - 10 * MINUTE } });
        const plan = allocate(cfg, snap, runtimeOf());
        expect(plan.valid).to.equal(true);
        expect(plan.reason).to.equal('battery_stale');
        expect(plan.budget.surplusW).to.equal(1500);
    });

    it('blocks allocation below the minimum state of charge', () => {
        const cfg = config([consumer()], { minBatterySoc: 30 });
        const snap = snapshot(-3000, ['pump'], { batterySoc: { value: 20, ts: T0 } });
        const plan = allocate(cfg, snap, runtimeOf());
        expect(plan.reason).to.equal('soc_below_minimum');
        expect(plan.budget.availableW).to.equal(0);
        expect(decision(plan, 'pump').reason).to.equal('soc_below_minimum');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
    });

    it('still honours the minimum on time while the state of charge blocks allocation', () => {
        const cfg = config([consumer()], { minBatterySoc: 30 });
        const snap = snapshot(-3000, ['pump'], { batterySoc: { value: 20, ts: T0 } });
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 2 * MINUTE });
        expect(decision(allocate(cfg, snap, runtime), 'pump').state).to.equal('committed');
    });

    it('falls back to the safe output when the required grid reading is stale', () => {
        const cfg = config([consumer({ safeOutputW: 0 })]);
        const snap = snapshot(-3000, ['pump'], { grid: [{ value: -3000, ts: T0 - 10 * MINUTE }] });
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 });
        const plan = allocate(cfg, snap, runtime);
        expect(plan.valid).to.equal(false);
        expect(plan.reason).to.equal('grid_stale');
        expect(decision(plan, 'pump').state).to.equal('fault');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
    });

    it('separates a missing grid state from a stale one', () => {
        const plan = allocate(config([consumer()]), snapshot(0, ['pump'], { grid: [] }), {});
        expect(plan.reason).to.equal('grid_missing');
    });

    it('proposes no change at all in off mode', () => {
        const cfg = { ...config([consumer()]), mode: 'off' as const };
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE });
        const plan = allocate(cfg, snapshot(-3000, ['pump']), runtime);
        expect(plan.reason).to.equal('mode_off');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
        expect(decision(plan, 'pump').state).to.equal('off');
    });

    it('never touches an overridden consumer and never redistributes its power', () => {
        const cfg = config([consumer({ key: 'pump', priority: 1 }), consumer({ key: 'car', priority: 2 })]);
        const runtime: Runtime = {
            pump: { appliedPowerW: 1000, lastChange: T0 - MINUTE, runtimeTodayS: 0, overrideUntil: T0 + MINUTE },
            car: emptyRuntime(),
        };
        // The 1000 W the overridden pump draws is part of the grid reading and stays there.
        const plan = allocate(cfg, snapshot(-200, ['pump', 'car']), runtime);
        expect(decision(plan, 'pump').state).to.equal('override');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
        expect(plan.budget.availableW).to.equal(200);
        expect(plan.budget.allocatedW).to.equal(0);
        expect(decision(plan, 'car').proposedPowerW).to.equal(0);
    });

    it('releases a consumer when its override has expired', () => {
        const cfg = config([consumer()]);
        const runtime = runtimeOf({ lastChange: T0 - 30 * MINUTE, overrideUntil: T0 - MINUTE });
        expect(decision(allocate(cfg, snapshot(-3000, ['pump']), runtime), 'pump').proposedPowerW).to.equal(1000);
    });

    it('keeps an overridden consumer overridden while the inputs are unusable', () => {
        const cfg = config([consumer({ safeOutputW: 0 })]);
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0, overrideUntil: T0 + MINUTE });
        const plan = allocate(cfg, snapshot(0, ['pump'], { grid: [] }), runtime);
        expect(decision(plan, 'pump').state).to.equal('override');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(1000);
    });

    it('switches a disabled consumer off and frees its power', () => {
        const cfg = config([
            consumer({ key: 'pump', priority: 1, enabled: false }),
            consumer({ key: 'car', priority: 2 }),
        ]);
        const runtime: Runtime = {
            pump: { appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE, runtimeTodayS: 0, overrideUntil: null },
            car: emptyRuntime(),
        };
        const plan = allocate(cfg, snapshot(-200, ['pump', 'car']), runtime);
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
        expect(decision(plan, 'pump').reason).to.equal('not_enabled');
        expect(decision(plan, 'car').proposedPowerW).to.equal(1000);
    });

    it('applies the safe output to an unavailable consumer', () => {
        const cfg = config([consumer({ safeOutputW: 0 })]);
        const snap = snapshot(-3000, ['pump']);
        snap.consumers.pump = { available: false, actualPowerW: 0 };
        const plan = allocate(cfg, snap, runtimeOf());
        expect(decision(plan, 'pump').state).to.equal('fault');
        expect(decision(plan, 'pump').reason).to.equal('not_available');
        expect(decision(plan, 'pump').proposedPowerW).to.equal(0);
    });

    it('prefers measured power over the commanded value when redistributing', () => {
        // Commanded 1000 W, but the pump actually draws 400 W — only 400 W are in the grid reading.
        const cfg = config([consumer()]);
        const snap = snapshot(-100, ['pump']);
        snap.consumers.pump = { available: true, actualPowerW: 400 };
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE });
        expect(allocate(cfg, snap, runtime).budget.availableW).to.equal(500);
    });

    it('does not mutate its arguments', () => {
        const cfg = config([consumer({ key: 'b', priority: 2 }), consumer({ key: 'a', priority: 1 })]);
        const runtime = runtimeOf({ appliedPowerW: 1000 }, 'a');
        allocate(cfg, snapshot(-3000, ['a', 'b']), runtime);
        expect(cfg.consumers.map(entry => entry.key)).to.deep.equal(['b', 'a']);
        expect(runtime.a.appliedPowerW).to.equal(1000);
    });
});

describe('applyPlan', () => {
    const cfg = config([consumer()]);

    it('moves lastChange only on a real change', () => {
        const runtime = runtimeOf({ appliedPowerW: 0, lastChange: T0 - 30 * MINUTE });
        const started = applyPlan(runtime, allocate(cfg, snapshot(-3000, ['pump']), runtime), T0 - MINUTE);
        expect(started.pump.appliedPowerW).to.equal(1000);
        expect(started.pump.lastChange).to.equal(T0);

        const laterSnapshot = { ...snapshot(-3000, ['pump']), now: T0 + MINUTE };
        const unchanged = applyPlan(started, allocate(cfg, laterSnapshot, started), T0);
        expect(unchanged.pump.lastChange).to.equal(T0);
    });

    it('accumulates runtime only while the consumer was running', () => {
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE, runtimeTodayS: 60 });
        const next = applyPlan(runtime, allocate(cfg, snapshot(-3000, ['pump']), runtime), T0 - 2 * MINUTE);
        expect(next.pump.runtimeTodayS).to.equal(180);

        const idle = runtimeOf({ appliedPowerW: 0, lastChange: T0 - 30 * MINUTE, runtimeTodayS: 60 });
        const stillIdle = applyPlan(idle, allocate(cfg, snapshot(0, ['pump']), idle), T0 - 2 * MINUTE);
        expect(stillIdle.pump.runtimeTodayS).to.equal(60);
    });

    it('resets the daily runtime after a day rollover', () => {
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE, runtimeTodayS: 3600 });
        const yesterday = T0 - 24 * 60 * MINUTE;
        const next = applyPlan(runtime, allocate(cfg, snapshot(-3000, ['pump']), runtime), yesterday);
        expect(next.pump.runtimeTodayS).to.equal(0);
    });

    it('starts a fresh day when no previous evaluation is known', () => {
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0 - 30 * MINUTE, runtimeTodayS: 3600 });
        const next = applyPlan(runtime, allocate(cfg, snapshot(-3000, ['pump']), runtime), null);
        expect(next.pump.runtimeTodayS).to.equal(0);
    });

    it('keeps an override across evaluations', () => {
        const runtime = runtimeOf({ appliedPowerW: 1000, lastChange: T0, overrideUntil: T0 + MINUTE });
        const next = applyPlan(runtime, allocate(cfg, snapshot(-3000, ['pump']), runtime), T0 - MINUTE);
        expect(next.pump.overrideUntil).to.equal(T0 + MINUTE);
    });
});

describe('modulating consumers', () => {
    const cfg = config([wallbox()]);

    it('starts at the lowest power the device can charge with', () => {
        const runtime = runtimeOf({}, 'wallbox');
        const plan = allocate(cfg, snapshot(-5000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(4140);
        expect(plan.consumers[0].state).to.equal('running');
    });

    it('does not start below the lowest power, however close the budget gets', () => {
        const runtime = runtimeOf({}, 'wallbox');
        const plan = allocate(cfg, snapshot(-4200, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(0);
        expect(plan.consumers[0].reason).to.equal('insufficient_budget');
    });

    it('follows the surplus upwards in whole steps of one ampere per phase', () => {
        const runtime = runtimeOf({ appliedPowerW: 4140, lastChange: T0 - 30 * MINUTE }, 'wallbox');
        // 3000 W of surplus on top of the 4140 W the wallbox already draws: four more amperes fit,
        // the remainder is not a whole step and stays unallocated.
        const plan = allocate(cfg, snapshot(-3000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(6900);
        expect(plan.budget.remainingW).to.equal(240);
    });

    it('never proposes more than the device can take', () => {
        const runtime = runtimeOf({ appliedPowerW: 4140, lastChange: T0 - 30 * MINUTE }, 'wallbox');
        const plan = allocate(cfg, snapshot(-20_000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(11_040);
    });

    it('follows the surplus downwards while it still covers the lowest power', () => {
        const runtime = runtimeOf({ appliedPowerW: 6900, lastChange: T0 - 30 * MINUTE }, 'wallbox');
        // The house eats 1000 W of what the wallbox had: two amperes per phase have to go back.
        const plan = allocate(cfg, snapshot(1000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(5520);
        expect(plan.consumers[0].state).to.equal('running');
    });

    it('throttles to the lowest power instead of stopping inside the minimum runtime', () => {
        const runtime = runtimeOf({ appliedPowerW: 6900, lastChange: T0 - MINUTE }, 'wallbox');
        const plan = allocate(cfg, snapshot(3000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(4140);
        expect(plan.consumers[0].state).to.equal('committed');
    });

    it('stops once the budget no longer covers the lowest power and the minimum runtime is over', () => {
        const runtime = runtimeOf({ appliedPowerW: 6900, lastChange: T0 - 30 * MINUTE }, 'wallbox');
        const plan = allocate(cfg, snapshot(4000, ['wallbox']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(0);
        expect(plan.consumers[0].state).to.equal('off');
    });

    it('hands out every watt when the device modulates continuously', () => {
        const heater = consumer({ key: 'heater', nominalPowerW: 2000, minPowerW: 500, stepW: 0 });
        const runtime = runtimeOf({ appliedPowerW: 500, lastChange: T0 - 30 * MINUTE }, 'heater');
        const plan = allocate(config([heater]), snapshot(-734, ['heater']), runtime);
        expect(plan.consumers[0].proposedPowerW).to.equal(1234);
    });
});

describe('worthWriting', () => {
    it('always writes the change between running and not running', () => {
        expect(worthWriting(wallbox(), 0, 4140)).to.equal(true);
        expect(worthWriting(wallbox(), 6900, 0)).to.equal(true);
    });

    it('leaves a modulating target alone while the change is smaller than one step', () => {
        expect(worthWriting(wallbox(), 4140, 4600)).to.equal(false);
        expect(worthWriting(wallbox(), 4140, 4830)).to.equal(true);
    });

    it('keeps a dead band for a device without steps', () => {
        const heater = consumer({ nominalPowerW: 2000, minPowerW: 500, stepW: 0 });
        expect(worthWriting(heater, 1000, 1050)).to.equal(false);
        expect(worthWriting(heater, 1000, 1100)).to.equal(true);
    });
});
