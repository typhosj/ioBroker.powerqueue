/**
 * Everything the guided setup deliberately leaves out: the house battery, the reserve and the full
 * list of devices with their order, their switching times and their release.
 *
 * The guided setup owns the first device and the first decisions. This tab is where a household
 * grows: a second device, a battery, a reserve that keeps the kettle from tripping the fuse.
 */

import { I18n, InfoBox } from '@iobroker/adapter-react-v5';
import { Add, ArrowDownward, ArrowUpward, Delete, ExpandLess, ExpandMore } from '@mui/icons-material';
import {
    Box,
    Button,
    Collapse,
    Divider,
    FormControlLabel,
    IconButton,
    Paper,
    Radio,
    RadioGroup,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import type { AdminConnection } from '@iobroker/socket-client';
import React from 'react';

import {
    DEFAULT_CONSUMER,
    newConsumerKey,
    type NativeConfig,
    type NativeConsumer,
    type TargetUnit,
} from '../../src/lib/config';
import { isPowerState, SelectStateButton, useLiveValue, type SelectIDTheme } from './FirstRun';
import { positiveMeansFirst } from './sign';

/** Below this the two battery sentences would not differ meaningfully, so the choice stays locked. */
const AMBIGUOUS_W = 50;

/** A switch PowerQueue could operate: writable, and either a real switch or a 0/1 state. */
function isSwitch(obj: ioBroker.Object): boolean {
    return obj.common?.write === true && (obj.common?.type === 'boolean' || obj.common?.type === 'number');
}

/**
 * @param obj - candidate object
 * @returns whether a power value can be written to it
 */
function isWritableNumber(obj: ioBroker.Object): boolean {
    return obj.common?.write === true && obj.common?.type === 'number';
}

/**
 * @param obj - candidate object
 * @returns whether it can carry a measured power in watts
 */
function isNumber(obj: ioBroker.Object): boolean {
    return obj.common?.type === 'number';
}

interface AdoptMeasuredPowerProps {
    socket: AdminConnection;
    feedbackId: string;
    onAdopt: (watts: number) => void;
}

/**
 * The nominal power has to be known before the device runs, so it cannot be a state: a measured
 * power reads zero while the device is off, and that is exactly when PowerQueue has to decide
 * whether the surplus would cover it. What the measurement can do is fill the field in once, while
 * the device happens to be running.
 *
 * @param props - the measured power state and what to do with its value
 * @returns a button that copies the current reading into the configured power, or nothing
 */
function AdoptMeasuredPower(props: AdoptMeasuredPowerProps): React.JSX.Element | null {
    const live = useLiveValue(props.socket, props.feedbackId);
    if (live.value === null || live.value < 1) {
        return null;
    }
    const watts = Math.round(live.value);

    return (
        <Button
            onClick={() => props.onAdopt(watts)}
            size="small"
            sx={{ alignSelf: 'flex-start' }}
        >
            {I18n.t('It is running now: use the measured %s W', String(watts))}
        </Button>
    );
}

interface DevicesProps {
    native: NativeConfig;
    socket: AdminConnection;
    theme: SelectIDTheme;
    /** Applied in one state update, so fields that belong together cannot be lost separately. */
    onChange: (patch: Partial<NativeConfig>) => void;
}

/**
 * @param props - configuration, connection and the change handler
 * @returns the devices and energy tab
 */
export function Devices(props: DevicesProps): React.JSX.Element {
    const { native, onChange } = props;
    const battery = useLiveValue(props.socket, native.batteryPowerId);

    // The list is shown in the order it is served, so moving a device is the only way to reorder.
    const ordered = [...native.consumers].sort((a, b) => a.priority - b.priority || (a.key < b.key ? -1 : 1));

    /**
     * @param key - the consumer to change
     * @param patch - the fields that change
     */
    function update(key: string, patch: Partial<NativeConsumer>): void {
        onChange({
            consumers: native.consumers.map(consumer => (consumer.key === key ? { ...consumer, ...patch } : consumer)),
        });
    }

    /**
     * @param key - the consumer to move
     * @param delta - one step up (-1) or down (+1)
     */
    function move(key: string, delta: number): void {
        const index = ordered.findIndex(consumer => consumer.key === key);
        const target = index + delta;
        if (target < 0 || target >= ordered.length) {
            return;
        }
        const moved = [...ordered];
        [moved[index], moved[target]] = [moved[target], moved[index]];
        // Renumbering keeps the priorities gap-free, so the order the user sees is the stored order.
        onChange({ consumers: moved.map((consumer, position) => ({ ...consumer, priority: position + 1 })) });
    }

    // A device that still needs input opens itself; a finished one stays folded until it is asked for.
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

    /**
     * @param consumer - the consumer whose card is drawn
     * @returns whether its details are visible
     */
    function isExpanded(consumer: NativeConsumer): boolean {
        return expanded[consumer.key] ?? !(consumer.targetId && consumer.nominalPowerW > 0);
    }

    /**
     * @param consumer - the consumer whose card is folded
     * @returns the one line that has to be enough while the details are hidden
     */
    function summary(consumer: NativeConsumer): string {
        const parts = [
            consumer.targetUnit === 'switch'
                ? I18n.t('%s W', String(consumer.nominalPowerW))
                : I18n.t('%s to %s W', String(consumer.minPowerW), String(consumer.nominalPowerW)),
        ];
        if (!consumer.enabled) {
            parts.push(I18n.t('not taking part'));
        } else if (!consumer.armed) {
            parts.push(I18n.t('proposal only'));
        } else {
            parts.push(I18n.t('may be switched'));
        }
        return parts.join(' · ');
    }

    const magnitude = battery.value === null ? 0 : Math.abs(battery.value);
    const ambiguous = battery.value === null || magnitude < AMBIGUOUS_W;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: 2, overflow: 'auto' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
                <Typography variant="h6">{I18n.t('House battery')}</Typography>
                <Typography variant="body2">
                    {I18n.t(
                        'If you have a battery, power that is currently charging it counts as surplus: a flexible device may use it instead.',
                    )}
                </Typography>
                <SelectStateButton
                    filterFunc={isPowerState}
                    label={I18n.t('Select battery power')}
                    onSelect={id => onChange({ batteryPowerId: id, batteryConfirmed: false })}
                    socket={props.socket}
                    theme={props.theme}
                    value={native.batteryPowerId}
                />

                {native.batteryPowerId ? (
                    <>
                        {ambiguous ? (
                            <InfoBox type="warning">
                                {I18n.t(
                                    'The battery is almost idle right now, so the two directions cannot be told apart. Come back when it is charging or discharging clearly.',
                                )}
                            </InfoBox>
                        ) : (
                            <Box>
                                <Typography variant="body2">{I18n.t('Which sentence is true right now?')}</Typography>
                                <RadioGroup
                                    onChange={event =>
                                        onChange({
                                            batteryChargePositive: positiveMeansFirst(
                                                event.target.value === 'charge',
                                                battery.value! > 0,
                                            ),
                                            batteryConfirmed: true,
                                        })
                                    }
                                    value={
                                        native.batteryConfirmed
                                            ? positiveMeansFirst(native.batteryChargePositive, battery.value! > 0)
                                                ? 'charge'
                                                : 'discharge'
                                            : ''
                                    }
                                >
                                    <FormControlLabel
                                        control={<Radio />}
                                        label={I18n.t(
                                            'Right now the battery is being charged with %s W.',
                                            String(Math.round(magnitude)),
                                        )}
                                        value="charge"
                                    />
                                    <FormControlLabel
                                        control={<Radio />}
                                        label={I18n.t(
                                            'Right now the battery is supplying %s W.',
                                            String(Math.round(magnitude)),
                                        )}
                                        value="discharge"
                                    />
                                </RadioGroup>
                            </Box>
                        )}

                        <SelectStateButton
                            filterFunc={isNumber}
                            label={I18n.t('Select charge level')}
                            onSelect={id => onChange({ batterySocId: id })}
                            socket={props.socket}
                            theme={props.theme}
                            value={native.batterySocId}
                        />
                        {native.batterySocId ? (
                            <TextField
                                helperText={I18n.t('Below this level nothing is handed out. Leave empty to ignore it.')}
                                label={I18n.t('Minimum charge level (%)')}
                                onChange={event =>
                                    onChange({
                                        minBatterySoc: event.target.value === '' ? null : Number(event.target.value),
                                    })
                                }
                                type="number"
                                value={native.minBatterySoc ?? ''}
                                variant="standard"
                            />
                        ) : null}
                        <Button
                            color="inherit"
                            onClick={() =>
                                onChange({
                                    batteryPowerId: '',
                                    batterySocId: '',
                                    batteryConfirmed: false,
                                    minBatterySoc: null,
                                })
                            }
                            size="small"
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {I18n.t('I have no battery')}
                        </Button>
                    </>
                ) : null}
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
                <Typography variant="h6">{I18n.t('Reserve')}</Typography>
                <TextField
                    helperText={I18n.t(
                        'Surplus power PowerQueue never hands out, so a kettle or a hair dryer does not immediately pull from the grid.',
                    )}
                    label={I18n.t('Keep in reserve (W)')}
                    onChange={event => onChange({ reserveW: Number(event.target.value) })}
                    type="number"
                    value={native.reserveW}
                    variant="standard"
                />
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="h6">{I18n.t('Devices, in the order they are served')}</Typography>
                {ordered.length === 0 ? (
                    <Typography variant="body2">{I18n.t('No device yet. Add the first one below.')}</Typography>
                ) : null}

                {ordered.map((consumer, position) => (
                    <Paper
                        key={consumer.key}
                        sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, maxWidth: 560 }}
                        variant="outlined"
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <IconButton
                                onClick={() => setExpanded({ ...expanded, [consumer.key]: !isExpanded(consumer) })}
                                title={isExpanded(consumer) ? I18n.t('Hide details') : I18n.t('Show details')}
                            >
                                {isExpanded(consumer) ? <ExpandLess /> : <ExpandMore />}
                            </IconButton>
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                <Typography variant="subtitle1">
                                    {`${position + 1}. ${consumer.name || I18n.t('Unnamed device')}`}
                                </Typography>
                                {isExpanded(consumer) ? null : (
                                    <Typography
                                        color="text.secondary"
                                        variant="body2"
                                    >
                                        {summary(consumer)}
                                    </Typography>
                                )}
                            </Box>
                            <IconButton
                                disabled={position === 0}
                                onClick={() => move(consumer.key, -1)}
                                title={I18n.t('Serve earlier')}
                            >
                                <ArrowUpward />
                            </IconButton>
                            <IconButton
                                disabled={position === ordered.length - 1}
                                onClick={() => move(consumer.key, 1)}
                                title={I18n.t('Serve later')}
                            >
                                <ArrowDownward />
                            </IconButton>
                            <IconButton
                                onClick={() =>
                                    onChange({
                                        consumers: native.consumers.filter(entry => entry.key !== consumer.key),
                                    })
                                }
                                title={I18n.t('Remove device')}
                            >
                                <Delete />
                            </IconButton>
                        </Box>

                        <Collapse
                            in={isExpanded(consumer)}
                            sx={{ '& .MuiCollapse-wrapperInner': { display: 'flex', flexDirection: 'column', gap: 2 } }}
                        >
                            <TextField
                                label={I18n.t('Name of the device')}
                                onChange={event => update(consumer.key, { name: event.target.value })}
                                value={consumer.name}
                                variant="standard"
                            />
                            <SelectStateButton
                                filterFunc={consumer.targetUnit === 'switch' ? isSwitch : isWritableNumber}
                                label={
                                    consumer.targetUnit === 'switch'
                                        ? I18n.t('Select switch')
                                        : I18n.t('Select the state that sets the power')
                                }
                                onSelect={(id, name) =>
                                    update(consumer.key, { targetId: id, name: consumer.name || name || id })
                                }
                                socket={props.socket}
                                theme={props.theme}
                                value={consumer.targetId}
                            />
                            <SelectStateButton
                                filterFunc={isPowerState}
                                label={I18n.t('Select measured power (optional)')}
                                onSelect={id => update(consumer.key, { feedbackId: id })}
                                socket={props.socket}
                                theme={props.theme}
                                value={consumer.feedbackId}
                            />

                            <Typography
                                color="text.secondary"
                                variant="body2"
                            >
                                {I18n.t(
                                    'Some devices may only run under a condition that has nothing to do with power: the car is plugged in, the pool cover is open, nobody is away. If you have a state that says so, PowerQueue keeps the device out of the plan whenever it does not match.',
                                )}
                            </Typography>
                            <SelectStateButton
                                filterFunc={obj => obj.common?.type === 'boolean' || obj.common?.type === 'number'}
                                label={I18n.t('Extra condition (optional)')}
                                onSelect={id => update(consumer.key, { availabilityId: id })}
                                socket={props.socket}
                                theme={props.theme}
                                value={consumer.availabilityId ?? ''}
                            />
                            {consumer.availabilityId ? (
                                <Box sx={{ pl: 1 }}>
                                    <RadioGroup
                                        onChange={event =>
                                            update(consumer.key, { availableWhen: event.target.value === 'on' })
                                        }
                                        value={(consumer.availableWhen ?? true) ? 'on' : 'off'}
                                    >
                                        <FormControlLabel
                                            control={<Radio />}
                                            label={I18n.t('%s may run while that state is on.', consumer.name || '')}
                                            value="on"
                                        />
                                        <FormControlLabel
                                            control={<Radio />}
                                            label={I18n.t('%s may run while that state is off.', consumer.name || '')}
                                            value="off"
                                        />
                                    </RadioGroup>
                                    <Button
                                        color="inherit"
                                        onClick={() => update(consumer.key, { availabilityId: '' })}
                                        size="small"
                                    >
                                        {I18n.t('Always allow it')}
                                    </Button>
                                </Box>
                            ) : null}

                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                <TextField
                                    helperText={I18n.t(
                                        'Roughly how much it uses while it runs. The type plate is enough.',
                                    )}
                                    label={
                                        consumer.targetUnit === 'switch'
                                            ? I18n.t('Power consumption (W)')
                                            : I18n.t('Highest power (W)')
                                    }
                                    onChange={event =>
                                        update(consumer.key, { nominalPowerW: Number(event.target.value) })
                                    }
                                    type="number"
                                    value={consumer.nominalPowerW}
                                    variant="standard"
                                />
                                <TextField
                                    helperText={I18n.t('Keeps running at least this long.')}
                                    label={I18n.t('Minimum runtime (min)')}
                                    onChange={event =>
                                        update(consumer.key, { minOnMinutes: Number(event.target.value) })
                                    }
                                    type="number"
                                    value={consumer.minOnMinutes}
                                    variant="standard"
                                />
                                <TextField
                                    helperText={I18n.t('Waits at least this long before it starts again.')}
                                    label={I18n.t('Minimum pause (min)')}
                                    onChange={event =>
                                        update(consumer.key, { minOffMinutes: Number(event.target.value) })
                                    }
                                    type="number"
                                    value={consumer.minOffMinutes}
                                    variant="standard"
                                />
                            </Box>
                            {consumer.feedbackId ? (
                                <AdoptMeasuredPower
                                    feedbackId={consumer.feedbackId}
                                    onAdopt={watts => update(consumer.key, { nominalPowerW: watts })}
                                    socket={props.socket}
                                />
                            ) : null}

                            <Typography
                                color="text.secondary"
                                variant="body2"
                            >
                                {I18n.t(
                                    'Some devices do not only run or stand still: a wallbox charges with more or less current, a heating element with more or less power. PowerQueue gives such a device exactly what is left over.',
                                )}
                            </Typography>
                            <RadioGroup
                                onChange={event => {
                                    const unit = event.target.value as TargetUnit;
                                    // A switch and a power setting are never the same state, so the
                                    // selected target is dropped when the kind of target changes.
                                    const crosses = (unit === 'switch') !== (consumer.targetUnit === 'switch');
                                    update(consumer.key, { targetUnit: unit, ...(crosses ? { targetId: '' } : {}) });
                                }}
                                value={consumer.targetUnit}
                            >
                                <FormControlLabel
                                    control={<Radio />}
                                    label={I18n.t('It can only be switched on and off.')}
                                    value="switch"
                                />
                                <FormControlLabel
                                    control={<Radio />}
                                    label={I18n.t('It is given a charging current in amperes per phase.')}
                                    value="ampere"
                                />
                                <FormControlLabel
                                    control={<Radio />}
                                    label={I18n.t('It is given a power in watts.')}
                                    value="watt"
                                />
                                <FormControlLabel
                                    control={<Radio />}
                                    label={I18n.t('It is given a percentage of its highest power.')}
                                    value="percent"
                                />
                            </RadioGroup>

                            {consumer.targetUnit === 'switch' ? null : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pl: 1 }}>
                                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                        <TextField
                                            helperText={I18n.t(
                                                'Below this the device is switched off instead. A car may not charge below 6 A per phase.',
                                            )}
                                            label={I18n.t('Lowest power (W)')}
                                            onChange={event =>
                                                update(consumer.key, { minPowerW: Number(event.target.value) })
                                            }
                                            type="number"
                                            value={consumer.minPowerW}
                                            variant="standard"
                                        />
                                        <TextField
                                            helperText={I18n.t(
                                                'The smallest change the device can follow. Leave it at 0 if it follows every watt.',
                                            )}
                                            label={I18n.t('Step size (W)')}
                                            onChange={event =>
                                                update(consumer.key, { stepW: Number(event.target.value) })
                                            }
                                            type="number"
                                            value={consumer.stepW}
                                            variant="standard"
                                        />
                                    </Box>

                                    {consumer.targetUnit === 'ampere' ? (
                                        <>
                                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                <RadioGroup
                                                    onChange={event =>
                                                        update(consumer.key, { phases: Number(event.target.value) })
                                                    }
                                                    row
                                                    value={consumer.phases}
                                                >
                                                    <FormControlLabel
                                                        control={<Radio />}
                                                        label={I18n.t('One phase')}
                                                        value={1}
                                                    />
                                                    <FormControlLabel
                                                        control={<Radio />}
                                                        label={I18n.t('Three phases')}
                                                        value={3}
                                                    />
                                                </RadioGroup>
                                                <TextField
                                                    helperText={I18n.t(
                                                        'Used to turn watts into amperes. 230 V is only the nominal value; take the measured one if you have it.',
                                                    )}
                                                    label={I18n.t('Mains voltage (V)')}
                                                    onChange={event =>
                                                        update(consumer.key, { voltageV: Number(event.target.value) })
                                                    }
                                                    type="number"
                                                    value={consumer.voltageV}
                                                    variant="standard"
                                                />
                                            </Box>
                                            <Button
                                                onClick={() =>
                                                    update(consumer.key, {
                                                        minPowerW: Math.round(6 * consumer.phases * consumer.voltageV),
                                                        stepW: Math.round(consumer.phases * consumer.voltageV),
                                                        nominalPowerW: Math.round(
                                                            16 * consumer.phases * consumer.voltageV,
                                                        ),
                                                    })
                                                }
                                                size="small"
                                                sx={{ alignSelf: 'flex-start' }}
                                            >
                                                {I18n.t('Fill in the usual 6 to 16 A of a wallbox')}
                                            </Button>
                                        </>
                                    ) : null}
                                </Box>
                            )}

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={consumer.enabled}
                                        onChange={event => update(consumer.key, { enabled: event.target.checked })}
                                    />
                                }
                                label={I18n.t('Takes part in the planning')}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={consumer.armed}
                                        onChange={event => update(consumer.key, { armed: event.target.checked })}
                                    />
                                }
                                label={I18n.t('PowerQueue may switch this device')}
                            />
                            {consumer.armed && native.mode !== 'control' ? (
                                <Typography
                                    color="text.secondary"
                                    variant="body2"
                                >
                                    {I18n.t('Nothing is switched while PowerQueue only watches.')}
                                </Typography>
                            ) : null}
                        </Collapse>
                    </Paper>
                ))}

                <Button
                    onClick={() =>
                        onChange({
                            consumers: [
                                ...native.consumers,
                                { ...DEFAULT_CONSUMER, key: newConsumerKey(), priority: native.consumers.length + 1 },
                            ],
                        })
                    }
                    startIcon={<Add />}
                    sx={{ alignSelf: 'flex-start' }}
                    variant="outlined"
                >
                    {I18n.t('Add device')}
                </Button>
            </Box>
        </Box>
    );
}
