export class OpacityGMAdjuster extends Application {
    static instance = new this();

    scene = null;

    static get defaultOptions() {
        return {
            ...super.defaultOptions,
            width: 400,
            height: 45,
            id: "world-explorer-opacity-adjuster",
            minimizable: false,
        };
    }

    get template() {
        return "modules/world-explorer/templates/opacity-adjuster.html";
    }

    async render(force = true, options) {
        this.scene = options.scene;
        if (!this.scene) return this;

        // Adjust position of this application's window
        const bounds = ui.controls.element.find('li[data-tool="opacity"]')[0].getBoundingClientRect();
        options.left = bounds.right + 6;
        options.top = bounds.top - 3;

        return super.render(force, options);
    }

    getData() {
        const flags = this.scene.data.flags["world-explorer"] ?? {};
        return {
            opacityGM: flags.opacityGM ?? DEFAULT_SETTINGS.opacityGM,
        };
    }

    activateListeners($html) {
        if (!this.scene) return;

        $("#world-explorer-opacity-adjuster").find(".window-header").remove();

        const $slider = $html.find("[type=range]");
        $slider.on("input", (event) => {
            const value = Number(event.target.value);
            this.scene.update({ "flags.world-explorer.opacityGM": value });
        });
    }

    detectClose(controls) {
        if (controls.activeControl !== "world-explorer" && this.rendered) {
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
            this.render(true, { scene: canvas.scene }).then(() => {
                $("#world-explorer-opacity-adjuster").hide().fadeIn();
            });
        }
    }
}
