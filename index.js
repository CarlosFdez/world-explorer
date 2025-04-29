import { OpacityGMAdjuster } from "./module/opacity-slider.mjs";
import { WorldExplorerLayer, DEFAULT_SETTINGS } from "./module/world-explorer-layer.mjs";

const POSITION_OPTIONS = {
    back: "WorldExplorer.SceneSettings.Position.Choices.back",
    behindDrawings: "WorldExplorer.SceneSettings.Position.Choices.behindDrawings",
    behindTokens: "WorldExplorer.SceneSettings.Position.Choices.behindTokens",
    front: "WorldExplorer.SceneSettings.Position.Choices.front",
}

Hooks.on("init", async () => {
    // Add world explorer layer
    CONFIG.Canvas.layers["worldExplorer"] = {
        layerClass: WorldExplorerLayer,
        group: "primary",
    };

    // Add the world explorer tab and config to the scene config
    // We need to make sure the world explorer tab renders before the footer
    const label = game.i18n.localize("WorldExplorer.Name");
    SceneConfig.TABS.sheet.tabs.push({ id: "worldExplorer", label, icon: "fa-solid fa-globe" });
    const footerPart = SceneConfig.PARTS.footer;
    delete SceneConfig.PARTS.footer;
    SceneConfig.PARTS.worldExplorer = {
        template: "modules/world-explorer/templates/scene-settings.hbs"
    };
    SceneConfig.PARTS.footer = footerPart;

    // Override part context to include the world explorer config data
    const defaultRenderPartContext = SceneConfig.prototype._preparePartContext;
    SceneConfig.prototype._preparePartContext = async function(partId, context, options) {
        if (partId === "worldExplorer") {
            return {
                ...DEFAULT_SETTINGS, 
                ...this.document.flags["world-explorer"],
                POSITION_OPTIONS,
                document: this.document,
                tab: context.tabs[partId],
            };
        }

        return defaultRenderPartContext.call(this, partId, context, options);
    }
});

Hooks.on("canvasReady", () => {
    canvas.worldExplorer?.onCanvasReady();
});

Hooks.on("createToken", (token) => {
    updateForToken(token);
    if (canvas.worldExplorer?.settings.revealRadius) {
        canvas.worldExplorer.refreshMask();
    }
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
    if (canvas.worldExplorer?.settings.revealRadius) {
        canvas.worldExplorer.refreshMask();
    }
});

Hooks.on("updateScene", (scene, data) => {
    // Skip if the updated scene isn't the current one
    if (scene.id !== canvas.scene.id) return;
    
    if (data.flags && "world-explorer" in data.flags) {
        const worldExplorerFlags = data.flags["world-explorer"];

        // If the only change was revealed positions, do the throttled refresh to not interfere with token moving
        if (worldExplorerFlags.revealedPositions && Object.keys(worldExplorerFlags).length === 1) {
            refreshThrottled();
        } else {
            canvas.worldExplorer?.update();
        }

        // If the Z-Index has changed, re-evaluate children
        if (worldExplorerFlags.position) {
            canvas.primary.sortChildren();
        }

        // Handle side-controls not re-rendering when the world explorer mode changes
        if ("enabled" in worldExplorerFlags) {
            ui.controls.render({ reset: true });
        }
    }
});

// Add Controls
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM || !canvas.worldExplorer?.enabled) return;

    controls.worldExplorer = {
        name: "worldExplorer",
        title: game.i18n.localize("WorldExplorer.Name"),
        icon: "fa-solid fa-map",
        layer: "worldExplorer",
        tools: {
            toggle: {
                name: "toggle",
                title: "WorldExplorer.Tools.Toggle",
                icon: "fa-solid fa-random",
            },
            reveal: {
                name: "reveal",
                title: "WorldExplorer.Tools.Reveal",
                icon: "fa-solid fa-paint-brush"
            },
            hide: {
                name: "hide",
                title: "WorldExplorer.Tools.Hide",
                icon: "fa-solid fa-eraser"
            },
            opacity: {
                name: "opacity",
                title: "WorldExplorer.Tools.Opacity",
                icon: "fa-solid fa-adjust",
                toggle: true,
                onChange: () => {
                    const adjuster = OpacityGMAdjuster.instance;
                    adjuster.toggleVisibility();
                },
            },
            reset: {
                name: "reset",
                title: game.i18n.localize("WorldExplorer.Tools.Reset"),
                icon: "fa-solid fa-trash",
                button: true,
                onChange: async () => {
                    const code = foundry.utils.randomID(4).toLowerCase();
                    const content = `
                        <div>${game.i18n.localize("WorldExplorer.ResetDialog.Content")}</div>
                        <div>${game.i18n.format("WorldExplorer.ResetDialog.Confirm", { code })}</div>
                        <div><input type="text"/></div>
                    `;
                    const dialog = new foundry.applications.api.Dialog({
                        window: {
                            title: "WorldExplorer.ResetDialog.Title"
                        },
                        content,
                        modal: true,
                        buttons: [
                            {
                                action: "unexplored",
                                icon: "fa-solid fa-user-secret",
                                label: game.i18n.localize("WorldExplorer.ResetDialog.Choices.Unexplored"),
                                callback: () => canvas.worldExplorer.clear(),
                            },
                            {
                                action: "explored",
                                icon: "fa-solid fa-eye",
                                label: game.i18n.localize("WorldExplorer.ResetDialog.Choices.Explored"),
                                callback: () => canvas.worldExplorer.clear({ reveal: true }),
                            },
                            {
                                action: "cancel",
                                icon: "fa-solid fa-times",
                                label: game.i18n.localize("Cancel"),
                            },
                        ],
                    });

                    // Lock buttons until the code matches
                    dialog.addEventListener("render", () => {
                        const element = dialog.element;
                        const codeInput = element.querySelector("input");
                        const buttons = element.querySelectorAll("button:not([data-action=cancel],[data-action=close])");
                        for (const button of buttons) {
                            button.disabled = true;
                        }
                        codeInput.addEventListener("input", () => {
                            const matches = codeInput.value.trim() === code;
                            for (const button of buttons) {
                                button.disabled = !matches;
                            }
                        });
                    })

                    dialog.render({ force: true });
                },
            }
        },
        activeTool: "toggle",
    };
});

// Handle Control Changes
Hooks.on('renderSceneControls', (controls) => {
    if (!canvas.worldExplorer) return;

    const isExplorer = controls.control.name === "worldExplorer";
    const isEditTool = ["toggle", "reveal", "hide"].includes(controls.tool.name);
    if (isEditTool && isExplorer) {
        canvas.worldExplorer.startEditing(controls.tool.name);
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

const refreshThrottled = foundry.utils.throttle(() => {
    if (canvas.worldExplorer?.settings.revealRadius) {
        canvas.worldExplorer.refreshMask();
    }
}, 30);