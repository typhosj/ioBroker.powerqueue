/**
 * The reason catalogue: one household sentence per stable reason code, plus one word per consumer
 * state.
 *
 * The codes are the stable part and are published as `reasonCode`. The English sentences here are
 * the translation source — the admin UI runs them through `I18n.t`, the runtime publishes them as
 * `reasonText`. Adding a code is a minor change; changing what a code means is not.
 */

import type { ConsumerState, ReasonCode } from './types';

/** Whole-plan reasons, phrased as what PowerQueue is doing and why. */
export const PLAN_REASON_TEXT: Record<ReasonCode, string> = {
    ok: 'Distributing the available power by priority.',
    mode_off: 'PowerQueue is switched off and decides nothing.',
    grid_missing: 'No grid meter is selected yet, so there is nothing to distribute.',
    grid_stale: 'The grid meter has not reported for a while — nothing is switched on this way.',
    battery_stale: 'The battery has not reported for a while, so only the grid meter is used.',
    soc_below_minimum: 'The house battery is below its minimum charge level, so no power is handed out.',
    allocated: 'Distributing the available power by priority.',
    insufficient_budget: 'There is not enough surplus power right now.',
    min_on_time: 'A device is being kept running for its minimum runtime.',
    min_off_time: 'A device is waiting out its minimum pause.',
    external_override: 'Someone else is controlling a device, so PowerQueue keeps its hands off it.',
    not_enabled: 'No device is taking part right now.',
    not_available: 'A device is not available right now.',
    input_invalid: 'A device is not configured completely.',
};

/** Per-consumer reasons, phrased from the device's point of view. */
export const CONSUMER_REASON_TEXT: Record<ReasonCode, string> = {
    ok: 'Everything is fine.',
    mode_off: 'PowerQueue is switched off and leaves this device alone.',
    grid_missing: 'Without a grid meter PowerQueue cannot decide anything for this device.',
    grid_stale: 'The grid meter is not reporting, so this device is left in its safe position.',
    battery_stale: 'The battery is not reporting; only the grid meter is used.',
    soc_below_minimum: 'The house battery is too empty to hand out power.',
    allocated: 'Enough surplus power is available.',
    insufficient_budget: 'Waiting for enough surplus power.',
    min_on_time: 'Keeps running for its minimum runtime, even though the surplus has dropped.',
    min_off_time: 'Waiting out its minimum pause before it may start again.',
    external_override: 'Someone else switched this device, so PowerQueue does not touch it.',
    not_enabled: 'Not taking part at the moment.',
    not_available: 'Not available right now.',
    input_invalid: 'Not configured completely.',
};

/** One word per consumer state, for the compact status column. */
export const CONSUMER_STATE_TEXT: Record<ConsumerState, string> = {
    off: 'Off',
    waiting: 'Waiting',
    committed: 'Running (minimum runtime)',
    running: 'Running',
    override: 'Manually controlled',
    fault: 'Needs attention',
};
