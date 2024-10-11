import { DEFAULT_SETTINGS } from "./world-explorer-layer.mjs";

export class OpacityGMAdjuster extends Application {
    static instance = new this();

    scene = null;

    static get defaultOptions() {
        return {
            ...super.defaultOptions,
            width: 400,
            id: "world-explorer-opacity-adjuster",
            minimizable: false
        };
    }

    get template() {
        return "modules/world-explorer/templates/opacity-adjuster.hbs";
    }

    async render(force = true, options) {
        this.scene = options.scene;
        if (!this.scene) return this;

        // Adjust position of this application's window
        const bounds = ui.controls.element.find(`li[data-tool="opacity"]`)[0].getBoundingClientRect();
        options.left = bounds.right + 6;
        options.top = bounds.top - 3;

        return super.render(force, options);
    }

    getData() {
        const flags = this.scene.flags["world-explorer"] ?? {};
        return {
            partialOpacityGM: flags.partialOpacityGM ?? DEFAULT_SETTINGS.partialOpacityGM,
            opacityGM: flags.opacityGM ?? DEFAULT_SETTINGS.opacityGM
        };
    }

    activateListeners($html) {
        if (!this.scene) return;

        $(`#${this.id}`).find(".window-header").remove();

        $html.on("input", (event) => {
            const value = Number(event.target.value);
            const updateId = event.target.parentNode.name;
            this.scene.update({ [updateId]: value });
        });
    }

    detectClose(controls) {
        if (controls.activeControl !== "world-explorer" && this.rendered) {
            $(`#${this.id}`).fadeOut(() => {
                this.close({ force: true });
            });
        }
    }

    toggleVisibility() {
        if (this.rendered) {
            $(`#${this.id}`).fadeOut(() => {
                this.close({ force: true });
            });
        } else {
            this.render(true, { scene: canvas.scene }).then(() => {
                $(`#${this.id}`).hide().fadeIn();
            });
        }
    }
}
