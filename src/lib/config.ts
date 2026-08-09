/**
 * The configuration the user edits (`io-package.json` → `native`) and its translation into the
 * domain configuration the allocator works with.
 *
 * The admin UI and the runtime use this module, never their own copy: the UI must not be able to
 * save something the runtime then interprets differently, and the runtime validates again anyway.
 */

import type { Config, ConsumerConfig, Mode } from './types';

/** One consumer as stored in the adapter configuration. Times are minutes, power is watts. */
export interface NativeConsumer {
    /** Generated once when the consumer is created; never derived from the name. */
    key: string;
    name: string;
    /** Writable switch that PowerQueue turns on and off. */
    targetId: string;
    /** Optional measured power of the consumer. Empty when the device does not report it. */
    feedbackId: string;
    nominalPowerW: number;
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
    nominalPowerW: 0,
    minOnMinutes: 10,
    minOffMinutes: 10,
    enabled: true,
    armed: false,
    priority: 1,
};

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
        if (!(consumer.nominalPowerW > 0)) {
            problems.push({ ...where, message: 'PowerQueue needs to know how much power "%s" uses.' });
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
        ids.push(consumer.targetId, consumer.feedbackId);
    }
    return [...new Set(ids.filter(isValidId))];
}

/**
 * @returns a stable key for a new consumer
 */
export function newConsumerKey(): string {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
