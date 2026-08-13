/**
 * Everything the guided setup deliberately leaves out: the house battery, the reserve and the full
 * list of devices with their order, their switching times and their release.
 *
 * The guided setup owns the first device and the first decisions. This tab is where a household
 * grows: a second device, a battery, a reserve that keeps the kettle from tripping the fuse.
 */

import { I18n, InfoBox } from '@iobroker/adapter-react-v5';
import { Add, ArrowDownward, ArrowUpward, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
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

import { DEFAULT_CONSUMER, newConsumerKey, type NativeConfig, type NativeConsumer } from '../../src/lib/config';
import { SelectStateButton, useLiveValue, type SelectIDTheme } from './FirstRun';

/** Below this the two battery sentences would not differ meaningfully, so the choice stays locked. */
const AMBIGUOUS_W = 50;

/** A switch PowerQueue could operate: writable, and either a real switch or a 0/1 state. */
function isSwitch(obj: ioBroker.Object): boolean {
    return obj.common?.write === true && (obj.common?.type === 'boolean' || obj.common?.type === 'number');
}

/**
 * @param obj - candidate object
 * @returns whether it can carry a measured power in watts
 */
function isNumber(obj: ioBroker.Object): boolean {
    return obj.common?.type === 'number';
}

interface DevicesProps {
    native: NativeConfig;
    socket: AdminConnection;
    theme: SelectIDTheme;
    onChange: (attr: keyof NativeConfig, value: unknown) => void;
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
        onChange(
            'consumers',
            native.consumers.map(consumer => (consumer.key === key ? { ...consumer, ...patch } : consumer)),
        );
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
        onChange(
            'consumers',
            moved.map((consumer, position) => ({ ...consumer, priority: position + 1 })),
        );
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
                    filterFunc={isNumber}
                    label={I18n.t('Select battery power')}
                    onSelect={id => {
                        onChange('batteryPowerId', id);
                        onChange('batteryConfirmed', false);
                    }}
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
                                    onChange={event => {
                                        onChange('batteryChargePositive', event.target.value === 'charge');
                                        onChange('batteryConfirmed', true);
                                    }}
                                    value={
                                        native.batteryConfirmed
                                            ? native.batteryChargePositive === battery.value! > 0
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
                                        value={battery.value! > 0 ? 'charge' : 'discharge'}
                                    />
                                    <FormControlLabel
                                        control={<Radio />}
                                        label={I18n.t(
                                            'Right now the battery is supplying %s W.',
                                            String(Math.round(magnitude)),
                                        )}
                                        value={battery.value! > 0 ? 'discharge' : 'charge'}
                                    />
                                </RadioGroup>
                            </Box>
                        )}

                        <SelectStateButton
                            filterFunc={isNumber}
                            label={I18n.t('Select charge level')}
                            onSelect={id => onChange('batterySocId', id)}
                            socket={props.socket}
                            theme={props.theme}
                            value={native.batterySocId}
                        />
                        {native.batterySocId ? (
                            <TextField
                                helperText={I18n.t('Below this level nothing is handed out. Leave empty to ignore it.')}
                                label={I18n.t('Minimum charge level (%)')}
                                onChange={event =>
                                    onChange(
                                        'minBatterySoc',
                                        event.target.value === '' ? null : Number(event.target.value),
                                    )
                                }
                                type="number"
                                value={native.minBatterySoc ?? ''}
                                variant="standard"
                            />
                        ) : null}
                        <Button
                            color="inherit"
                            onClick={() => {
                                onChange('batteryPowerId', '');
                                onChange('batterySocId', '');
                                onChange('batteryConfirmed', false);
                                onChange('minBatterySoc', null);
                            }}
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
                    onChange={event => onChange('reserveW', Number(event.target.value))}
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
                            <Typography
                                sx={{ flexGrow: 1 }}
                                variant="subtitle1"
                            >
                                {`${position + 1}. ${consumer.name || I18n.t('Unnamed device')}`}
                            </Typography>
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
                                    onChange(
                                        'consumers',
                                        native.consumers.filter(entry => entry.key !== consumer.key),
                                    )
                                }
                                title={I18n.t('Remove device')}
                            >
                                <Delete />
                            </IconButton>
                        </Box>

                        <TextField
                            label={I18n.t('Name of the device')}
                            onChange={event => update(consumer.key, { name: event.target.value })}
                            value={consumer.name}
                            variant="standard"
                        />
                        <SelectStateButton
                            filterFunc={isSwitch}
                            label={I18n.t('Select switch')}
                            onSelect={(id, name) =>
                                update(consumer.key, { targetId: id, name: consumer.name || name || id })
                            }
                            socket={props.socket}
                            theme={props.theme}
                            value={consumer.targetId}
                        />
                        <SelectStateButton
                            filterFunc={isNumber}
                            label={I18n.t('Select measured power (optional)')}
                            onSelect={id => update(consumer.key, { feedbackId: id })}
                            socket={props.socket}
                            theme={props.theme}
                            value={consumer.feedbackId}
                        />

                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <TextField
                                label={I18n.t('Power consumption (W)')}
                                onChange={event => update(consumer.key, { nominalPowerW: Number(event.target.value) })}
                                type="number"
                                value={consumer.nominalPowerW}
                                variant="standard"
                            />
                            <TextField
                                helperText={I18n.t('Keeps running at least this long.')}
                                label={I18n.t('Minimum runtime (min)')}
                                onChange={event => update(consumer.key, { minOnMinutes: Number(event.target.value) })}
                                type="number"
                                value={consumer.minOnMinutes}
                                variant="standard"
                            />
                            <TextField
                                helperText={I18n.t('Waits at least this long before it starts again.')}
                                label={I18n.t('Minimum pause (min)')}
                                onChange={event => update(consumer.key, { minOffMinutes: Number(event.target.value) })}
                                type="number"
                                value={consumer.minOffMinutes}
                                variant="standard"
                            />
                        </Box>

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
                    </Paper>
                ))}

                <Button
                    onClick={() =>
                        onChange('consumers', [
                            ...native.consumers,
                            { ...DEFAULT_CONSUMER, key: newConsumerKey(), priority: native.consumers.length + 1 },
                        ])
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
