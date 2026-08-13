import {
    GenericApp,
    I18n,
    Loader,
    type GenericAppProps,
    type GenericAppSettings,
    type GenericAppState,
} from '@iobroker/adapter-react-v5';
import { Box, StyledEngineProvider, Tab, Tabs, ThemeProvider, Typography } from '@mui/material';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { normalizeNative, validateNative } from '../../src/lib/config';
import { Devices } from './Devices';
import { FirstRun } from './FirstRun';
import { Simulation } from './Simulation';
import { Status } from './Status';

// admin/i18n/<lang>.json is the single translation source (managed by `npm run translate`).
// Globbing them keeps this list from drifting when a language is added.
const modules: Record<string, { default: Record<string, string> }> = import.meta.glob('../../admin/i18n/*.json', {
    eager: true,
});
const translations = Object.fromEntries(
    Object.entries(modules).map(([path, module]) => [path.replace(/.*\/(.*)\.json$/, '$1'), module.default]),
);

interface AppState extends GenericAppState {
    tab: number;
}

class App extends GenericApp<GenericAppProps, AppState> {
    constructor(props: GenericAppProps) {
        const settings: GenericAppSettings = { ...props, encryptedFields: [], translations };
        super(props, settings);
        this.state = { ...this.state, tab: 0 };
    }

    onConnectionReady(): void {
        this.reportProblems();
    }

    componentDidUpdate(): void {
        this.reportProblems();
    }

    /**
     * An invalid configuration must not be saveable, so the first problem blocks the save button.
     */
    reportProblems(): void {
        const problems = validateNative(normalizeNative(this.state.native));
        this.setConfigurationError(problems.length ? I18n.t(problems[0].message, ...(problems[0].args ?? [])) : '');
    }

    /**
     * The purpose and status area every tab keeps visible: what PowerQueue is for, what it is doing
     * and, if something is missing, what to do next.
     */
    renderStatus(): React.JSX.Element {
        const native = normalizeNative(this.state.native);
        const problems = validateNative(native);
        const mode = {
            off: I18n.t('switched off'),
            observe: I18n.t('watching only'),
            control: I18n.t('watching and switching'),
        }[native.mode];

        return (
            <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2">
                    {I18n.t('PowerQueue hands your surplus power to the devices that may wait — by priority.')}
                </Typography>
                <Typography variant="body2">
                    {problems.length
                        ? `${I18n.t('Needs attention:')} ${I18n.t(problems[0].message, ...(problems[0].args ?? []))}`
                        : I18n.t('Ready — PowerQueue is %s.', mode)}
                </Typography>
            </Box>
        );
    }

    renderContent(): React.JSX.Element {
        const native = normalizeNative(this.state.native);

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {this.renderStatus()}
                <Tabs
                    onChange={(_event, tab: number) => this.setState({ tab })}
                    value={this.state.tab}
                >
                    <Tab label={I18n.t('Setup')} />
                    <Tab label={I18n.t('Right now')} />
                    <Tab label={I18n.t('Devices')} />
                    <Tab label={I18n.t('Simulation')} />
                </Tabs>
                {this.state.tab === 0 ? (
                    <FirstRun
                        native={native}
                        onChange={(attr, value) => this.updateNativeValue(attr, value)}
                        socket={this.socket}
                        theme={{ theme: this.state.theme, themeType: this.state.themeType }}
                    />
                ) : this.state.tab === 1 ? (
                    <Status
                        namespace={`${this.adapterName}.${this.instance}`}
                        native={native}
                        socket={this.socket}
                    />
                ) : this.state.tab === 2 ? (
                    <Devices
                        native={native}
                        onChange={(attr, value) => this.updateNativeValue(attr, value)}
                        socket={this.socket}
                        theme={{ theme: this.state.theme, themeType: this.state.themeType }}
                    />
                ) : (
                    <Simulation native={native} />
                )}
            </Box>
        );
    }

    render(): React.JSX.Element {
        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    {this.state.loaded ? (
                        <div className="App">
                            {this.renderContent()}
                            {this.renderError()}
                            {this.renderToast()}
                            {this.renderSaveCloseButtons()}
                        </div>
                    ) : (
                        <Loader themeType={this.state.themeType} />
                    )}
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}

createRoot(document.getElementById('root')!).render(<App adapterName="powerqueue" />);
