/**
 * The configuration the user edits (`io-package.json` → `native`) and its translation into the
 * domain configuration the allocator works with.
 *
 * The admin UI and the runtime use this module, never their own copy: the UI must not be able to
 * save something the runtime then interprets differently, and the runtime validates again anyway.
 */

import type { Config, ConsumerConfig, Mode } from './types';

/**
 * How the target state of a device expects to be told what to do.
 *
 * `switch` is a device that can only run or not run. The other three are modulating devices: a
 * wallbox usually takes amperes per phase, a heating element a percentage, a few adapters watts.
 */
export type TargetUnit = 'switch' | 'watt' | 'ampere' | 'percent';

/** One consumer as stored in the adapter configuration. Times are minutes, power is watts. */
export interface NativeConsumer {
    /** Generated once when the consumer is created; never derived from the name. */
    key: string;
    name: string;
    /** Writable switch that PowerQueue turns on and off. */
    targetId: string;
    /** Optional measured value of the consumer. Empty when the device does not report one. */
    feedbackId: string;
    /**
     * What {@link NativeConsumer.feedbackId} measures. A wallbox often reports only the charging
     * current, and a current says nothing about power until the phases and the voltage are known.
     */
    feedbackUnit: 'watt' | 'ampere';
    /**
     * Optional condition that has to hold before the device may run at all — a door contact, a
     * holiday switch, a "the car is plugged in" state. Missing means the device is always usable.
     */
    availabilityId?: string;
    /** Which value of {@link NativeConsumer.availabilityId} means "may run". Defaults to `true`. */
    availableWhen?: boolean;
    /** The power the device draws; for a modulating device its maximum. */
    nominalPowerW: number;
    /**
     * Lowest power a modulating device can run at. Below it the device is switched off instead: a
     * car may not charge below 6 A per phase, and a pump below its floor only heats itself.
     */
    minPowerW: number;
    /** Granularity the device can follow. `0` is continuous; a wallbox steps by 1 A per phase. */
    stepW: number;
    /** How {@link NativeConsumer.targetId} expects the power. */
    targetUnit: TargetUnit;
    /** Phases the device draws on, needed to turn watts into amperes. */
    phases: number;
    /** Mains voltage used for the same conversion. Nominal 230 V is rarely what the house has. */
    voltageV: number;
    minOnMinutes: number;
    minOffMinutes: number;
    enabled: boolean;
    /** Consent to actually write `targetId`. Without it PowerQueue only proposes. */
    armed: boolean;
    priority: number;
}

/** The full adapter configuration. */
export interface NativeConfig {
    mode: Mode;
    gridPowerId: string;
    /** Derived from the sentence the user confirmed, never entered as a convention. */
    gridImportPositive: boolean;
    /** `true` once the user has confirmed a sentence for the grid reading. */
    gridConfirmed: boolean;
    batteryPowerId: string;
    batteryChargePositive: boolean;
    batteryConfirmed: boolean;
    batterySocId: string;
    /** Below this state of charge nothing is allocated. `null` disables the constraint. */
    minBatterySoc: number | null;
    reserveW: number;
    /** Readings older than this are treated as missing. */
    maxAgeSeconds: number;
    /** Grid readings are averaged over this window. */
    smoothingSeconds: number;
    consumers: NativeConsumer[];
}

export const DEFAULT_NATIVE: NativeConfig = {
    mode: 'observe',
    gridPowerId: '',
    gridImportPositive: true,
    gridConfirmed: false,
    batteryPowerId: '',
    batteryChargePositive: true,
    batteryConfirmed: false,
    batterySocId: '',
    minBatterySoc: null,
    reserveW: 200,
    maxAgeSeconds: 300,
    smoothingSeconds: 60,
    consumers: [],
};

export const DEFAULT_CONSUMER: Omit<NativeConsumer, 'key'> = {
    name: '',
    targetId: '',
    feedbackId: '',
    feedbackUnit: 'watt',
    availabilityId: '',
    availableWhen: true,
    nominalPowerW: 0,
    minPowerW: 0,
    stepW: 0,
    targetUnit: 'switch',
    phases: 1,
    voltageV: 230,
    minOnMinutes: 10,
    minOffMinutes: 10,
    enabled: true,
    armed: false,
    priority: 1,
};

/**
 * Repair what the object database hands back.
 *
 * A stored configuration is not a `NativeConfig` just because it was one when it was saved: an
 * empty `consumers` array comes back as an empty object, and an instance that predates a field has
 * no value for it at all — a device stored before this version knows nothing about being modulating.
 * Everything that reads the configuration goes through here first.
 *
 * @param stored - the configuration as it was read from the instance object
 * @returns a configuration with every field present and `consumers` guaranteed to be an array
 */
export function normalizeNative(stored: unknown): NativeConfig {
    const native = { ...DEFAULT_NATIVE, ...(stored as Partial<NativeConfig>) };
    const consumers = Array.isArray(native.consumers) ? native.consumers : [];
    return { ...native, consumers: consumers.map(consumer => ({ ...DEFAULT_CONSUMER, ...consumer })) };
}

/**
 * A validation problem, phrased as the household consequence rather than as a field error.
 *
 * `consumerKey` is set when the problem belongs to one consumer, so the UI can point at it.
 */
export interface ConfigProblem {
    field: string;
    consumerKey?: string;
    /** English translation source. `%s` placeholders are filled from {@link ConfigProblem.args}. */
    message: string;
    /** Values for the placeholders — kept apart so the message stays translatable. */
    args?: string[];
}

/** Upper bound for an object ID, so a pasted document cannot become a subscription. */
const MAX_ID_LENGTH = 256;

/**
 * @param id - object ID from the configuration
 * @returns whether the ID is a usable, bounded ioBroker object ID
 */
function isValidId(id: string): boolean {
    return id.length > 0 && id.length <= MAX_ID_LENGTH && !/[\s*?[\]]/.test(id);
}

/**
 * Check a configuration before it is saved and again before it is used.
 *
 * @param native - the configuration to check
 * @returns every problem found; an empty array means the configuration is usable
 */
export function validateNative(native: NativeConfig): ConfigProblem[] {
    const problems: ConfigProblem[] = [];

    if (!isValidId(native.gridPowerId)) {
        problems.push({
            field: 'gridPowerId',
            message: 'PowerQueue needs to know how much power your house draws from the grid.',
        });
    } else if (!native.gridConfirmed) {
        problems.push({
            field: 'gridConfirmed',
            message: 'Confirm which sentence matches your grid meter, otherwise the sign may be inverted.',
        });
    }

    if (native.batteryPowerId && !isValidId(native.batteryPowerId)) {
        problems.push({ field: 'batteryPowerId', message: 'The battery power state is not a usable object ID.' });
    } else if (native.batteryPowerId && !native.batteryConfirmed) {
        problems.push({
            field: 'batteryConfirmed',
            message: 'Confirm which sentence matches your battery, otherwise charging and discharging are swapped.',
        });
    }

    if (native.batterySocId && !isValidId(native.batterySocId)) {
        problems.push({ field: 'batterySocId', message: 'The battery charge level state is not a usable object ID.' });
    }

    if (native.minBatterySoc !== null && (native.minBatterySoc < 0 || native.minBatterySoc > 100)) {
        problems.push({
            field: 'minBatterySoc',
            message: 'The minimum battery charge level must be between 0 and 100 %.',
        });
    }

    if (!(native.reserveW >= 0) || !Number.isFinite(native.reserveW)) {
        problems.push({ field: 'reserveW', message: 'The reserve must be zero or a positive number of watts.' });
    }

    if (!(native.maxAgeSeconds > 0)) {
        problems.push({ field: 'maxAgeSeconds', message: 'PowerQueue must know when a reading is too old to trust.' });
    }

    if (!(native.smoothingSeconds >= 0) || native.smoothingSeconds > native.maxAgeSeconds) {
        problems.push({
            field: 'smoothingSeconds',
            message: 'The averaging period cannot be longer than the age at which a reading is discarded.',
        });
    }

    const seen = new Set<string>();
    for (const consumer of native.consumers) {
        // The device name is an argument, never part of the message, so the sentence stays
        // translatable.
        const where = { field: 'consumers', consumerKey: consumer.key, args: [consumer.name] };
        if (seen.has(consumer.key)) {
            problems.push({ ...where, message: 'Two devices share the same internal key.' });
        }
        seen.add(consumer.key);

        if (!consumer.name.trim()) {
            problems.push({ ...where, message: 'Give the device a name you recognise.' });
        }
        if (!isValidId(consumer.targetId)) {
            problems.push({ ...where, message: 'PowerQueue needs the switch it may turn on for "%s".' });
        }
        if (consumer.feedbackId && !isValidId(consumer.feedbackId)) {
            problems.push({ ...where, message: 'The measured power state of "%s" is not usable.' });
        }
        if (consumer.availabilityId && !isValidId(consumer.availabilityId)) {
            problems.push({ ...where, message: 'The state that says when "%s" may run is not usable.' });
        }
        if (!(consumer.nominalPowerW > 0)) {
            problems.push({ ...where, message: 'PowerQueue needs to know how much power "%s" uses.' });
        }
        if (consumer.targetUnit !== 'switch') {
            if (!(consumer.minPowerW > 0) || consumer.minPowerW > consumer.nominalPowerW) {
                problems.push({
                    ...where,
                    message: 'The lowest power of "%s" must be above zero and at most its maximum power.',
                });
            }
            if (!(consumer.stepW >= 0)) {
                problems.push({ ...where, message: 'The step size of "%s" cannot be negative.' });
            }
        }
        const usesCurrent = consumer.targetUnit === 'ampere' || consumer.feedbackUnit === 'ampere';
        if (usesCurrent && (!(consumer.phases >= 1) || !(consumer.voltageV > 0))) {
            problems.push({
                ...where,
                message: 'To set a charging current PowerQueue needs the phases and the voltage of "%s".',
            });
        }
        if (!(consumer.minOnMinutes >= 0) || !(consumer.minOffMinutes >= 0)) {
            problems.push({ ...where, message: 'The switching times of "%s" cannot be negative.' });
        }
        if (!Number.isInteger(consumer.priority)) {
            problems.push({ ...where, message: 'The priority of "%s" must be a whole number.' });
        }
    }

    return problems;
}

const MINUTE_MS = 60_000;

/**
 * The floor the allocator has to respect.
 *
 * A device that can only be switched has exactly one power, so its floor is its nominal power and
 * the whole modulating path collapses into the on/off case. A floor above the maximum would stop
 * the device from ever running, so it is treated as no floor at all rather than as a lockout.
 *
 * @param consumer - the stored consumer
 * @returns the lowest power the allocator may propose
 */
function lowestPowerW(consumer: NativeConsumer): number {
    const floor = consumer.targetUnit === 'switch' ? 0 : consumer.minPowerW;
    return floor > 0 && floor <= consumer.nominalPowerW ? floor : consumer.nominalPowerW;
}

/**
 * What the unit of a state says about the value behind it.
 *
 * Only units that mean exactly one thing are answered, so the question is asked only where it
 * really is open. `kW` is deliberately not among them: reading it as watts is wrong by a factor of
 * a thousand, and a silent wrong guess is worse than a question.
 *
 * @param unit - `common.unit` of the selected state
 * @returns what the state is measured in, or `null` when the unit does not say
 */
export function unitOf(unit: string | undefined): TargetUnit | null {
    switch ((unit ?? '').trim().toLowerCase()) {
        case 'a':
        case 'amp':
        case 'amps':
        case 'ampere':
            return 'ampere';
        case 'w':
        case 'watt':
        case 'watts':
            return 'watt';
        case '%':
        case 'percent':
            return 'percent';
        default:
            return null;
    }
}

/**
 * Translate what a device reports into watts.
 *
 * @param consumer - the stored consumer
 * @param value - the measured value, in whatever unit the device reports
 * @returns the measured power in watts
 */
export function feedbackWatts(consumer: NativeConsumer, value: number): number {
    return consumer.feedbackUnit === 'ampere' ? value * consumer.phases * consumer.voltageV : value;
}

/**
 * Translate the power the allocator granted into the value the target state expects.
 *
 * @param consumer - the stored consumer
 * @param watts - the power PowerQueue wants the device to draw
 * @returns the value to write; a boolean only for a plain switch
 */
export function targetValue(consumer: NativeConsumer, watts: number): number | boolean {
    switch (consumer.targetUnit) {
        case 'watt':
            return Math.max(0, Math.round(watts));
        case 'ampere':
            // Rounded, not truncated: 1380 W measured at 235 V is 5.87 A, and truncating that would
            // command 5 A — below the 6 A per phase a car is allowed to charge with at all.
            return watts <= 0 ? 0 : Math.round(watts / (consumer.phases * consumer.voltageV));
        case 'percent':
            return watts <= 0 ? 0 : Math.min(100, Math.round((watts / consumer.nominalPowerW) * 100));
        default:
            return watts > 0;
    }
}

/**
 * Translate the stored configuration into what the allocator understands.
 *
 * Binary consumers have exactly one safe output — off — so it is not a setting.
 *
 * @param native - the stored configuration
 * @returns the domain configuration
 */
export function toDomainConfig(native: NativeConfig): Config {
    return {
        mode: native.mode,
        energy: {
            gridImportPositive: native.gridImportPositive,
            batteryChargePositive: native.batteryChargePositive,
            reserveW: native.reserveW,
            maxAgeMs: native.maxAgeSeconds * 1000,
            smoothingWindowMs: native.smoothingSeconds * 1000,
            minBatterySoc: native.batterySocId ? native.minBatterySoc : null,
        },
        consumers: native.consumers.map((consumer): ConsumerConfig => ({
            key: consumer.key,
            name: consumer.name,
            enabled: consumer.enabled,
            armed: consumer.armed,
            priority: consumer.priority,
            nominalPowerW: consumer.nominalPowerW,
            minPowerW: lowestPowerW(consumer),
            stepW: consumer.targetUnit === 'switch' ? 0 : Math.max(consumer.stepW, 0),
            minOnMs: consumer.minOnMinutes * MINUTE_MS,
            minOffMs: consumer.minOffMinutes * MINUTE_MS,
            safeOutputW: 0,
        })),
    };
}

/**
 * Every foreign state the adapter has to watch. Used for the subscriptions and to check that no
 * unconfigured object is ever touched.
 *
 * @param native - the stored configuration
 * @returns the object IDs, without duplicates
 */
export function subscribedIds(native: NativeConfig): string[] {
    const ids = [native.gridPowerId, native.batteryPowerId, native.batterySocId];
    for (const consumer of native.consumers) {
        ids.push(consumer.targetId, consumer.feedbackId, consumer.availabilityId ?? '');
    }
    return [...new Set(ids.filter(isValidId))];
}

/**
 * @returns a stable key for a new consumer
 */
export function newConsumerKey(): string {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
