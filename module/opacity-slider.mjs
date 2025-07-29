import { DEFAULT_SETTINGS } from "./world-explorer-layer.mjs";
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
            height: 80,
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
            partialOpacityGM: flags.partialOpacityGM ?? DEFAULT_SETTINGS.partialOpacityGM,
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

        element.addEventListener("input", (event) => {
            const value = Number(event.target.value);
            const updateId = event.target.parentNode.name;
            this.scene.update({ [updateId]: value });
        });
    }

    detectClose(controls = {}) {
        if (controls.control?.name !== "worldExplorer" && this.rendered) {
            $(`#${this.id}`).fadeOut(() => {
                this.close({ force: true });
            });
        }
    }

    toggleVisibility() {
        if (this.rendered) {
            this.detectClose();
        } else {
            this.render({ force: true, scene: canvas.scene }).then(() => {
                $(`#${this.id}`).hide().fadeIn({duration: 250});
            });
        }
    }
}
