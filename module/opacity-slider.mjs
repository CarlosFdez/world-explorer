const fapi = foundry.applications.api;

export class OpacityGMAdjuster extends fapi.HandlebarsApplicationMixin(fapi.Application) {
    static #instance = null;

    static get instance() {
        return (this.#instance ??= new this());
    }

    static DEFAULT_OPTIONS = {
        id: "world-explorer-opacity-adjuster",
        classes: ["application"],
        window: {
            frame: false,
            positioned: false,
        },
        position: {
            width: 400,
            height: 38,
        }
    }

    static PARTS = {
        main: {
            template: "modules/world-explorer/templates/opacity-adjuster.hbs",
            root: true,
        }
    }

    scene = null;

    _prepareContext() {
        const flags = this.scene.flags["world-explorer"] ?? {};
        return {
            opacityGM: flags.opacityGM ?? DEFAULT_SETTINGS.opacityGM,
        };
    }

    /** Render and replace the referenced scene */
    async render(options) {
        this.scene = options.scene;
        if (!this.scene) return this;
        return super.render(options);
    }

    async _onRender(...args) {
        await super._onRender(...args);
        if (!this.scene) return;
        const element = this.element;

        // Adjust position of this application's window
        const bounds = ui.controls.element.querySelector('button[data-tool="opacity"]')?.getBoundingClientRect();
        if (bounds) {
            element.style.left = `${bounds.right + 6}px`;
            element.style.top = `${bounds.top}px`;
        }

        const slider = element.querySelector("[type=range]");
        slider?.addEventListener("input", (event) => {
            const value = Number(event.target.value);
            this.scene.update({ "flags.world-explorer.opacityGM": value });
        });
    }

    detectClose(controls) {
        if (controls.control.name !== "worldExplorer" && this.rendered) {
            $("#world-explorer-opacity-adjuster").fadeOut(() => {
                this.close({ force: true });
            });
        }
    }

    toggleVisibility() {
        if (this.rendered) {
            $("#world-explorer-opacity-adjuster").fadeOut(() => {
                this.close({ force: true });
            });
        } else {
            this.render({ force: true, scene: canvas.scene }).then(() => {
                $("#world-explorer-opacity-adjuster").hide().fadeIn();
            });
        }
    }
}
