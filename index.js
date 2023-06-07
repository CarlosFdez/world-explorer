import { OpacityGMAdjuster } from "./module/opacity-slider.mjs";
import { WorldExplorerLayer, DEFAULT_SETTINGS } from "./module/world-explorer-layer.mjs";

Hooks.on("init", async () => {
    // Add world explorer layer
    CONFIG.Canvas.layers["worldExplorer"] = {
        layerClass: WorldExplorerLayer,
        group: "primary",
    };

    // Create scene configuration overrides
    const defaultSceneConfigRender = SceneConfig.prototype._renderInner;
    SceneConfig.prototype._renderInner = async function(...args) {
        const $html = await defaultSceneConfigRender.apply(this, args);
        const settings = { ...DEFAULT_SETTINGS, ...this.document.flags["world-explorer"] };
        const templateName = "modules/world-explorer/templates/scene-settings.html";
        const template = await renderTemplate(templateName, settings);
        
        const name = game.i18n.localize("WorldExplorer.Name");
        const header = $(`<a class="item" data-tab="world-explorer"><i class="fa fa-map"></i> ${name}</a>`);
        $html.find(".sheet-tabs").append(header);

        const $tab = $(`<div class="tab" data-tab="world-explorer"/>`);
        $html.find("button[type='submit']").before($tab.append(template));
        return $html;
    };
});

Hooks.on("canvasReady", () => {
    canvas.worldExplorer?.onCanvasReady();
});

Hooks.on("createToken", (token) => {
    if (token.object?.observer) {
        canvas.worldExplorer?.refreshMask();
        persistRevealedArea(token);
    }
});

Hooks.on("updateToken", (token, data) => {
    if (!token.object?.observer) return;
    if (data.x || data.y) {
        canvas.worldExplorer?.refreshMask();
        persistRevealedArea(token);
    }
});

Hooks.on("deleteToken", () => {
    canvas.worldExplorer?.refreshMask();
});

Hooks.on("updateScene", (scene, data) => {
    if (scene.id !== canvas.scene.id) return;
    if (data.flags && "world-explorer" in data.flags) {
        canvas.worldExplorer?.update();
    }
});

// Add Controls
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM || !canvas.worldExplorer?.enabled) return;

    controls.push({
        name: "world-explorer",
        title: game.i18n.localize("WorldExplorer.Name"),
        icon: "fas fa-map",
        layer: "worldExplorer",
        tools: [
            {
                name: "toggle",
                title: game.i18n.localize("WorldExplorer.Tools.Toggle"),
                icon: "fas fa-random",
            },
            {
                name: "reveal",
                title: game.i18n.localize("WorldExplorer.Tools.Reveal"),
                icon: "fas fa-paint-brush"
            },
            {
                name: "hide",
                title: game.i18n.localize("WorldExplorer.Tools.Hide"),
                icon: "fas fa-eraser"
            },
            {
                name: "opacity",
                title: game.i18n.localize("WorldExplorer.Tools.Opacity"),
                icon: "fas fa-lightbulb",
                toggle: true,
                onClick: () => {
                    const adjuster = OpacityGMAdjuster.instance;
                    adjuster.toggleVisibility();
                },
            },
            {
                name: "reset",
                title: game.i18n.localize("WorldExplorer.Tools.Reset"),
                icon: "fas fa-trash",
                onClick: async () => {
                    const title = game.i18n.localize("WorldExplorer.ResetDialog.Title");
                    const content = game.i18n.localize("WorldExplorer.ResetDialog.Content");
                    if (await Dialog.confirm({ title, content })) {
                        canvas.worldExplorer.clear();
                    }
                },
            }
        ],
        activeTool: "toggle",
    });
});

// Handle Control Changes
Hooks.on('renderSceneControls', (controls) => {
    if (!canvas.worldExplorer) return;

    const isExplorer = controls.activeControl === "world-explorer";
    const isEditTool = ["toggle", "reveal", "hide"].includes(controls.activeTool);
    if (isEditTool && isExplorer) {
        canvas.worldExplorer.startEditing(controls.activeTool);
    } else {
        canvas.worldExplorer.stopEditing();
    }

    OpacityGMAdjuster.instance?.detectClose(controls);
});

function persistRevealedArea(token) {
    if (!game.user.isGM || !canvas.worldExplorer?.settings.persistExploredAreas) return;
    
    // Computing token's center is required to not reveal an area to the token's left upon token's creation.
    // This happened on "Hexagonal Rows - Odd" grid configuration during token creation. Using center works
    // on every grid configuration afaik.
    const center = {
        x: token.data.x + ((token.parent?.dimensions?.size / 2) ?? 0),
        y: token.data.y + ((token.parent?.dimensions?.size / 2) ?? 0),
    };
    canvas.worldExplorer?.reveal(center.x, center.y);
}