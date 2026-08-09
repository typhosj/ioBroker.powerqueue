/**
 * The simulation tab: a whole day replayed through the real allocator, so the user can see what
 * PowerQueue would do before anything is switched for real.
 */

import { I18n, InfoBox } from '@iobroker/adapter-react-v5';
import { Box, Slider, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import React from 'react';

import { CONSUMER_REASON_TEXT, CONSUMER_STATE_TEXT } from '../../src/lib/reasons';
import type { NativeConfig } from '../../src/lib/config';
import { exampleHousehold, runtimeByConsumer, simulateDay, switchEvents } from './synthetic';

/**
 * @param ts - timestamp
 * @returns the time of day, without the date
 */
function clock(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * @param watts - power in watts
 * @returns the value rounded to whole watts, with its unit
 */
function watt(watts: number): string {
    return `${Math.round(watts)} W`;
}

/**
 * @param seconds - a duration
 * @returns the duration in hours and minutes
 */
function duration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** Local midnight of today, the day every simulation runs on. */
function today(): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
}

interface SimulationProps {
    native: NativeConfig;
}

/**
 * @param props - the current configuration
 * @returns the simulation tab
 */
export function Simulation(props: SimulationProps): React.JSX.Element {
    const usesExample = props.native.consumers.length === 0 || !props.native.gridConfirmed;
    const native = usesExample ? exampleHousehold() : props.native;
    const dayStart = React.useMemo(() => today(), []);
    const steps = React.useMemo(() => simulateDay(native, dayStart), [native, dayStart]);
    const events = React.useMemo(() => switchEvents(steps), [steps]);
    const runtimes = React.useMemo(() => runtimeByConsumer(steps), [steps]);

    // Noon is where a photovoltaic day is most interesting, so the slider starts there.
    const [index, setIndex] = React.useState(Math.floor(steps.length / 2));
    const step = steps[Math.min(index, steps.length - 1)];
    const names = new Map(native.consumers.map(consumer => [consumer.key, consumer.name]));

    const exported = -step.plan.budget.surplusW;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            {usesExample ? (
                <InfoBox type="info">
                    {I18n.t(
                        'This is an example household with a photovoltaic system and a pool pump. As soon as you have selected your own meter and one device, the simulation uses your settings.',
                    )}
                </InfoBox>
            ) : null}

            <Typography variant="body1">
                {I18n.t('A whole day, five minutes at a time, decided by the same logic the adapter runs.')}
            </Typography>

            <Box>
                <Typography variant="h6">{clock(step.ts)}</Typography>
                <Slider
                    max={steps.length - 1}
                    min={0}
                    onChange={(_event, value) => setIndex(value as number)}
                    step={1}
                    value={Math.min(index, steps.length - 1)}
                    valueLabelDisplay="off"
                />
            </Box>

            <Box>
                <Typography variant="body1">
                    {exported > 0
                        ? I18n.t('The house is feeding %s into the grid.', watt(exported))
                        : I18n.t('The house is drawing %s from the grid.', watt(-exported))}
                </Typography>
                <Typography variant="body1">
                    {I18n.t(
                        'Free for flexible devices: %s. Already handed out: %s. Still free: %s.',
                        watt(step.plan.budget.availableW),
                        watt(step.plan.budget.allocatedW),
                        watt(step.plan.budget.remainingW),
                    )}
                </Typography>
                <Typography
                    color="text.secondary"
                    variant="body2"
                >
                    {I18n.t('Kept in reserve: %s.', watt(step.plan.budget.reserveW))}
                </Typography>
            </Box>

            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>{I18n.t('Device')}</TableCell>
                        <TableCell>{I18n.t('Status')}</TableCell>
                        <TableCell align="right">{I18n.t('Power')}</TableCell>
                        <TableCell>{I18n.t('Why')}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {step.plan.consumers.map(decision => (
                        <TableRow key={decision.key}>
                            <TableCell>{names.get(decision.key) ?? decision.key}</TableCell>
                            <TableCell>{I18n.t(CONSUMER_STATE_TEXT[decision.state])}</TableCell>
                            <TableCell align="right">{watt(decision.proposedPowerW)}</TableCell>
                            <TableCell>{I18n.t(CONSUMER_REASON_TEXT[decision.reason])}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Box>
                <Typography variant="subtitle1">{I18n.t('What happens during this day')}</Typography>
                {events.length === 0 ? (
                    <Typography variant="body2">
                        {I18n.t('Nothing is switched on this day — there is never enough surplus power.')}
                    </Typography>
                ) : (
                    events.map(event => (
                        <Typography
                            key={`${event.key}-${event.ts}`}
                            variant="body2"
                        >
                            {event.on
                                ? I18n.t('%s: %s starts', clock(event.ts), names.get(event.key) ?? event.key)
                                : I18n.t('%s: %s stops', clock(event.ts), names.get(event.key) ?? event.key)}
                        </Typography>
                    ))
                )}
                {native.consumers.map(consumer => (
                    <Typography
                        color="text.secondary"
                        key={consumer.key}
                        variant="body2"
                    >
                        {I18n.t('%s runs %s on this day.', consumer.name, duration(runtimes[consumer.key] ?? 0))}
                    </Typography>
                ))}
            </Box>
        </Box>
    );
}
