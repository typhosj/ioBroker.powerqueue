/**
 * What PowerQueue is doing right now, read from the states the running adapter publishes.
 *
 * Nothing here decides anything: the simulation shows what would happen, this tab shows what did.
 * Only the stable reason codes are read, never the published English sentences, so the explanation
 * appears in the language of the admin UI.
 */

import { I18n, InfoBox } from '@iobroker/adapter-react-v5';
import type { AdminConnection } from '@iobroker/socket-client';
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import React from 'react';

import type { NativeConfig } from '../../src/lib/config';
import { CONSUMER_REASON_TEXT, CONSUMER_STATE_TEXT, PLAN_REASON_TEXT } from '../../src/lib/reasons';
import type { ConsumerState, ReasonCode } from '../../src/lib/types';
import { duration, energy, watt } from './Simulation';

/** What the table needs per device, and what the header needs on top. */
const CONSUMER_FIELDS = ['state', 'reason', 'proposedPowerW', 'measuredPowerW', 'runtimeTodayS'] as const;
const BUDGET_FIELDS = ['surplusW', 'availableW', 'allocatedW', 'remainingW', 'reserveW'] as const;

type Values = Record<string, ioBroker.StateValue>;

/**
 * Subscribe to a fixed list of states for as long as the tab is open.
 *
 * @param socket - the admin connection
 * @param ids - the object IDs to watch
 * @returns the current value per ID
 */
function useStates(socket: AdminConnection, ids: string[]): Values {
    const [values, setValues] = React.useState<Values>({});
    // The effect depends on the contents of the list, not on the array identity a render creates.
    const joined = ids.join(',');

    React.useEffect(() => {
        const watched = joined ? joined.split(',') : [];
        const handler = (id: string, state: ioBroker.State | null | undefined): void => {
            setValues(previous => ({ ...previous, [id]: state ? state.val : null }));
        };

        for (const id of watched) {
            void socket.getState(id).then(state => handler(id, state));
            void socket.subscribeState(id, handler);
        }
        return () => {
            for (const id of watched) {
                socket.unsubscribeState(id, handler);
            }
        };
    }, [socket, joined]);

    return values;
}

/**
 * @param value - a state value
 * @returns the number it holds, or 0 when it holds none
 */
function number(value: ioBroker.StateValue): number {
    return typeof value === 'number' ? value : 0;
}

interface StatusProps {
    native: NativeConfig;
    socket: AdminConnection;
    /** `powerqueue.<instance>` — the namespace whose states are read. */
    namespace: string;
}

/**
 * @param props - configuration, connection and the instance namespace
 * @returns the live status tab
 */
export function Status(props: StatusProps): React.JSX.Element {
    const { namespace, native } = props;

    const ids = [
        `system.adapter.${namespace}.alive`,
        `${namespace}.plan.valid`,
        `${namespace}.plan.reason`,
        ...BUDGET_FIELDS.map(field => `${namespace}.budget.${field}`),
        `${namespace}.stats.plannedTodayWh`,
        ...native.consumers.flatMap(consumer =>
            CONSUMER_FIELDS.map(field => `${namespace}.consumers.${consumer.key}.${field}`),
        ),
    ];
    const values = useStates(props.socket, ids);

    if (values[`system.adapter.${namespace}.alive`] !== true) {
        return (
            <Box sx={{ p: 2 }}>
                <InfoBox type="info">
                    {I18n.t('PowerQueue is not running, so there is nothing to report. Start the instance first.')}
                </InfoBox>
            </Box>
        );
    }

    const reason = (values[`${namespace}.plan.reason`] as ReasonCode) ?? 'ok';
    const budget = Object.fromEntries(
        BUDGET_FIELDS.map(field => [field, number(values[`${namespace}.budget.${field}`])]),
    ) as Record<(typeof BUDGET_FIELDS)[number], number>;
    const plannedTodayWh = number(values[`${namespace}.stats.plannedTodayWh`]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2, overflow: 'auto' }}>
            <Typography variant="body1">{I18n.t(PLAN_REASON_TEXT[reason] ?? PLAN_REASON_TEXT.ok)}</Typography>

            <Box>
                <Typography variant="body1">
                    {budget.surplusW > 0
                        ? I18n.t('The house is feeding %s into the grid.', watt(budget.surplusW))
                        : I18n.t('The house is drawing %s from the grid.', watt(-budget.surplusW))}
                </Typography>
                <Typography variant="body1">
                    {I18n.t(
                        'Free for flexible devices: %s, of which %s is already handed out. Still free: %s.',
                        watt(budget.availableW),
                        watt(budget.allocatedW),
                        watt(budget.remainingW),
                    )}
                </Typography>
                <Typography
                    color="text.secondary"
                    variant="body2"
                >
                    {I18n.t(
                        'A device may only start once the free power covers its own consumption plus the reserve of %s.',
                        watt(budget.reserveW),
                    )}
                </Typography>
            </Box>

            <Box>
                <Typography variant="body1">
                    {native.mode === 'control'
                        ? I18n.t('Handed to your devices today: %s.', energy(plannedTodayWh))
                        : I18n.t('The plans of today add up to %s in your devices.', energy(plannedTodayWh))}
                </Typography>
                {native.mode === 'control' ? null : (
                    <Typography
                        color="text.secondary"
                        variant="body2"
                    >
                        {I18n.t(
                            'That is what PowerQueue would have carried, including what a device is already drawing by itself.',
                        )}
                    </Typography>
                )}
            </Box>

            {native.mode === 'control' ? null : (
                <InfoBox type="info">
                    {I18n.t(
                        'PowerQueue is only watching, so nothing here was switched: the state and the proposal say what PowerQueue would do. What your devices are really doing is in the measured column.',
                    )}
                </InfoBox>
            )}

            {native.consumers.length === 0 ? (
                <Typography variant="body2">{I18n.t('No device is configured yet.')}</Typography>
            ) : (
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>{I18n.t('Device')}</TableCell>
                            <TableCell>{I18n.t('Status')}</TableCell>
                            <TableCell align="right">
                                {native.mode === 'control' ? I18n.t('Power') : I18n.t('Proposal')}
                            </TableCell>
                            <TableCell align="right">{I18n.t('Measured')}</TableCell>
                            <TableCell align="right">{I18n.t('Today')}</TableCell>
                            <TableCell>{I18n.t('Why')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {[...native.consumers]
                            .sort((a, b) => a.priority - b.priority || (a.key < b.key ? -1 : 1))
                            .map(consumer => {
                                const base = `${namespace}.consumers.${consumer.key}`;
                                const state = values[`${base}.state`] as ConsumerState | undefined;
                                const why = values[`${base}.reason`] as ReasonCode | undefined;
                                return (
                                    <TableRow key={consumer.key}>
                                        <TableCell>{consumer.name || consumer.key}</TableCell>
                                        <TableCell>{state ? I18n.t(CONSUMER_STATE_TEXT[state]) : '—'}</TableCell>
                                        <TableCell align="right">
                                            {watt(number(values[`${base}.proposedPowerW`]))}
                                        </TableCell>
                                        <TableCell align="right">
                                            {/* A device without a measured value says nothing about
                                                itself, and a dash is the honest answer for it. */}
                                            {typeof values[`${base}.measuredPowerW`] === 'number'
                                                ? watt(values[`${base}.measuredPowerW`] as number)
                                                : '—'}
                                        </TableCell>
                                        <TableCell align="right">
                                            {duration(number(values[`${base}.runtimeTodayS`]))}
                                        </TableCell>
                                        <TableCell>{why ? I18n.t(CONSUMER_REASON_TEXT[why]) : ''}</TableCell>
                                    </TableRow>
                                );
                            })}
                    </TableBody>
                </Table>
            )}
        </Box>
    );
}
