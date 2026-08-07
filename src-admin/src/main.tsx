import {
    GenericApp,
    I18n,
    Loader,
    type GenericAppProps,
    type GenericAppSettings,
    type GenericAppState,
} from '@iobroker/adapter-react-v5';
import { Box, MenuItem, StyledEngineProvider, TextField, ThemeProvider } from '@mui/material';
import React from 'react';
import { createRoot } from 'react-dom/client';

// admin/i18n/<lang>.json is the single translation source (managed by `npm run translate`).
// Globbing them keeps this list from drifting when a language is added.
const modules: Record<string, { default: Record<string, string> }> = import.meta.glob('../../admin/i18n/*.json', {
    eager: true,
});
const translations = Object.fromEntries(
    Object.entries(modules).map(([path, module]) => [path.replace(/.*\/(.*)\.json$/, '$1'), module.default]),
);

// PowerQueue's modes, in the order they escalate. `control` is the only one that writes to
// foreign states.
const MODES = ['off', 'observe', 'control'];

class App extends GenericApp<GenericAppProps, GenericAppState> {
    constructor(props: GenericAppProps) {
        const settings: GenericAppSettings = { ...props, encryptedFields: [], translations };
        super(props, settings);
    }

    onConnectionReady(): void {
        // executed when the connection to the ioBroker backend is ready
    }

    renderContent(): React.JSX.Element {
        const native = this.state.native as { mode: string; gridPowerId: string; reserveWatts: number };
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480, p: 2 }}>
                <TextField
                    label={I18n.t('Operating mode')}
                    onChange={event => this.updateNativeValue('mode', event.target.value)}
                    select
                    value={native.mode}
                    variant="standard"
                >
                    {MODES.map(mode => (
                        <MenuItem
                            key={mode}
                            value={mode}
                        >
                            {mode}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label={I18n.t('Grid power state')}
                    onChange={event => this.updateNativeValue('gridPowerId', event.target.value)}
                    value={native.gridPowerId}
                    variant="standard"
                />
                <TextField
                    label={I18n.t('Reserve (W)')}
                    onChange={event => this.updateNativeValue('reserveWatts', Number(event.target.value))}
                    type="number"
                    value={native.reserveWatts}
                    variant="standard"
                />
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
