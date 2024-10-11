import { OpacityGMAdjuster } from "./module/opacity-slider.mjs";
import { WorldExplorerLayer, DEFAULT_SETTINGS } from "./module/world-explorer-layer.mjs";

const POSITION_OPTIONS = {
    back: "WorldExplorer.SceneSettings.Position.Options.back",
    behindDrawings: "WorldExplorer.SceneSettings.Position.Options.behindDrawings",
    behindTokens: "WorldExplorer.SceneSettings.Position.Options.behindTokens",
    front: "WorldExplorer.SceneSettings.Position.Options.front"
}

Hooks.on("init", async () => {
    // Add world explorer layer
    CONFIG.Canvas.layers["worldExplorer"] = {
        layerClass: WorldExplorerLayer,
        group: "primary"
    };

    // Create scene configuration overrides
    const defaultSceneConfigRender = SceneConfig.prototype._renderInner;
    SceneConfig.prototype._renderInner = async function(...args) {
        const $html = await defaultSceneConfigRender.apply(this, args);
        const settings = { 
            ...DEFAULT_SETTINGS, 
            ...this.document.flags["world-explorer"],
            units: this.document.grid.units,
            options: {
                positions: POSITION_OPTIONS,
                gm: game.i18n.localize("USER.RoleGamemaster"),
                player: game.i18n.localize("USER.RolePlayer")
            }
        };
        const templateName = "modules/world-explorer/templates/scene-settings.hbs";
        const template = await renderTemplate(templateName, settings);
        
        const name = game.i18n.localize("WorldExplorer.Name");
        const header = $(`<a class="item" data-tab="world-explorer"><i class="fa fa-map"></i> ${name}</a>`);
        $html.find(".sheet-tabs[data-group=main]").append(header);

        const $tab = $(`<div class="tab" data-tab="world-explorer"/>`);
        $html.find("footer.sheet-footer").before($tab.append(template));
        return $html;
    };
});

Hooks.on("canvasReady", () => {
    canvas.worldExplorer?.onCanvasReady();
    OpacityGMAdjuster.instance?.detectClose(controls);
});

Hooks.on("createToken", (token) => {
    updateForToken(token);
    refreshThrottled();
});

Hooks.on("updateToken", (token, data) => {
    if (data.x || data.y) {
        setTimeout(() => {
            updateForToken(token, data);
        }, 100);
    }
});

Hooks.on("refreshToken", (token, options) => {
    if (options.refreshPosition) {
        refreshThrottled();
    }
});

Hooks.on("deleteToken", () => {
    refreshThrottled();
});

Hooks.on("updateScene", (scene, data) => {
    // Skip if the updated scene isn't the current one
    if (scene.id !== canvas.scene.id) return;

    if (data.flags && "world-explorer" in data.flags) {
        const worldExplorerFlags = data.flags["world-explorer"];

        // If the only change was revealed positions, do the throttled refresh to not interfere with token moving
        if (worldExplorerFlags.gridPositions && Object.keys(worldExplorerFlags).length === 1) {
            refreshThrottled(true);
        } else {
            canvas.worldExplorer?.update();
        }

        // If the Z-Index has changed, re-evaluate children
        if (worldExplorerFlags.position) {
            canvas.primary.sortChildren();
        }

        // Handle side-controls not re-rendering when the world explorer mode changes
        if ("enabled" in worldExplorerFlags) {
            ui.controls.initialize();
        }
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
                icon: "fat fa-grid-2-plus"
            },
            {
                name: "partial",
                title: game.i18n.localize("WorldExplorer.Tools.Partial"),
                icon: "fad fa-grid-2-plus"
            },
            {
                name: "hide",
                title: game.i18n.localize("WorldExplorer.Tools.Hide"),
                icon: "fas fa-grid-2-plus"
            },
            {
                name: "opacity",
                title: game.i18n.localize("WorldExplorer.Tools.Opacity.Title"),
                icon: "fad fa-eye-low-vision",
                toggle: true,
                onClick: () => {
                    const adjuster = OpacityGMAdjuster.instance;
                    adjuster.toggleVisibility();
                }
            },
            {
                name: "reset",
                title: game.i18n.localize("WorldExplorer.Tools.Reset"),
                icon: "fas fa-trash",
                button: true,
                onClick: async () => {
                    const code = foundry.utils.randomID(4).toLowerCase();
                    const content = `
                        <p>${game.i18n.localize("WorldExplorer.ResetDialog.Content")}</p>
                        <p>${game.i18n.format("WorldExplorer.ResetDialog.Confirm", { code })}</p>
                        <p><input type="text"/></p>
                    `;

                    new Dialog({
                        title: game.i18n.localize("WorldExplorer.ResetDialog.Title"),
                        content,
                        buttons: {
                            unexplored: {
                                icon: '<i class="fas fa-user-secret"></i>',
                                label: game.i18n.localize("WorldExplorer.ResetDialog.Choices.Unexplored"),
                                callback: () => canvas.worldExplorer.clear(),
                            },
                            partial: {
                                icon: '<i class="fas fa-cloud-fog"></i>',
                                label: game.i18n.localize("WorldExplorer.ResetDialog.Choices.Partial"),
                                callback: () => canvas.worldExplorer.clear({ partial: true }),
                            },
                            explored: {
                                icon: '<i class="fas fa-eye"></i>',
                                label: game.i18n.localize("WorldExplorer.ResetDialog.Choices.Explored"),
                                callback: () => canvas.worldExplorer.clear({ reveal: true }),
                            },
                            cancel: {
                                icon: '<i class="fas fa-times"></i>',
                                label: game.i18n.localize("Cancel"),
                            }
                        },
                        render: ($html) => {
                            const $codeInput = $html.find("input");
                            const $buttons = $html.find("button:not([data-button=cancel]");
                            $buttons.prop("disabled", true);
                            $codeInput.on("input", () => {
                                const matches = $codeInput.val().trim() === code; 
                                $buttons.prop("disabled", !matches);
                            })
                        }
                    }, { width: 500 }).render(true);
                },
            }
        ],
        activeTool: "toggle"
    });
});

// Handle Control Changes
Hooks.on('renderSceneControls', (controls) => {
    if (!canvas.worldExplorer) return;

    const isExplorer = controls.activeControl === "world-explorer";
    const isEditTool = ["toggle", "reveal", "hide", "partial"].includes(controls.activeTool);
    if (isEditTool && isExplorer) {
        canvas.worldExplorer.startEditing(controls.activeTool);
    } else {
        canvas.worldExplorer.stopEditing();
    }

    OpacityGMAdjuster.instance?.detectClose(controls);
});

/** Refreshes the scene on token move, revealing a location if necessary */
function updateForToken(token, data={}) {
    if (!game.user.isGM || !canvas.worldExplorer?.enabled) return;

    // Only do token reveals for player owned or player friendly tokens
    if (token.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY && !token.hasPlayerOwner) {
        return;
    }

    const settings = canvas.worldExplorer.settings;
    if (settings.persistExploredAreas) {
        // Computing token's center is required to not reveal an area to the token's left upon token's creation.
        // This happened on "Hexagonal Rows - Odd" grid configuration during token creation. Using center works
        // on every grid configuration afaik.
        const center = {
            x: (data.x ?? token.x) + ((token.parent?.dimensions?.size / 2) ?? 0),
            y: (data.y ?? token.y) + ((token.parent?.dimensions?.size / 2) ?? 0),
        };
        canvas.worldExplorer.reveal(center);
    }
}

const refreshThrottled = foundry.utils.throttle((force) => {
    if (force || canvas.worldExplorer?.settings.revealRadius > 0) {
        canvas.worldExplorer.refreshMasks();
    }
}, 30);