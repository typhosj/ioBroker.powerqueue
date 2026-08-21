/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';

import { allocate, applyPlan, emptyRuntime, nextMidnight, pruneSamples, worthWriting } from './lib/allocator';
import {
    normalizeNative,
    subscribedIds,
    targetValue,
    toDomainConfig,
    validateNative,
    type NativeConfig,
    type NativeConsumer,
} from './lib/config';
import { CONSUMER_REASON_TEXT, CONSUMER_STATE_TEXT, PLAN_REASON_TEXT } from './lib/reasons';
import type { Budget, Config, Plan, Runtime, Sample, Snapshot } from './lib/types';

/**
 * How often a plan is calculated. Fast enough for minimum on/off times measured in minutes, slow
 * enough to stay invisible in the log and in the states database.
 */
const EVALUATION_INTERVAL_MS = 5_000;

/** One published state. The same list creates the object and fills it. */
interface StateDefinition {
    id: string;
    name: string;
    type: ioBroker.CommonType;
    role: string;
    unit?: string;
}

const PLAN_STATES: StateDefinition[] = [
    { id: 'valid', name: 'Plan is usable', type: 'boolean', role: 'indicator' },
    { id: 'reason', name: 'Reason code', type: 'string', role: 'text' },
    { id: 'reasonText', name: 'Reason', type: 'string', role: 'text' },
    { id: 'updated', name: 'Last evaluation', type: 'number', role: 'value.time' },
];

/** The budget waterfall. The ids are the keys of {@link Budget}, so the two cannot drift apart. */
const BUDGET_STATES: (StateDefinition & { id: keyof Budget })[] = [
    { id: 'gridPowerW', name: 'Grid power (import positive)', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'batteryPowerW', name: 'Battery power (charging positive)', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'batterySoc', name: 'Battery charge level', type: 'number', role: 'value.battery', unit: '%' },
    { id: 'surplusW', name: 'Surplus power', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'reserveW', name: 'Reserve', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'availableW', name: 'Distributable power', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'allocatedW', name: 'Allocated power', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'remainingW', name: 'Unallocated power', type: 'number', role: 'value.power', unit: 'W' },
];

const CONSUMER_STATES: StateDefinition[] = [
    { id: 'state', name: 'State', type: 'string', role: 'text' },
    { id: 'stateText', name: 'State in words', type: 'string', role: 'text' },
    { id: 'reason', name: 'Reason code', type: 'string', role: 'text' },
    { id: 'reasonText', name: 'Reason', type: 'string', role: 'text' },
    { id: 'proposedPowerW', name: 'Proposed power', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'appliedPowerW', name: 'Applied power', type: 'number', role: 'value.power', unit: 'W' },
    { id: 'runtimeTodayS', name: 'Runtime today', type: 'number', role: 'value.interval', unit: 's' },
    { id: 'lastChange', name: 'Last change', type: 'number', role: 'value.time' },
    { id: 'overrideUntil', name: 'Manually controlled until', type: 'number', role: 'value.time' },
];

/**
 * @param state - a state read from ioBroker
 * @returns the numeric reading with the timestamp ioBroker reported, or `null` when unusable
 */
function sampleOf(state: ioBroker.State | null | undefined): Sample | null {
    return state && typeof state.val === 'number' && Number.isFinite(state.val)
        ? { value: state.val, ts: state.ts }
        : null;
}

/**
 * PowerQueue distributes an available electrical power budget among prioritized consumers.
 *
 * This class is only the shell around the pure core: it collects readings into a snapshot, hands
 * them to {@link allocate}, writes the targets it is allowed to write and publishes the plan. Every
 * decision lives in `lib/allocator.ts`, so it can be tested without ioBroker.
 */
class Powerqueue extends utils.Adapter {
    private native!: NativeConfig;
    private domain!: Config;

    private grid: Sample[] = [];
    private batteryPower: Sample | null = null;
    private batterySoc: Sample | null = null;
    /** Measured power per consumer key, for the consumers that report it. */
    private readonly feedback = new Map<string, Sample>();
    /** Availability per consumer key, for the consumers that have a condition configured. */
    private readonly availability = new Map<string, boolean>();

    private runtime: Runtime = {};
    private lastEvaluation: number | null = null;
    private evaluating = false;
    private timer?: ioBroker.Interval;
    /** Last published value per state, so an unchanged plan does not write anything. */
    private readonly published = new Map<string, ioBroker.StateValue>();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'powerqueue',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        this.native = normalizeNative(this.config);

        const problems = validateNative(this.native);
        if (problems.length) {
            // An incomplete configuration is a setup step, not a crash: stay idle and say what is
            // missing, so the admin UI keeps working.
            await this.setState('info.connection', false, true);
            // A freshly installed instance is unconfigured by definition, so this is a warning and
            // not an error: nothing is broken, something is missing.
            this.log.warn(`PowerQueue is not ready yet: ${problems[0].message}`);
            return;
        }

        this.domain = toDomainConfig(this.native);
        await this.createStates();
        await this.restoreRuntime();
        await this.readInputs();

        for (const id of subscribedIds(this.native)) {
            await this.subscribeForeignStatesAsync(id);
        }

        this.timer = this.setInterval(() => void this.evaluate(), EVALUATION_INTERVAL_MS);
        await this.evaluate();

        this.log.info(
            `PowerQueue started in mode "${this.native.mode}" with ${this.native.consumers.length} device(s)`,
        );
    }

    /**
     * Create the published objects and remove what a former configuration left behind.
     */
    private async createStates(): Promise<void> {
        for (const [id, name] of [
            ['plan', 'Current plan'],
            ['budget', 'Power budget'],
            ['consumers', 'Devices'],
        ]) {
            await this.extendObjectAsync(id, { type: 'channel', common: { name }, native: {} });
        }

        for (const definition of PLAN_STATES) {
            await this.defineState(`plan.${definition.id}`, definition);
        }
        for (const definition of BUDGET_STATES) {
            await this.defineState(`budget.${definition.id}`, definition);
        }

        const keys = new Set<string>();
        for (const consumer of this.native.consumers) {
            keys.add(consumer.key);
            // `extendObject` instead of `setObjectNotExists`: a renamed device has to be renamed here too.
            await this.extendObjectAsync(`consumers.${consumer.key}`, {
                type: 'channel',
                common: { name: consumer.name },
                native: {},
            });
            for (const definition of CONSUMER_STATES) {
                await this.defineState(`consumers.${consumer.key}.${definition.id}`, definition);
            }
        }

        const prefix = `${this.namespace}.consumers.`;
        for (const id of Object.keys(await this.getAdapterObjectsAsync())) {
            const key = id.startsWith(prefix) ? id.slice(prefix.length).split('.')[0] : null;
            if (key && !keys.has(key)) {
                // A device the user deleted must not keep showing a state it can no longer reach.
                await this.delObjectAsync(`consumers.${key}`, { recursive: true });
            }
        }
    }

    /**
     * @param id - object ID relative to the adapter namespace
     * @param definition - what the state contains
     */
    private async defineState(id: string, definition: StateDefinition): Promise<void> {
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name: definition.name,
                type: definition.type,
                role: definition.role,
                unit: definition.unit,
                read: true,
                write: false,
            },
            native: {},
        });
    }

    /**
     * Restore the runtime state from the adapter's own states, so a restart does not forget that a
     * device is running or waiting out a minimum time.
     */
    private async restoreRuntime(): Promise<void> {
        for (const consumer of this.native.consumers) {
            const base = `consumers.${consumer.key}`;
            const overrideUntil = await this.readNumber(`${base}.overrideUntil`);
            this.runtime[consumer.key] = {
                appliedPowerW: (await this.readNumber(`${base}.appliedPowerW`)) ?? 0,
                lastChange: (await this.readNumber(`${base}.lastChange`)) ?? 0,
                runtimeTodayS: (await this.readNumber(`${base}.runtimeTodayS`)) ?? 0,
                overrideUntil,
            };
        }
    }

    /**
     * @param id - object ID relative to the adapter namespace
     * @returns the stored number, or `null` when the state is empty or not numeric
     */
    private async readNumber(id: string): Promise<number | null> {
        const state = await this.getStateAsync(id);
        return typeof state?.val === 'number' ? state.val : null;
    }

    /**
     * Seed the inputs with the values that already exist, so the first plan does not have to wait
     * for every source to report once.
     */
    private async readInputs(): Promise<void> {
        const grid = sampleOf(await this.getForeignStateAsync(this.native.gridPowerId));
        this.grid = grid ? [grid] : [];

        if (this.native.batteryPowerId) {
            this.batteryPower = sampleOf(await this.getForeignStateAsync(this.native.batteryPowerId));
        }
        if (this.native.batterySocId) {
            this.batterySoc = sampleOf(await this.getForeignStateAsync(this.native.batterySocId));
        }
        for (const consumer of this.native.consumers) {
            if (consumer.feedbackId) {
                const feedback = sampleOf(await this.getForeignStateAsync(consumer.feedbackId));
                if (feedback) {
                    this.feedback.set(consumer.key, feedback);
                }
            }
            if (consumer.availabilityId) {
                this.noteAvailability(consumer, await this.getForeignStateAsync(consumer.availabilityId));
            }
        }
    }

    /**
     * Is called if a subscribed state changes.
     *
     * @param id - object ID of the changed state
     * @param state - the new state
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || !this.domain) {
            return;
        }
        const sample = sampleOf(state);

        if (id === this.native.gridPowerId && sample) {
            this.grid = pruneSamples([...this.grid, sample], Date.now(), this.domain.energy.smoothingWindowMs);
        }
        if (id === this.native.batteryPowerId && sample) {
            this.batteryPower = sample;
        }
        if (id === this.native.batterySocId && sample) {
            this.batterySoc = sample;
        }

        for (const consumer of this.native.consumers) {
            if (consumer.feedbackId === id && sample) {
                this.feedback.set(consumer.key, sample);
            }
            if (consumer.availabilityId === id) {
                this.noteAvailability(consumer, state);
            }
            if (consumer.targetId === id) {
                this.noteExternalWrite(consumer, state);
            }
        }
    }

    /**
     * @param consumer - the consumer whose condition was read
     * @param state - the state of the condition, `null` when it could not be read
     */
    private noteAvailability(consumer: NativeConsumer, state: ioBroker.State | null | undefined): void {
        // An unreadable condition means the device stays out of the plan: a condition the user
        // configured is a reason not to run, not a formality to skip when it is missing.
        const available =
            state?.val === null || state?.val === undefined
                ? false
                : Boolean(state.val) === (consumer.availableWhen ?? true);
        this.availability.set(consumer.key, available);
    }

    /**
     * Hand a device over to whoever switched it. PowerQueue never writes the target again until the
     * override expires — that is the promise the adapter makes about manual control.
     *
     * @param consumer - the consumer whose target was written
     * @param state - the state change that was seen
     */
    private noteExternalWrite(consumer: NativeConsumer, state: ioBroker.State): void {
        // Only commands count. An acknowledged value is the device reporting back, including the
        // acknowledgement of PowerQueue's own write.
        // ponytail: a switch flipped physically on the device only produces an ack and is therefore
        // not detected; compare acknowledged values against the applied target if that matters.
        if (state.ack || state.from === `system.adapter.${this.namespace}`) {
            return;
        }
        if (this.native.mode !== 'control' || !consumer.armed) {
            return;
        }

        const runtime = this.runtime[consumer.key] ?? emptyRuntime();
        if (runtime.overrideUntil !== null && runtime.overrideUntil > state.ts) {
            return;
        }
        this.runtime[consumer.key] = { ...runtime, overrideUntil: nextMidnight(state.ts) };
        this.log.info(`"${consumer.name}" was switched by ${state.from} — PowerQueue leaves it alone until midnight.`);
    }

    /**
     * One evaluation: snapshot, plan, write what is allowed, publish.
     */
    private async evaluate(): Promise<void> {
        if (this.evaluating) {
            // A slow write must not overlap with the next tick, or the same change is written twice.
            return;
        }
        this.evaluating = true;
        try {
            const now = Date.now();
            this.grid = pruneSamples(this.grid, now, this.domain.energy.smoothingWindowMs);

            const plan = allocate(this.domain, this.snapshot(now), this.runtime);
            const applied = await this.applyTargets(plan);
            this.runtime = applyPlan(this.runtime, applied, this.lastEvaluation);
            this.lastEvaluation = now;
            await this.publishPlan(plan);
        } catch (error) {
            this.log.error(`Evaluation failed: ${(error as Error).message}`);
        } finally {
            this.evaluating = false;
        }
    }

    /**
     * @param now - evaluation timestamp
     * @returns one immutable set of inputs
     */
    private snapshot(now: number): Snapshot {
        const consumers: Snapshot['consumers'] = {};
        for (const consumer of this.native.consumers) {
            const feedback = this.feedback.get(consumer.key);
            const usable = feedback && now - feedback.ts <= this.domain.energy.maxAgeMs;
            consumers[consumer.key] = {
                // Without a configured condition a device is always usable.
                available: consumer.availabilityId ? (this.availability.get(consumer.key) ?? false) : true,
                actualPowerW: usable ? feedback.value : null,
            };
        }
        return {
            now,
            grid: this.grid,
            batteryPower: this.batteryPower,
            batterySoc: this.batterySoc,
            consumers,
        };
    }

    /**
     * Write the targets PowerQueue is allowed to write.
     *
     * @param plan - the plan to execute
     * @returns the plan reduced to what was really applied; only this may be folded into the runtime
     */
    private async applyTargets(plan: Plan): Promise<Plan> {
        const byKey = new Map(this.native.consumers.map(consumer => [consumer.key, consumer]));
        const domainByKey = new Map(this.domain.consumers.map(consumer => [consumer.key, consumer]));
        const consumers = [];

        for (const decision of plan.consumers) {
            const consumer = byKey.get(decision.key);
            const domain = domainByKey.get(decision.key);
            const previous = this.runtime[decision.key]?.appliedPowerW ?? 0;
            const mayWrite =
                this.native.mode === 'control' && consumer?.armed === true && decision.state !== 'override';

            // An unchanged target, and a modulating target that would move less than its dead band,
            // are not written at all — the device keeps the power it was really given.
            const written =
                mayWrite && consumer && domain && worthWriting(domain, previous, decision.proposedPowerW)
                    ? await this.writeTarget(consumer, decision.proposedPowerW)
                    : false;

            // Nothing written means nothing changed: the runtime keeps what PowerQueue really commanded.
            consumers.push(written ? decision : { ...decision, proposedPowerW: previous });
        }

        return { ...plan, consumers };
    }

    /**
     * @param consumer - the consumer to command
     * @param watts - the power it should draw; `0` switches it off
     * @returns whether the target was written
     */
    private async writeTarget(consumer: NativeConsumer, watts: number): Promise<boolean> {
        try {
            const object = await this.getForeignObjectAsync(consumer.targetId);
            if (!object || object.type !== 'state' || !object.common.write) {
                this.log.warn(`"${consumer.name}" was not switched: ${consumer.targetId} is not a writable state.`);
                return false;
            }
            if (consumer.targetUnit !== 'switch' && object.common.type !== 'number') {
                this.log.warn(`"${consumer.name}" was not set: ${consumer.targetId} cannot take a power value.`);
                return false;
            }
            const target = targetValue(consumer, watts);
            // A switch is usually boolean, but some adapters model it as 0/1.
            const value = typeof target === 'boolean' && object.common.type === 'number' ? (target ? 1 : 0) : target;
            await this.setForeignStateAsync(consumer.targetId, value, false);
            this.log.info(
                consumer.targetUnit === 'switch'
                    ? `"${consumer.name}" switched ${watts > 0 ? 'on' : 'off'}.`
                    : `"${consumer.name}" set to ${Math.round(watts)} W (${String(value)}).`,
            );
            return true;
        } catch (error) {
            this.log.warn(`"${consumer.name}" could not be switched: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * @param plan - the plan as decided, including the proposals that were not written
     */
    private async publishPlan(plan: Plan): Promise<void> {
        await this.publish('info.connection', plan.valid);
        await this.publish('plan.valid', plan.valid);
        await this.publish('plan.reason', plan.reason);
        await this.publish('plan.reasonText', PLAN_REASON_TEXT[plan.reason]);
        await this.publish('plan.updated', plan.now);

        for (const definition of BUDGET_STATES) {
            await this.publish(`budget.${definition.id}`, plan.budget[definition.id]);
        }

        for (const decision of plan.consumers) {
            const base = `consumers.${decision.key}`;
            const runtime = this.runtime[decision.key] ?? emptyRuntime();
            await this.publish(`${base}.state`, decision.state);
            await this.publish(`${base}.stateText`, CONSUMER_STATE_TEXT[decision.state]);
            await this.publish(`${base}.reason`, decision.reason);
            await this.publish(`${base}.reasonText`, CONSUMER_REASON_TEXT[decision.reason]);
            await this.publish(`${base}.proposedPowerW`, decision.proposedPowerW);
            await this.publish(`${base}.appliedPowerW`, runtime.appliedPowerW);
            await this.publish(`${base}.runtimeTodayS`, Math.round(runtime.runtimeTodayS));
            await this.publish(`${base}.lastChange`, runtime.lastChange);
            await this.publish(`${base}.overrideUntil`, runtime.overrideUntil);
        }
    }

    /**
     * @param id - object ID relative to the adapter namespace
     * @param value - the value to publish, written only when it changed
     */
    private async publish(id: string, value: ioBroker.StateValue): Promise<void> {
        if (this.published.get(id) === value) {
            return;
        }
        this.published.set(id, value);
        await this.setState(id, value, true);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * PowerQueue deliberately leaves every target where it is: switching devices off on a restart
     * or an update would be a surprise the user did not ask for.
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            if (this.timer) {
                this.clearInterval(this.timer);
            }
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Powerqueue(options);
} else {
    // otherwise start the instance directly
    (() => new Powerqueue())();
}
