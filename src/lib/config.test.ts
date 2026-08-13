import { expect } from 'chai';
import {
    DEFAULT_CONSUMER,
    DEFAULT_NATIVE,
    newConsumerKey,
    subscribedIds,
    toDomainConfig,
    validateNative,
    type NativeConfig,
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
