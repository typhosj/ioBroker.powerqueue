import { expect } from 'chai';
import {
    DEFAULT_CONSUMER,
    DEFAULT_NATIVE,
    newConsumerKey,
    normalizeNative,
    subscribedIds,
    targetValue,
    toDomainConfig,
    validateNative,
    type NativeConfig,
    type NativeConsumer,
} from './config';
import { PLAN_REASON_TEXT } from './reasons';
import { allocate } from './allocator';

function usable(overrides: Partial<NativeConfig> = {}): NativeConfig {
    return {
        ...DEFAULT_NATIVE,
        gridPowerId: 'goodwe.0.grid.power',
        gridConfirmed: true,
        consumers: [
            { ...DEFAULT_CONSUMER, key: 'c1', name: 'Pool pump', targetId: 'shelly.0.pump', nominalPowerW: 1000 },
        ],
        ...overrides,
    };
}

function fields(native: NativeConfig): string[] {
    return validateNative(native).map(problem => problem.field);
}

describe('normalizeNative', () => {
    it('survives the empty consumer list the object database hands back as an object', () => {
        expect(normalizeNative({ ...DEFAULT_NATIVE, consumers: {} }).consumers).to.deep.equal([]);
    });

    it('gives a device stored before this version the switch it always was', () => {
        const stored = {
            consumers: [{ key: 'c1', name: 'Pool pump', targetId: 'shelly.0.pump', nominalPowerW: 1000 }],
        };
        expect(normalizeNative(stored).consumers[0]).to.include({ targetUnit: 'switch', minPowerW: 0, stepW: 0 });
    });

    it('fills in fields an older instance never stored', () => {
        expect(normalizeNative({ gridPowerId: 'goodwe.0.grid.power' })).to.deep.equal({
            ...DEFAULT_NATIVE,
            gridPowerId: 'goodwe.0.grid.power',
        });
    });
});

describe('validateNative', () => {
    it('accepts a complete minimal configuration', () => {
        expect(validateNative(usable())).to.deep.equal([]);
    });

    it('rejects the untouched defaults, because no grid meter is selected', () => {
        expect(fields(DEFAULT_NATIVE)).to.deep.equal(['gridPowerId']);
    });

    it('insists on the confirmed sign before the configuration is usable', () => {
        expect(fields(usable({ gridConfirmed: false }))).to.deep.equal(['gridConfirmed']);
    });

    it('bounds object IDs instead of subscribing to anything', () => {
        expect(fields(usable({ gridPowerId: 'shelly.0.*' }))).to.deep.equal(['gridPowerId']);
        expect(fields(usable({ gridPowerId: `x.0.${'y'.repeat(300)}` }))).to.deep.equal(['gridPowerId']);
    });

    it('asks for the battery sentence only when a battery is configured', () => {
        expect(fields(usable({ batteryPowerId: '' }))).to.deep.equal([]);
        expect(fields(usable({ batteryPowerId: 'goodwe.0.battery.power' }))).to.deep.equal(['batteryConfirmed']);
    });

    it('rejects a smoothing window longer than the accepted age of a reading', () => {
        expect(fields(usable({ smoothingSeconds: 600, maxAgeSeconds: 300 }))).to.deep.equal(['smoothingSeconds']);
    });

    it('rejects an impossible minimum charge level', () => {
        expect(fields(usable({ batterySocId: 'goodwe.0.battery.soc', minBatterySoc: 120 }))).to.deep.equal([
            'minBatterySoc',
        ]);
    });

    it('checks the availability condition only when one is configured', () => {
        const consumer = { ...usable().consumers[0], availabilityId: 'javascript.0.*' };
        expect(fields(usable({ consumers: [{ ...consumer, availabilityId: '' }] }))).to.deep.equal([]);
        expect(fields(usable({ consumers: [consumer] }))).to.deep.equal(['consumers']);
    });

    it('names the device in every consumer problem', () => {
        const problems = validateNative(usable({ consumers: [{ ...DEFAULT_CONSUMER, key: 'c1', name: 'Pool pump' }] }));
        expect(problems.map(problem => problem.consumerKey)).to.deep.equal(['c1', 'c1']);
        // The name is an argument, so the message itself stays translatable.
        expect(problems.every(problem => problem.message.includes('"%s"'))).to.equal(true);
        expect(problems.every(problem => problem.args?.[0] === 'Pool pump')).to.equal(true);
    });

    it('catches duplicate consumer keys', () => {
        const consumer = { ...DEFAULT_CONSUMER, key: 'c1', name: 'Pump', targetId: 'shelly.0.a', nominalPowerW: 500 };
        const problems = validateNative(usable({ consumers: [consumer, { ...consumer }] }));
        expect(problems).to.have.length(1);
        expect(problems[0].message).to.contain('internal key');
    });
});

describe('toDomainConfig', () => {
    it('converts minutes and seconds into the milliseconds the allocator uses', () => {
        const domain = toDomainConfig(
            usable({
                maxAgeSeconds: 300,
                smoothingSeconds: 60,
                consumers: [
                    {
                        ...DEFAULT_CONSUMER,
                        key: 'c1',
                        name: 'Pool pump',
                        targetId: 'shelly.0.pump',
                        nominalPowerW: 1000,
                        minOnMinutes: 15,
                        minOffMinutes: 5,
                    },
                ],
            }),
        );
        expect(domain.energy.maxAgeMs).to.equal(300_000);
        expect(domain.energy.smoothingWindowMs).to.equal(60_000);
        expect(domain.consumers[0].minOnMs).to.equal(900_000);
        expect(domain.consumers[0].minOffMs).to.equal(300_000);
        // Binary consumers have exactly one safe output.
        expect(domain.consumers[0].safeOutputW).to.equal(0);
    });

    it('ignores a minimum charge level without a charge level state', () => {
        expect(toDomainConfig(usable({ minBatterySoc: 30 })).energy.minBatterySoc).to.equal(null);
        expect(
            toDomainConfig(usable({ minBatterySoc: 30, batterySocId: 'goodwe.0.soc' })).energy.minBatterySoc,
        ).to.equal(30);
    });

    it('produces a configuration the allocator accepts', () => {
        const now = Date.parse('2026-08-09T12:00:00Z');
        const plan = allocate(
            toDomainConfig(usable()),
            {
                now,
                grid: [{ value: -2000, ts: now }],
                batteryPower: null,
                batterySoc: null,
                consumers: { c1: { available: true, actualPowerW: null } },
            },
            {},
        );
        expect(plan.valid).to.equal(true);
        expect(plan.consumers[0].proposedPowerW).to.equal(1000);
        expect(PLAN_REASON_TEXT[plan.reason]).to.be.a('string');
    });
});

describe('subscribedIds', () => {
    it('collects every configured object exactly once and drops the empty ones', () => {
        const native = usable({
            batteryPowerId: 'goodwe.0.battery.power',
            batteryConfirmed: true,
            consumers: [
                {
                    ...DEFAULT_CONSUMER,
                    key: 'a',
                    targetId: 'shelly.0.pump',
                    feedbackId: 'shelly.0.pump.power',
                    availabilityId: 'javascript.0.holiday',
                },
                { ...DEFAULT_CONSUMER, key: 'b', targetId: 'shelly.0.pump', feedbackId: '', availabilityId: '' },
            ],
        });
        expect(subscribedIds(native)).to.deep.equal([
            'goodwe.0.grid.power',
            'goodwe.0.battery.power',
            'shelly.0.pump',
            'shelly.0.pump.power',
            'javascript.0.holiday',
        ]);
    });
});

describe('newConsumerKey', () => {
    it('does not repeat itself', () => {
        const keys = new Set(Array.from({ length: 100 }, () => newConsumerKey()));
        expect(keys.size).to.equal(100);
    });
});

/** A three-phase wallbox that is told its charging current in amperes. */
function wallbox(overrides: Partial<NativeConsumer> = {}): NativeConsumer {
    return {
        ...DEFAULT_CONSUMER,
        key: 'wb',
        name: 'Wallbox',
        targetId: 'wallbox.0.current',
        nominalPowerW: 11_040,
        minPowerW: 4140,
        stepW: 690,
        targetUnit: 'ampere',
        phases: 3,
        voltageV: 230,
        ...overrides,
    };
}

describe('modulating configuration', () => {
    it('accepts a fully configured wallbox', () => {
        expect(validateNative(usable({ consumers: [wallbox()] }))).to.deep.equal([]);
    });

    it('insists on a lowest power a modulating device can actually run at', () => {
        expect(fields(usable({ consumers: [wallbox({ minPowerW: 0 })] }))).to.deep.equal(['consumers']);
        expect(fields(usable({ consumers: [wallbox({ minPowerW: 20_000 })] }))).to.deep.equal(['consumers']);
    });

    it('needs phases and voltage before it hands out a charging current', () => {
        expect(fields(usable({ consumers: [wallbox({ voltageV: 0 })] }))).to.deep.equal(['consumers']);
    });

    it('gives a plain switch exactly one power, whatever else is stored', () => {
        const stored = usable({ consumers: [wallbox({ targetUnit: 'switch' })] });
        expect(toDomainConfig(stored).consumers[0]).to.include({ minPowerW: 11_040, stepW: 0 });
    });
});

describe('targetValue', () => {
    it('turns the granted power into whole amperes per phase', () => {
        expect(targetValue(wallbox(), 4140)).to.equal(6);
        expect(targetValue(wallbox(), 11_040)).to.equal(16);
        expect(targetValue(wallbox(), 0)).to.equal(0);
    });

    it('rounds the current instead of truncating it, so 6 A stays 6 A on a real mains voltage', () => {
        expect(targetValue(wallbox({ voltageV: 235 }), 4140)).to.equal(6);
    });

    it('expresses a percentage against the maximum power of the device', () => {
        const heater = wallbox({ targetUnit: 'percent', nominalPowerW: 2000, minPowerW: 500 });
        expect(targetValue(heater, 500)).to.equal(25);
        expect(targetValue(heater, 3000)).to.equal(100);
    });

    it('gives a plain switch a boolean, not a number', () => {
        expect(targetValue(DEFAULT_CONSUMER as NativeConsumer, 1000)).to.equal(true);
        expect(targetValue(DEFAULT_CONSUMER as NativeConsumer, 0)).to.equal(false);
    });
});
