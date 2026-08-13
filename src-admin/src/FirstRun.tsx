/**
 * The guided setup: one decision at a time, in household language.
 *
 * Step 1 asks where power is available, step 2 which device may use it, step 3 lets the user watch
 * before anything is switched. The sign convention is never asked as a convention — the live
 * reading is offered as two complete sentences and the user confirms the true one.
 */

import { I18n, InfoBox, SelectID } from '@iobroker/adapter-react-v5';
import type { AdminConnection } from '@iobroker/socket-client';
import {
    Box,
    Button,
    FormControlLabel,
    Radio,
    RadioGroup,
    Step,
    StepContent,
    StepLabel,
    Stepper,
    TextField,
    Typography,
} from '@mui/material';
import React from 'react';

import { allocate } from '../../src/lib/allocator';
import { DEFAULT_CONSUMER, newConsumerKey, toDomainConfig, type NativeConfig } from '../../src/lib/config';
import { CONSUMER_REASON_TEXT, CONSUMER_STATE_TEXT } from '../../src/lib/reasons';

/** Below this the two sentences would not differ meaningfully, so the choice stays locked. */
const AMBIGUOUS_W = 50;

/** One live reading of a foreign state. */
export interface LiveValue {
    value: number | null;
    ts: number;
}

/**
 * Subscribe to a foreign state for as long as it is selected.
 *
 * @param socket - the admin connection
 * @param id - object ID, empty when nothing is selected
 * @returns the current value and its timestamp
 */
export function useLiveValue(socket: AdminConnection, id: string): LiveValue {
    const [live, setLive] = React.useState<LiveValue>({ value: null, ts: 0 });

    React.useEffect(() => {
        setLive({ value: null, ts: 0 });
        if (!id) {
            return;
        }
        const handler = (_id: string, state: ioBroker.State | null | undefined): void => {
            if (state && typeof state.val === 'number') {
                setLive({ value: state.val, ts: state.ts });
            }
        };
        void socket.subscribeState(id, handler);
        return () => socket.unsubscribeState(id, handler);
    }, [socket, id]);

    return live;
}

export interface SelectStateButtonProps {
    label: string;
    value: string;
    socket: AdminConnection;
    theme: SelectIDTheme;
    /** Which objects may be picked at all — the user never types an ID. */
    filterFunc: (obj: ioBroker.Object) => boolean;
    onSelect: (id: string, name: string | null) => void;
}

/** The subset of the theme information the object browser dialog needs. */
export interface SelectIDTheme {
    theme: React.ComponentProps<typeof SelectID>['theme'];
    themeType: string;
}

/**
 * @param props - label, current selection and what may be selected
 * @returns a button that opens the object browser and shows the current selection
 */
export function SelectStateButton(props: SelectStateButtonProps): React.JSX.Element {
    const [open, setOpen] = React.useState(false);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button
                onClick={() => setOpen(true)}
                variant="outlined"
            >
                {props.label}
            </Button>
            <Typography
                color={props.value ? 'text.primary' : 'text.secondary'}
                variant="body2"
            >
                {props.value || I18n.t('nothing selected yet')}
            </Typography>
            {open ? (
                <SelectID
                    filterFunc={props.filterFunc}
                    onClose={() => setOpen(false)}
                    onOk={(selected, name) => {
                        setOpen(false);
                        const id = Array.isArray(selected) ? selected[0] : selected;
                        if (id) {
                            props.onSelect(id, name);
                        }
                    }}
                    selected={props.value}
                    socket={props.socket}
                    theme={props.theme.theme}
                    themeType={props.theme.themeType}
                    title={props.label}
                />
            ) : null}
        </Box>
    );
}

interface FirstRunProps {
    native: NativeConfig;
    socket: AdminConnection;
    theme: SelectIDTheme;
    onChange: (attr: keyof NativeConfig, value: unknown) => void;
}

/**
 * @param props - configuration, connection and the change handler
 * @returns the guided setup tab
 */
export function FirstRun(props: FirstRunProps): React.JSX.Element {
    const { native, onChange } = props;
    const grid = useLiveValue(props.socket, native.gridPowerId);
    const consumer = native.consumers[0];

    // The first unfinished step is the one that opens.
    const openStep = !native.gridConfirmed ? 0 : !consumer || !(consumer.nominalPowerW > 0) ? 1 : 2;
    const [active, setActive] = React.useState(openStep);

    const magnitude = grid.value === null ? 0 : Math.abs(grid.value);
    const ambiguous = grid.value === null || magnitude < AMBIGUOUS_W;

    /**
     * @param patch - the fields of the first consumer that change
     */
    function patchConsumer(patch: Partial<NonNullable<typeof consumer>>): void {
        const current = consumer ?? { ...DEFAULT_CONSUMER, key: newConsumerKey() };
        onChange('consumers', [{ ...current, ...patch }, ...native.consumers.slice(1)]);
    }

    return (
        <Stepper
            activeStep={active}
            nonLinear
            orientation="vertical"
            sx={{ p: 2 }}
        >
            <Step
                completed={native.gridConfirmed}
                expanded={active === 0}
            >
                <StepLabel onClick={() => setActive(0)}>{I18n.t('Where is power available?')}</StepLabel>
                <StepContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Typography variant="body2">
                            {I18n.t(
                                'PowerQueue needs the meter that measures what your house takes from the grid or feeds into it.',
                            )}
                        </Typography>
                        <SelectStateButton
                            filterFunc={obj => obj.common?.type === 'number'}
                            label={I18n.t('Select grid meter')}
                            onSelect={id => {
                                onChange('gridPowerId', id);
                                onChange('gridConfirmed', false);
                            }}
                            socket={props.socket}
                            theme={props.theme}
                            value={native.gridPowerId}
                        />

                        {native.gridPowerId ? (
                            ambiguous ? (
                                <InfoBox type="warning">
                                    {I18n.t(
                                        'The reading is currently too close to zero to tell the two directions apart. PowerQueue is waiting for a clearer measurement — switch on a large device or come back later.',
                                    )}
                                </InfoBox>
                            ) : (
                                <Box>
                                    <Typography variant="body2">
                                        {I18n.t('Which sentence is true right now?')}
                                    </Typography>
                                    <RadioGroup
                                        onChange={event => {
                                            onChange('gridImportPositive', event.target.value === 'import');
                                            onChange('gridConfirmed', true);
                                        }}
                                        value={
                                            native.gridConfirmed
                                                ? native.gridImportPositive === grid.value! > 0
                                                    ? 'import'
                                                    : 'export'
                                                : ''
                                        }
                                    >
                                        <FormControlLabel
                                            control={<Radio />}
                                            label={I18n.t(
                                                'Right now %s W are being drawn from the grid.',
                                                String(Math.round(magnitude)),
                                            )}
                                            value={grid.value! > 0 ? 'import' : 'export'}
                                        />
                                        <FormControlLabel
                                            control={<Radio />}
                                            label={I18n.t(
                                                'Right now %s W are being fed into the grid.',
                                                String(Math.round(magnitude)),
                                            )}
                                            value={grid.value! > 0 ? 'export' : 'import'}
                                        />
                                    </RadioGroup>
                                </Box>
                            )
                        ) : null}
                    </Box>
                </StepContent>
            </Step>

            <Step
                completed={Boolean(consumer?.targetId) && Boolean(consumer && consumer.nominalPowerW > 0)}
                expanded={active === 1}
            >
                <StepLabel onClick={() => setActive(1)}>{I18n.t('Which device should use it?')}</StepLabel>
                <StepContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}>
                        <Typography variant="body2">
                            {I18n.t(
                                'Pick one device that may wait: a pool pump, a heating element, a dehumidifier. It has to be a switch PowerQueue could turn on.',
                            )}
                        </Typography>
                        <SelectStateButton
                            filterFunc={obj => obj.common?.type === 'boolean' && obj.common?.write === true}
                            label={I18n.t('Select switch')}
                            onSelect={(id, name) => patchConsumer({ targetId: id, name: consumer?.name || name || id })}
                            socket={props.socket}
                            theme={props.theme}
                            value={consumer?.targetId ?? ''}
                        />
                        <TextField
                            label={I18n.t('Name of the device')}
                            onChange={event => patchConsumer({ name: event.target.value })}
                            value={consumer?.name ?? ''}
                            variant="standard"
                        />
                        <TextField
                            helperText={I18n.t('Roughly how much it uses while it runs. The type plate is enough.')}
                            label={I18n.t('Power consumption (W)')}
                            onChange={event => patchConsumer({ nominalPowerW: Number(event.target.value) })}
                            type="number"
                            value={consumer?.nominalPowerW ?? 0}
                            variant="standard"
                        />
                    </Box>
                </StepContent>
            </Step>

            <Step expanded={active === 2}>
                <StepLabel onClick={() => setActive(2)}>{I18n.t('Watch before controlling.')}</StepLabel>
                <StepContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <LivePreview
                            grid={grid}
                            native={native}
                        />
                        <RadioGroup
                            onChange={event => onChange('mode', event.target.value)}
                            value={native.mode}
                        >
                            <FormControlLabel
                                control={<Radio />}
                                label={I18n.t('Only watch and explain. Nothing is switched. (recommended to start)')}
                                value="observe"
                            />
                            <FormControlLabel
                                control={<Radio />}
                                label={I18n.t('Also switch the devices I have released below.')}
                                value="control"
                            />
                        </RadioGroup>
                        {native.mode === 'control' ? (
                            <Box>
                                <InfoBox type="warning">
                                    {I18n.t(
                                        'A released device is switched on and off by PowerQueue on its own. Release it only if that is safe at any time of day.',
                                    )}
                                </InfoBox>
                                <RadioGroup
                                    onChange={event => patchConsumer({ armed: event.target.value === 'yes' })}
                                    value={consumer?.armed ? 'yes' : 'no'}
                                >
                                    <FormControlLabel
                                        control={<Radio />}
                                        label={I18n.t('Keep switching %s myself.', consumer?.name || '')}
                                        value="no"
                                    />
                                    <FormControlLabel
                                        control={<Radio />}
                                        label={I18n.t('PowerQueue may switch %s.', consumer?.name || '')}
                                        value="yes"
                                    />
                                </RadioGroup>
                            </Box>
                        ) : null}
                    </Box>
                </StepContent>
            </Step>
        </Stepper>
    );
}

interface LivePreviewProps {
    native: NativeConfig;
    grid: LiveValue;
}

/**
 * What PowerQueue would decide from the reading of this very moment.
 *
 * @param props - configuration and the live grid reading
 * @returns one sentence about the budget and one line per device
 */
function LivePreview(props: LivePreviewProps): React.JSX.Element {
    const { grid, native } = props;

    if (grid.value === null || !native.gridConfirmed || native.consumers.length === 0) {
        return (
            <Typography variant="body2">
                {I18n.t('As soon as the meter and one device are selected, you can see here what would happen.')}
            </Typography>
        );
    }

    const now = Date.now();
    const plan = allocate(
        { ...toDomainConfig(native), mode: 'observe' },
        {
            now,
            grid: [{ value: grid.value, ts: grid.ts || now }],
            batteryPower: null,
            batterySoc: null,
            consumers: Object.fromEntries(
                native.consumers.map(consumer => [consumer.key, { available: true, actualPowerW: null }]),
            ),
        },
        {},
    );

    return (
        <Box>
            <Typography variant="body1">
                {I18n.t(
                    'Right now %s W would be free for flexible devices.',
                    String(Math.round(plan.budget.availableW)),
                )}
            </Typography>
            {plan.consumers.map(decision => {
                const name = native.consumers.find(entry => entry.key === decision.key)?.name ?? decision.key;
                return (
                    <Typography
                        key={decision.key}
                        variant="body2"
                    >
                        {`${name}: ${I18n.t(CONSUMER_STATE_TEXT[decision.state])} — ${I18n.t(
                            CONSUMER_REASON_TEXT[decision.reason],
                        )}`}
                    </Typography>
                );
            })}
        </Box>
    );
}
