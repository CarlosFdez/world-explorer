import { OpacityGMAdjuster } from "./module/opacity-slider.mjs";
import { WorldExplorerLayer, DEFAULT_SETTINGS } from "./module/world-explorer-layer.mjs";
import { calculateGmPartialOpacity } from "./module/util.mjs";

const POSITION_OPTIONS = {
    back: "WorldExplorer.WorldSettings.Position.Choices.back",
    behindDrawings: "WorldExplorer.WorldSettings.Position.Choices.behindDrawings",
    behindTokens: "WorldExplorer.WorldSettings.Position.Choices.behindTokens",
    front: "WorldExplorer.WorldSettings.Position.Choices.front",
}

export const MODULE = "world-explorer";

// World settings
Hooks.once("init", () => {
  game.settings.register(MODULE, "position", {
    name: "WorldExplorer.WorldSettings.Position.Name",
    hint: "WorldExplorer.WorldSettings.Position.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: POSITION_OPTIONS,
    default: "behindDrawings",
    requiresReload: false,
    onChange: () => {
        // If the Z-Index has changed, re-evaluate children
        canvas.primary.sortChildren();
    }
  });
  game.settings.register(MODULE, "gridRevealRadius", {
    name: "WorldExplorer.WorldSettings.GridReveal.Name",
    hint: "WorldExplorer.WorldSettings.GridReveal.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
    requiresReload: false,
    onChange: () => {
        // If the revealRadius changed, refresh the mask
        if (canvas.worldExplorer.enabled) canvas.worldExplorer.refreshMask();
    }
  });
});

Hooks.on("init", async () => {
    // Add world explorer layer
    CONFIG.Canvas.layers["worldExplorer"] = {
        layerClass: WorldExplorerLayer,
        group: "primary",
    };

    const { SceneConfig } = foundry.applications.sheets;
    // Add the world explorer tab and config to the scene config
    // We need to make sure the world explorer tab renders before the footer
    const label = game.i18n.localize("WorldExplorer.Name");
    SceneConfig.TABS.sheet.tabs.push({ id: "worldExplorer", label, icon: "fa-solid fa-map-location-dot" });
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
            const opacityPlayer = this.document.flags[MODULE].opacityPlayer ?? DEFAULT_SETTINGS.opacityPlayer;
            const opacityGM = this.document.flags[MODULE].opacityGM ?? DEFAULT_SETTINGS.opacityGM;
            const opacityPartial = this.document.flags[MODULE].partialOpacityPlayer ?? DEFAULT_SETTINGS.partialOpacityPlayer;
            const partialOpacityGM = calculateGmPartialOpacity({ opacityPlayer, opacityGM, opacityPartial });
            return {
                ...DEFAULT_SETTINGS,
                ...this.document.flags[MODULE],
                units: this.document.grid.units,
                document: this.document,
                tab: context.tabs[partId],
                roles: {
                    gm: game.i18n.localize("USER.RoleGamemaster"),
                    player: game.i18n.localize("USER.RolePlayer"),
                },
                partialOpacityGM
            };
        }

        return defaultRenderPartContext.call(this, partId, context, options);
    }

    // Override onChangeForm to include world explorer
    const default_onChangeForm = SceneConfig.prototype._onChangeForm;
    SceneConfig.prototype._onChangeForm = function(formConfig, event) {
        const formElements = this.form.elements;
        const opacityPlayerElement = formElements['flags.world-explorer.opacityPlayer'];
        const opacityGmElement = formElements['flags.world-explorer.opacityGM'];
        const opacityPartialElement = formElements['flags.world-explorer.partialOpacityPlayer'];
        switch (event.target) {
            case opacityPlayerElement:
            case opacityGmElement:
            case opacityPartialElement:
                const opacityPlayer = opacityPlayerElement.value;
                const opacityGM = opacityGmElement.value;
                const opacityPartial = opacityPartialElement.value;
                formElements['WorldExplorerPartialOpacityGM'].value = calculateGmPartialOpacity({ opacityPlayer, opacityGM, opacityPartial });
                break;
        }
        return default_onChangeForm.call(this, formConfig, event);
    }
});

Hooks.on("canvasReady", (canvas) => {
    canvas.worldExplorer?.onCanvasReady();
    OpacityGMAdjuster.instance?.close();
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

    if (data.flags && MODULE in data.flags) {
        const worldExplorerFlags = data.flags[MODULE];

        // If the change only affects the mask, do the throttled refresh to not interfere with token moving
        const maskOnlyFlags = ["gridData", "opacityGM", "opacityPlayer", "partialOpacityPlayer"];
        const hasMaskOnlyFlag = maskOnlyFlags.find((flag) => { if (flag in worldExplorerFlags) return flag; });
        if (hasMaskOnlyFlag && Object.keys(worldExplorerFlags).length === 1) {
            // Force recreating the gridDataMap if that data changed but we are only refreshing the masks
            if (hasMaskOnlyFlag === "gridData") canvas.worldExplorer._gridDataMap = null;
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
            ui.controls.render({ reset: true });
        }
    }
});

// Add Controls
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    if (!canvas.worldExplorer?.enabled) {
        if (canvas.worldExplorer?.active) {
            // World Explorer tools active, but not enabled for this scene, thus
            // activate top (token) controls instead, so the scene doesn't fail to load
            canvas.tokens.activate();
        }
        return;
    }

    controls.worldExplorer = {
        name: "worldExplorer",
        title: game.i18n.localize("WorldExplorer.Name"),
        icon: "fa-solid fa-map-location-dot",
        layer: "worldExplorer",
        onChange: (_event, active) => {
            if (active) canvas.worldExplorer.activate();
        },
        tools: {
            toggle: {
                name: "toggle",
                title: "WorldExplorer.Tools.Toggle",
                icon: "fa-solid fa-shuffle",
            },
            reveal: {
                name: "reveal",
                title: "WorldExplorer.Tools.Reveal",
                icon: "fa-thin fa-grid-2-plus"
            },
            partial: {
                name: "partial",
                title: "WorldExplorer.Tools.Partial",
                icon: "fa-duotone fa-grid-2-plus"
            },
            hide: {
                name: "hide",
                title: "WorldExplorer.Tools.Hide",
                icon: "fa-solid fa-grid-2-plus"
            },
            opacity: {
                name: "opacity",
                title: "WorldExplorer.Tools.Opacity",
                icon: "fa-duotone fa-eye-low-vision",
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
                                icon: "fa-solid fa-xmark",
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
Hooks.on('activateSceneControls', (controls) => {
    if (!canvas.worldExplorer) return;

    canvas.worldExplorer?.onChangeTool(controls.tool.name);
    if (controls.control.name !== "worldExplorer") {
        OpacityGMAdjuster.instance?.close();
    }
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
    if (force || canvas.worldExplorer?.settings.revealRadius) {
        canvas.worldExplorer.refreshMask();
    }
}, 30);