/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';

/**
 * PowerQueue distributes an available electrical power budget among prioritized consumers.
 *
 * This is the scaffold: it starts, reports its configured mode and shuts down cleanly. The
 * input registry, allocator and executor are added in the later phases; until then the adapter
 * neither subscribes to nor writes any foreign state.
 */
class Powerqueue extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'powerqueue',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Nothing is being evaluated yet, so the adapter is not "connected" to its inputs.
        await this.setState('info.connection', false, true);

        this.log.info(`PowerQueue started in mode "${this.config.mode}" (no allocation implemented yet)`);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            // Timers and subscriptions of the control loop are stopped here once they exist.
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
